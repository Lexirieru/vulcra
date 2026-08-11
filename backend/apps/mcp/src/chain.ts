import {
  encodeFunctionData,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import {
  makePublicClient,
  resolveMasterAccountController,
  resolveAssetManagerFXRP,
  assetManagerAbi,
  readFeedById,
  collateralValueUsd18At,
  crBps,
  type FeedReading,
} from "@vulcra/chain-client";
import { vaultManagerAbi } from "@vulcra/interfaces";
import {
  getPersonalAccount,
  getNonce,
  buildManageUserOp,
  computeRequiredXrpDrops,
  dropsToXrpString,
} from "@vulcra/userop";
import type { McpBranch, McpConfig } from "./config.js";

/**
 * Direct on-chain reads against Coston2 (read-only PublicClient — never a key).
 * These back the query + quote tools; the intent tools that need to build an
 * unsigned payment defer to the executor HTTP API, except earn withdraw which the
 * executor does not yet expose and which we assemble here from @vulcra/userop.
 */

/** StabilityPool read/write surface used by the earn tools (mirrors the dApp). */
const stabilityPoolAbi = [
  { type: "function", name: "totalDeposits", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "currentAprBps", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "trailingAprBps", stateMutability: "view", inputs: [{ name: "window", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "depositOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "withdrawFromSP", stateMutability: "nonpayable", inputs: [{ name: "amount18", type: "uint256" }], outputs: [] },
] as const satisfies Abi;

const SEVEN_DAYS = 7n * 24n * 60n * 60n;

export interface ChainContext {
  client: PublicClient;
  cfg: McpConfig;
}

export function makeChainContext(cfg: McpConfig): ChainContext {
  return { client: makePublicClient(cfg.rpcUrl), cfg };
}

function nowSeconds(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

/** Resolve the deterministic PersonalAccount (EVM smart account) for an XRPL r-address. */
export async function resolvePersonalAccount(ctx: ChainContext, rAddress: string): Promise<Address> {
  const mac = await resolveMasterAccountController(ctx.client);
  return getPersonalAccount(ctx.client as never, mac, rAddress);
}

export interface BranchParams {
  mcrBps: bigint;
  minDebt18: bigint;
  mintFeeBps: bigint;
  liqBonusBps: bigint;
  redemptionFeeBps: bigint;
  minInterestRateBps: bigint;
  maxInterestRateBps: bigint;
  defaultInterestRateBps: bigint;
}

/** Read a branch's risk/fee parameters + interest-rate bounds live. */
export async function readBranchParams(ctx: ChainContext, branch: McpBranch): Promise<BranchParams> {
  const vm = branch.vaultManager;
  const read = (fn: string, args: readonly unknown[] = []) =>
    ctx.client.readContract({ address: vm, abi: vaultManagerAbi, functionName: fn as never, args }) as Promise<unknown>;
  const [params, minR, maxR, defR] = await Promise.all([
    read("params") as Promise<readonly [bigint, bigint, bigint, bigint, bigint]>,
    read("minInterestRateBps") as Promise<bigint>,
    read("maxInterestRateBps") as Promise<bigint>,
    read("defaultInterestRateBps") as Promise<bigint>,
  ]);
  return {
    mcrBps: params[0],
    minDebt18: params[1],
    mintFeeBps: params[2],
    liqBonusBps: params[3],
    redemptionFeeBps: params[4],
    minInterestRateBps: minR,
    maxInterestRateBps: maxR,
    defaultInterestRateBps: defR,
  };
}

/** Read a branch's FTSOv2 USD price feed (scaled to 18-dec). */
export function readBranchPrice(ctx: ChainContext, branch: McpBranch): Promise<FeedReading> {
  return readFeedById(ctx.client, branch.feedId, { maxStalenessSeconds: 120, nowSeconds: nowSeconds() });
}

export interface OnChainVault {
  owner: Address;
  collateral6: bigint;
  debt18: bigint;
  active: boolean;
  rateBps: bigint;
}

/** Read one vault's raw state by owner (the PersonalAccount address). */
export async function readVault(ctx: ChainContext, branch: McpBranch, owner: Address): Promise<OnChainVault> {
  const vm = branch.vaultManager;
  const [vault, rateBps] = await Promise.all([
    ctx.client.readContract({ address: vm, abi: vaultManagerAbi, functionName: "getVault", args: [owner] }) as Promise<readonly [bigint, bigint, boolean]>,
    ctx.client.readContract({ address: vm, abi: vaultManagerAbi, functionName: "annualInterestRateBpsOf", args: [owner] }).catch(() => 0n) as Promise<bigint>,
  ]);
  return { owner, collateral6: vault[0], debt18: vault[1], active: vault[2], rateBps };
}

export interface VaultHealth {
  collateralUsd18: bigint;
  crBps: bigint;
  /** Price (18-dec USD per whole collateral token) at which CR falls to the MCR. */
  liquidationPrice18: bigint | null;
  isLiquidatable: boolean;
  /** Distance from the current price down to the liquidation price, in bps (10000 = 100%). */
  bufferBps: bigint | null;
}

/**
 * Compute a vault's collateral ratio + liquidation price from live price + params.
 * CR is computed client-side (collateralValueUsd18 * 10000 / debt) so it never
 * reverts on a zero-debt vault. Liquidation price solves CR == MCR:
 *   P_liq = mcrBps/10000 * debt18 * 10^collDec / collateral6
 */
export function computeHealth(
  vault: OnChainVault,
  branch: McpBranch,
  feed: FeedReading,
  params: BranchParams,
): VaultHealth {
  const collateralUsd18 = collateralValueUsd18At(vault.collateral6, branch.collateralDecimals, feed.value, feed.decimals);
  const cr = crBps(collateralUsd18, vault.debt18);
  if (vault.debt18 === 0n || vault.collateral6 === 0n) {
    return { collateralUsd18, crBps: cr, liquidationPrice18: null, isLiquidatable: false, bufferBps: null };
  }
  const scale = 10n ** BigInt(branch.collateralDecimals);
  const liquidationPrice18 = (params.mcrBps * vault.debt18 * scale) / (10000n * vault.collateral6);
  const isLiquidatable = cr < params.mcrBps;
  // buffer = (currentPrice - liqPrice) / currentPrice, in bps.
  const price18 = feed.price18;
  const bufferBps = price18 > 0n ? ((price18 - liquidationPrice18) * 10000n) / price18 : null;
  return { collateralUsd18, crBps: cr, liquidationPrice18, isLiquidatable, bufferBps };
}

export interface PreviewOpen {
  debt18: bigint;
  crBps: bigint;
  meetsMcr: boolean;
  meetsMinDebt: boolean;
}

/** VaultManager.previewOpen — authoritative debt/CR/feasibility for a proposed open. */
export async function previewOpen(
  ctx: ChainContext,
  branch: McpBranch,
  collateral6: bigint,
  mint18: bigint,
): Promise<PreviewOpen> {
  const r = (await ctx.client.readContract({
    address: branch.vaultManager,
    abi: vaultManagerAbi,
    functionName: "previewOpen",
    args: [collateral6, mint18],
  })) as readonly [bigint, bigint, boolean, boolean];
  return { debt18: r[0], crBps: r[1], meetsMcr: r[2], meetsMinDebt: r[3] };
}

export interface EarnPosition {
  deposit18: bigint;
  totalDeposits18: bigint;
  aprBps: bigint;
  apr7dBps: bigint;
}

/** Read an account's StabilityPool deposit + live/trailing APR + pool TVL. */
export async function readEarnPosition(ctx: ChainContext, branch: McpBranch, account: Address): Promise<EarnPosition> {
  const pool = branch.stabilityPool;
  const base = { address: pool, abi: stabilityPoolAbi } as const;
  const [deposit18, totalDeposits18, aprBps, apr7dBps] = await Promise.all([
    ctx.client.readContract({ ...base, functionName: "depositOf", args: [account] }) as Promise<bigint>,
    ctx.client.readContract({ ...base, functionName: "totalDeposits", args: [] }) as Promise<bigint>,
    ctx.client.readContract({ ...base, functionName: "currentAprBps", args: [] }).catch(() => 0n) as Promise<bigint>,
    ctx.client.readContract({ ...base, functionName: "trailingAprBps", args: [SEVEN_DAYS] }).catch(() => 0n) as Promise<bigint>,
  ]);
  return { deposit18, totalDeposits18, aprBps, apr7dBps };
}

export interface ManagePlanLike {
  personalAccount: Address;
  nonce: string;
  coreVaultXrplAddress: string;
  requiredPaymentDrops: string;
  requiredPaymentXrp: string;
  executorFeeUBA: string;
  memo: Hex;
  xrplMemoData: string;
  userOpHash: Hex;
  userOpBytes: Hex;
}

/**
 * Build the UNSIGNED XRPL payment for a StabilityPool withdrawal. The executor's
 * /manage/build does not (yet) expose an SP-withdraw action, so we assemble the
 * same 0xFE memo-only user-op locally from @vulcra/userop — identical wrapping to
 * every other manage action (net mint 0, fees-only payment). Still zero-custody:
 * we only return the payload for the user to sign.
 */
export async function buildEarnWithdrawPlan(
  ctx: ChainContext,
  branch: McpBranch,
  rAddress: string,
  amount18: bigint,
): Promise<ManagePlanLike> {
  const [mac, assetManager] = await Promise.all([
    resolveMasterAccountController(ctx.client),
    resolveAssetManagerFXRP(ctx.client),
  ]);
  const personalAccount = await getPersonalAccount(ctx.client as never, mac, rAddress);
  const nonce = await getNonce(ctx.client as never, mac, personalAccount);

  const [coreVaultXrplAddress, minFeeUBA, executorFeeUBA, mintFeeBips] = await Promise.all([
    ctx.client.readContract({ address: assetManager, abi: assetManagerAbi, functionName: "directMintingPaymentAddress", args: [] }) as Promise<string>,
    ctx.client.readContract({ address: assetManager, abi: assetManagerAbi, functionName: "getDirectMintingMinimumFeeUBA", args: [] }) as Promise<bigint>,
    ctx.client.readContract({ address: assetManager, abi: assetManagerAbi, functionName: "getDirectMintingExecutorFeeUBA", args: [] }) as Promise<bigint>,
    ctx.client.readContract({ address: assetManager, abi: assetManagerAbi, functionName: "getDirectMintingFeeBIPS", args: [] }) as Promise<bigint>,
  ]);

  const call = {
    target: branch.stabilityPool,
    value: 0n,
    data: encodeFunctionData({ abi: stabilityPoolAbi, functionName: "withdrawFromSP", args: [amount18] }),
  };
  const built = buildManageUserOp({
    sender: personalAccount,
    nonce,
    calls: [call],
    walletId: ctx.cfg.walletId,
    executorFeeUBA,
  });
  const { totalDrops } = computeRequiredXrpDrops({ netMintDrops: 0n, mintFeeBips, minFeeUBA, executorFeeUBA });

  return {
    personalAccount,
    nonce: nonce.toString(),
    coreVaultXrplAddress,
    requiredPaymentDrops: totalDrops.toString(),
    requiredPaymentXrp: dropsToXrpString(totalDrops),
    executorFeeUBA: executorFeeUBA.toString(),
    memo: built.memo,
    xrplMemoData: built.xrplMemoData,
    userOpHash: built.userOpHash,
    userOpBytes: built.userOpBytes,
  };
}
