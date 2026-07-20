import type { Address, Hex, PublicClient } from "viem";
import {
  assetManagerAbi,
  resolveAssetManagerFXRP,
  resolveMasterAccountController,
  resolveFxrpToken,
} from "@vulcra/chain-client";
import { vaultManagerAbi } from "@vulcra/interfaces";
import {
  buildMintUserOp,
  computeRequiredXrpDrops,
  dropsToXrpString,
  getPersonalAccount,
  getNonce,
} from "@vulcra/userop";
import type { ExecutorEnv } from "./env.js";

/**
 * Everything the frontend needs to render the ONE XRPL payment that mints vUSD
 * atomically via the 0xFE custom instruction (R10/R13):
 *   - the XRPL destination (FAssets Core Vault) + the exact drops to send
 *   - the 42-byte 0xFE memo (commits keccak256(userOp)), as MemoData hex
 *   - the userOp bytes to hand back to /mint/submit after the XRPL payment confirms
 *
 * All reads are live against Coston2 (no mock). Live SUBMIT is gated elsewhere.
 */
export interface MintPlan {
  branch: "FXRP";
  xrplAddress: string;
  personalAccount: Address;
  nonce: string;
  annualInterestRateBps: string;
  collateral6: string;
  mint18: string;
  vusdDestination: Address;
  /** XRPL classic r-address of the FAssets Core Vault (payment destination). */
  coreVaultXrplAddress: string;
  requiredPaymentDrops: string;
  requiredPaymentXrp: string;
  executorFeeUBA: string;
  /** 0x-prefixed 42-byte memo. */
  memo: Hex;
  /** XRPL MemoData (no 0x, uppercase). */
  xrplMemoData: string;
  userOpHash: Hex;
  /** ABI-encoded PackedUserOperation to POST to /mint/submit after payment. */
  userOpBytes: Hex;
  /** IMPORTANT: XRPL payment must carry NO destination tag (reroutes the mint). */
  noDestinationTag: true;
}

const readAmString = (
  client: PublicClient,
  assetManager: Address,
  fn: string,
): Promise<bigint> =>
  client.readContract({
    address: assetManager,
    abi: assetManagerAbi,
    functionName: fn as never,
    args: [],
  }) as Promise<bigint>;

/**
 * Build the mint plan for the FXRP branch (the only XRPL-native branch). Resolves
 * the personal account, nonce, default interest rate, Core Vault address, and fees
 * live, then produces the userOp + memo + required payment via the shared @vulcra/userop
 * encoder (identical to what the frontend would compute).
 */
export async function buildMintPlan(
  client: PublicClient,
  env: ExecutorEnv,
  input: {
    xrplAddress: string;
    collateral6: bigint;
    mint18: bigint;
    annualInterestRateBps?: bigint;
    vusdDestination?: Address;
  },
): Promise<MintPlan> {
  if (!env.xrplBranch) {
    throw new Error("XRPL-native mint is FXRP-only and no FXRP branch is configured (VAULT_MANAGER_FXRP_ADDRESS).");
  }
  if (!env.vulcraZapAddress) throw new Error("VULCRA_ZAP_ADDRESS is not set.");
  const vaultManager = env.xrplBranch.vaultManager;
  const zap = env.vulcraZapAddress as Address;

  const [assetManager, fxrp, mac] = await Promise.all([
    resolveAssetManagerFXRP(client),
    resolveFxrpToken(client),
    resolveMasterAccountController(client),
  ]);

  const personalAccount = await getPersonalAccount(client as never, mac, input.xrplAddress);
  const nonce = await getNonce(client as never, mac, personalAccount);

  const [defaultRate, coreVaultXrplAddress, minFeeUBA, mintFeeBips, executorFeeUBA] = await Promise.all([
    client.readContract({ address: vaultManager, abi: vaultManagerAbi, functionName: "defaultInterestRateBps", args: [] }) as Promise<bigint>,
    client.readContract({ address: assetManager, abi: assetManagerAbi, functionName: "directMintingPaymentAddress", args: [] }) as Promise<string>,
    readAmString(client, assetManager, "getDirectMintingMinimumFeeUBA"),
    readAmString(client, assetManager, "getDirectMintingFeeBIPS"),
    readAmString(client, assetManager, "getDirectMintingExecutorFeeUBA"),
  ]);

  const rateBps = input.annualInterestRateBps ?? defaultRate;
  const vusdDestination = input.vusdDestination ?? personalAccount;

  const { totalDrops } = computeRequiredXrpDrops({
    netMintDrops: input.collateral6, // FXRP 6-dec == XRP drops
    mintFeeBips,
    minFeeUBA,
    executorFeeUBA,
  });

  const built = buildMintUserOp({
    sender: personalAccount,
    nonce,
    fxrp,
    zap,
    collateral6: input.collateral6,
    mint18: input.mint18,
    annualInterestRateBps: rateBps,
    vusdDestination,
    walletId: env.walletId,
    executorFeeUBA,
  });

  return {
    branch: "FXRP",
    xrplAddress: input.xrplAddress,
    personalAccount,
    nonce: nonce.toString(),
    annualInterestRateBps: rateBps.toString(),
    collateral6: input.collateral6.toString(),
    mint18: input.mint18.toString(),
    vusdDestination,
    coreVaultXrplAddress,
    requiredPaymentDrops: totalDrops.toString(),
    requiredPaymentXrp: dropsToXrpString(totalDrops),
    executorFeeUBA: executorFeeUBA.toString(),
    memo: built.memo,
    xrplMemoData: built.xrplMemoData,
    userOpHash: built.userOpHash,
    userOpBytes: built.userOpBytes,
    noDestinationTag: true,
  };
}
