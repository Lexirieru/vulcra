import type { Address, Hex, PublicClient } from "viem";
import {
  assetManagerAbi,
  resolveAssetManagerFXRP,
  resolveMasterAccountController,
} from "@vulcra/chain-client";
import {
  buildRepayCalls,
  buildCloseCalls,
  buildAdjustRateCalls,
  buildManageUserOp,
  getPersonalAccount,
  getNonce,
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
] as const;

export type ManageAction = "repay" | "close" | "adjustRate";

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
    /** vUSD (18-dec) to repay — required for `repay`. */
    amount18?: bigint;
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

  const [coreVaultXrplAddress, minFeeUBA, executorFeeUBA] = await Promise.all([
    client.readContract({ address: assetManager, abi: assetManagerAbi, functionName: "directMintingPaymentAddress", args: [] }) as Promise<string>,
    client.readContract({ address: assetManager, abi: assetManagerAbi, functionName: "getDirectMintingMinimumFeeUBA", args: [] }) as Promise<bigint>,
    client.readContract({ address: assetManager, abi: assetManagerAbi, functionName: "getDirectMintingExecutorFeeUBA", args: [] }) as Promise<bigint>,
  ]);

  let calls;
  if (input.action === "repay") {
    if (input.amount18 === undefined) throw new Error("amount18 is required for repay.");
    calls = buildRepayCalls({ vusd, vaultManager, amount18: input.amount18 });
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
  // Net mint = 0: the memo-only payment covers just the direct-minting fees.
  const requiredPaymentDrops = minFeeUBA + executorFeeUBA;

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
