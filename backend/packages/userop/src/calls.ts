import {
  encodeFunctionData,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { erc20Abi, vulcraZapAbi } from "@vulcra/interfaces";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

/** Minimal VaultManager write ABI for the XRPL-native manage instructions. */
const vaultManagerWriteAbi = [
  { type: "function", name: "addCollateral", stateMutability: "nonpayable", inputs: [{ name: "amount6", type: "uint256" }, { name: "prevHint", type: "address" }, { name: "nextHint", type: "address" }], outputs: [] },
  { type: "function", name: "withdrawCollateral", stateMutability: "nonpayable", inputs: [{ name: "amount6", type: "uint256" }, { name: "prevHint", type: "address" }, { name: "nextHint", type: "address" }], outputs: [] },
  { type: "function", name: "mintMore", stateMutability: "nonpayable", inputs: [{ name: "amount18", type: "uint256" }, { name: "prevHint", type: "address" }, { name: "nextHint", type: "address" }], outputs: [] },
  { type: "function", name: "repay", stateMutability: "nonpayable", inputs: [{ name: "amount18", type: "uint256" }, { name: "prevHint", type: "address" }, { name: "nextHint", type: "address" }], outputs: [] },
  { type: "function", name: "closeVault", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "adjustInterestRate", stateMutability: "nonpayable", inputs: [{ name: "newAnnualInterestRateBps", type: "uint256" }, { name: "prevHint", type: "address" }, { name: "nextHint", type: "address" }], outputs: [] },
] as const satisfies Abi;

/** EIP-4337 Call — one contract call executed by the PersonalAccount. */
export interface Call {
  target: Address;
  value: bigint;
  data: Hex;
}

/** ABI of the PersonalAccount `executeUserOp(Call[])` entry point. */
export const personalAccountAbi = [
  {
    type: "function",
    name: "executeUserOp",
    stateMutability: "payable",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      },
    ],
    outputs: [],
  },
] as const satisfies Abi;

/**
 * Build the 2-call batch for the XRPL-native atomic mint:
 *   Call[0] = FXRP.approve(zap, collateral6)
 *   Call[1] = zap.openVaultAndForward(collateral6, mint18, annualInterestRateBps, vusdDestination, prevHint, nextHint)
 *
 * Both run from the PersonalAccount context, so the Zap pulls FXRP from the
 * PersonalAccount and opens a vault owned by it. Vault identity = owner address
 * (the PersonalAccount), matching the smartcontract authority. `annualInterestRateBps`
 * is V2: for the smoothest XRPL 1-payment UX pass the VaultManager's defaultInterestRateBps().
 */
export function buildZapMintCalls(args: {
  fxrp: Address;
  zap: Address;
  collateral6: bigint;
  mint18: bigint;
  annualInterestRateBps: bigint;
  vusdDestination: Address;
  prevHint?: Address;
  nextHint?: Address;
}): Call[] {
  const zeroAddr = "0x0000000000000000000000000000000000000000" as const;
  const approve: Call = {
    target: args.fxrp,
    value: 0n,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [args.zap, args.collateral6],
    }),
  };
  const open: Call = {
    target: args.zap,
    value: 0n,
    data: encodeFunctionData({
      abi: vulcraZapAbi,
      functionName: "openVaultAndForward",
      args: [
        args.collateral6,
        args.mint18,
        args.annualInterestRateBps,
        args.vusdDestination,
        args.prevHint ?? zeroAddr,
        args.nextHint ?? zeroAddr,
      ],
    }),
  };
  return [approve, open];
}

/**
 * MANAGE call batches — the non-minting side of the XRPL-native CDP lifecycle.
 * These ride the SAME 0xFE custom-instruction path as the mint, but with net
 * mint = 0 (a "memo-only" transaction: pay the fees, run the calls, mint no
 * FXRP). The vault is owned by the PersonalAccount, so these run from its
 * context — exactly like the mint's openVault.
 */

/** repay(amount18): pull vUSD from the PersonalAccount and burn debt. */
export function buildRepayCalls(args: {
  vusd: Address;
  vaultManager: Address;
  amount18: bigint;
  prevHint?: Address;
  nextHint?: Address;
}): Call[] {
  return [
    {
      target: args.vusd,
      value: 0n,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [args.vaultManager, args.amount18] }),
    },
    {
      target: args.vaultManager,
      value: 0n,
      data: encodeFunctionData({ abi: vaultManagerWriteAbi, functionName: "repay", args: [args.amount18, args.prevHint ?? ZERO, args.nextHint ?? ZERO] }),
    },
  ];
}

