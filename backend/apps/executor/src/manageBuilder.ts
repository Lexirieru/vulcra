import type { Address, Hex, PublicClient } from "viem";
import {
  assetManagerAbi,
  resolveAssetManagerFXRP,
  resolveMasterAccountController,
  resolveFxrpToken,
} from "@vulcra/chain-client";
import {
  buildRepayCalls,
  buildCloseCalls,
  buildAdjustRateCalls,
  buildMintMoreCalls,
  buildAddCollateralCalls,
  buildWithdrawCollateralCalls,
  buildStabilityDepositCalls,
  buildManageUserOp,
  getPersonalAccount,
  getNonce,
  computeRequiredXrpDrops,
  dropsToXrpString,
} from "@vulcra/userop";
import type { ExecutorEnv } from "./env.js";

/**
 * Build the ONE XRPL payment that MANAGES an existing FXRP vault (repay / close /
 * adjust-rate) via the SAME 0xFE custom-instruction path as the mint — but with
 * net mint = 0 ("memo-only"): the XRPL payment covers only the fees, no FXRP is
 * minted, and the committed userOp runs the vault call from the PersonalAccount.
 * The vault is owned by the PersonalAccount, so these run in its context exactly
 * like the mint's openVault. All reads are live against Coston2 (no mock).
 */

const vaultManagerReadAbi = [
  {
    type: "function",
    name: "getVault",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [
      { name: "collateral6", type: "uint256" },
      { name: "debt18", type: "uint256" },
      { name: "active", type: "bool" },
    ],
  },
  {
    // The branch routes accrued interest to its StabilityPool, so interestReceiver
    // IS the pool address — resolve it on-chain (no extra config).
    type: "function",
    name: "interestReceiver",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

export type ManageAction =
  | "repay"
  | "close"
  | "adjustRate"
  | "mintMore"
  | "addCollateral"
  | "withdrawCollateral"
  | "spDeposit";

/**
 * Carrier net-mint for memo-only manage ops (drops = FXRP 6-dec). A fee-only
 * payment reverts on-chain, so these ops mint a tiny amount of FXRP purely to
 * carry the 0xFE instruction. 1 XRP matches the starter's recovery-flow default;
 * tune down once the exact FAssets minimum net mint is confirmed.
 */
const CARRIER_NET_MINT_DROPS = 1_000_000n;

export interface ManagePlan {
  action: ManageAction;
  xrplAddress: string;
  personalAccount: Address;
  nonce: string;
  vaultManager: Address;
  coreVaultXrplAddress: string;
  requiredPaymentDrops: string;
  requiredPaymentXrp: string;
  executorFeeUBA: string;
  memo: Hex;
  xrplMemoData: string;
  userOpHash: Hex;
  userOpBytes: Hex;
  /** IMPORTANT: XRPL payment must carry NO destination tag. */
  noDestinationTag: true;
}

export async function buildManagePlan(
  client: PublicClient,
  env: ExecutorEnv,
  input: {
    xrplAddress: string;
    action: ManageAction;
    /** vUSD (18-dec) to repay / borrow-more — required for `repay`/`mintMore`. */
    amount18?: bigint;
    /** XRP/FXRP (6-dec drops) to supply — required for `addCollateral` (net mint > 0). */
    collateral6?: bigint;
    /** New annual interest rate (bps) — required for `adjustRate`. */
    newRateBps?: bigint;
  },
): Promise<ManagePlan> {
  if (!env.xrplBranch) {
    throw new Error("XRPL-native manage is FXRP-only and no FXRP branch is configured (VAULT_MANAGER_FXRP_ADDRESS).");
  }
  if (!env.vusdAddress) throw new Error("VUSD_ADDRESS is not set.");
  const vaultManager = env.xrplBranch.vaultManager as Address;
  const vusd = env.vusdAddress as Address;

  const [assetManager, mac] = await Promise.all([
    resolveAssetManagerFXRP(client),
    resolveMasterAccountController(client),
  ]);
  const personalAccount = await getPersonalAccount(client as never, mac, input.xrplAddress);
  const nonce = await getNonce(client as never, mac, personalAccount);

  const [coreVaultXrplAddress, minFeeUBA, executorFeeUBA, mintFeeBips] = await Promise.all([
    client.readContract({ address: assetManager, abi: assetManagerAbi, functionName: "directMintingPaymentAddress", args: [] }) as Promise<string>,
    client.readContract({ address: assetManager, abi: assetManagerAbi, functionName: "getDirectMintingMinimumFeeUBA", args: [] }) as Promise<bigint>,
    client.readContract({ address: assetManager, abi: assetManagerAbi, functionName: "getDirectMintingExecutorFeeUBA", args: [] }) as Promise<bigint>,
    client.readContract({ address: assetManager, abi: assetManagerAbi, functionName: "getDirectMintingFeeBIPS", args: [] }) as Promise<bigint>,
  ]);

  let calls;
  // A true fee-only (net-mint = 0) payment reverts on-chain: direct minting
  // requires a positive net mint before it runs the committed memo instruction,
  // so a "memo-only" manage op can't go through this path at all. Every non-supply
  // manage action therefore rides a small non-zero CARRIER mint — the tiny minted
  // FXRP lands as dust on the PersonalAccount, keeping the whole CDP lifecycle on
  // the ONE 0xFE mechanism (mirrors the starter's 0xE0/0xE1 recovery flows, which
  // default to 1 XRP alongside the opcode). Flare-admin guidance. add-collateral
  // overrides this with the real supply amount below.
  let netMintDrops = CARRIER_NET_MINT_DROPS;
  if (input.action === "repay") {
    if (input.amount18 === undefined) throw new Error("amount18 is required for repay.");
    calls = buildRepayCalls({ vusd, vaultManager, amount18: input.amount18 });
  } else if (input.action === "mintMore") {
    if (input.amount18 === undefined) throw new Error("amount18 is required for mintMore.");
    calls = buildMintMoreCalls({ vaultManager, amount18: input.amount18 });
  } else if (input.action === "addCollateral") {
    if (input.collateral6 === undefined) throw new Error("collateral6 is required for addCollateral.");
    const fxrp = await resolveFxrpToken(client);
    calls = buildAddCollateralCalls({ fxrp, vaultManager, amount6: input.collateral6 });
    netMintDrops = input.collateral6;
  } else if (input.action === "withdrawCollateral") {
    // Pull FXRP back out of the vault — memo-only (net mint 0), no FXRP minted.
    if (input.collateral6 === undefined) throw new Error("collateral6 is required for withdrawCollateral.");
    calls = buildWithdrawCollateralCalls({ vaultManager, amount6: input.collateral6 });
  } else if (input.action === "spDeposit") {
    // Deposit vUSD held on the PersonalAccount into the branch's StabilityPool to
    // earn — "borrow -> earn" in one XRPL payment. The pool is the vault's
    // interestReceiver (resolved on-chain). Net mint 0 (memo-only).
    if (input.amount18 === undefined) throw new Error("amount18 is required for spDeposit.");
    const pool = (await client.readContract({
      address: vaultManager,
      abi: vaultManagerReadAbi,
      functionName: "interestReceiver",
      args: [],
    })) as Address;
    calls = buildStabilityDepositCalls({ vusd, pool, amount18: input.amount18 });
  } else if (input.action === "close") {
    // Close approves + burns the FULL debt, so read it live right before building.
    const [, debt18] = (await client.readContract({
      address: vaultManager,
      abi: vaultManagerReadAbi,
      functionName: "getVault",
      args: [personalAccount],
    })) as readonly [bigint, bigint, boolean];
    calls = buildCloseCalls({ vusd, vaultManager, debt18 });
  } else {
    if (input.newRateBps === undefined) throw new Error("newRateBps is required for adjustRate.");
    calls = buildAdjustRateCalls({ vaultManager, newAnnualInterestRateBps: input.newRateBps });
  }

  const built = buildManageUserOp({ sender: personalAccount, nonce, calls, executorFeeUBA });
  // Memo-only actions pay just the fees; add-collateral mints FXRP, so it pays
  // the collateral + the direct-minting fee + the executor fee (mint pricing).
  const { totalDrops } = computeRequiredXrpDrops({
    netMintDrops,
    mintFeeBips,
    minFeeUBA,
    executorFeeUBA,
  });
  const requiredPaymentDrops = totalDrops;

  return {
    action: input.action,
    xrplAddress: input.xrplAddress,
    personalAccount,
    nonce: nonce.toString(),
    vaultManager,
    coreVaultXrplAddress,
    requiredPaymentDrops: requiredPaymentDrops.toString(),
    requiredPaymentXrp: dropsToXrpString(requiredPaymentDrops),
    executorFeeUBA: executorFeeUBA.toString(),
    memo: built.memo,
    xrplMemoData: built.xrplMemoData,
    userOpHash: built.userOpHash,
    userOpBytes: built.userOpBytes,
    noDestinationTag: true,
  };
}