/**
 * mintMore(amount18): borrow MORE vUSD against the existing collateral (no new
 * XRP needed). The freshly-minted vUSD lands on the PersonalAccount. Reverts
 * on-chain (CRTooLow) if it would push the vault under the MCR — size it off the
 * live max-borrow.
 */
export function buildMintMoreCalls(args: {
  vaultManager: Address;
  amount18: bigint;
  prevHint?: Address;
  nextHint?: Address;
}): Call[] {
  return [
    {
      target: args.vaultManager,
      value: 0n,
      data: encodeFunctionData({ abi: vaultManagerWriteAbi, functionName: "mintMore", args: [args.amount18, args.prevHint ?? ZERO, args.nextHint ?? ZERO] }),
    },
  ];
}

/**
 * closeVault(): repay the whole debt and return the collateral to the
 * PersonalAccount. `debt18` is the full outstanding debt to approve (the
 * VaultManager pulls exactly the debt), read live before building.
 */
export function buildCloseCalls(args: {
  vusd: Address;
  vaultManager: Address;
  debt18: bigint;
}): Call[] {
  return [
    {
      target: args.vusd,
      value: 0n,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [args.vaultManager, args.debt18] }),
    },
    {
      target: args.vaultManager,
      value: 0n,
      data: encodeFunctionData({ abi: vaultManagerWriteAbi, functionName: "closeVault", args: [] }),
    },
  ];
}

/**
 * addCollateral(amount6): supply MORE FXRP to the existing vault. The FXRP is
 * freshly minted from the XRP the user sends (net mint > 0), so this rides the
 * mint-style payment (collateral + fees), then the PersonalAccount approves the
 * VaultManager and adds it. Raises CR / borrow headroom.
 */
export function buildAddCollateralCalls(args: {
  fxrp: Address;
  vaultManager: Address;
  amount6: bigint;
  prevHint?: Address;
  nextHint?: Address;
}): Call[] {
  return [
    {
      target: args.fxrp,
      value: 0n,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [args.vaultManager, args.amount6] }),
    },
    {
      target: args.vaultManager,
      value: 0n,
      data: encodeFunctionData({ abi: vaultManagerWriteAbi, functionName: "addCollateral", args: [args.amount6, args.prevHint ?? ZERO, args.nextHint ?? ZERO] }),
    },
  ];
}

/**
 * withdrawCollateral(amount6): pull FXRP collateral back OUT of the vault to the
 * PersonalAccount. Net mint = 0 (memo-only) — no FXRP is minted, the XRPL payment
 * only covers the fees. Reverts on-chain (CRTooLow) if it would drop the vault
 * under the MCR — size it off the live max-withdrawable.
 */
export function buildWithdrawCollateralCalls(args: {
  vaultManager: Address;
  amount6: bigint;
  prevHint?: Address;
  nextHint?: Address;
}): Call[] {
  return [
    {
      target: args.vaultManager,
      value: 0n,
      data: encodeFunctionData({ abi: vaultManagerWriteAbi, functionName: "withdrawCollateral", args: [args.amount6, args.prevHint ?? ZERO, args.nextHint ?? ZERO] }),
    },
  ];
}

/** adjustInterestRate(newRateBps): change the vault's rate (no value moved). */
export function buildAdjustRateCalls(args: {
  vaultManager: Address;
  newAnnualInterestRateBps: bigint;
  prevHint?: Address;
  nextHint?: Address;
}): Call[] {
  return [
    {
      target: args.vaultManager,
      value: 0n,
      data: encodeFunctionData({ abi: vaultManagerWriteAbi, functionName: "adjustInterestRate", args: [args.newAnnualInterestRateBps, args.prevHint ?? ZERO, args.nextHint ?? ZERO] }),
    },
  ];
}

/** `abi.encodeCall(IPersonalAccount.executeUserOp, (calls))` — the userOp callData. */
export function encodeExecuteUserOp(calls: Call[]): Hex {
  return encodeFunctionData({
    abi: personalAccountAbi,
    functionName: "executeUserOp",
    args: [calls],
  });
}
