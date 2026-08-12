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

/** Max uint256 — a generous, prediction-free approval upper bound for the Zap. */
const MAX_UINT256 = (1n << 256n) - 1n;

/**
 * Build the 2-call batch for the XRPL-native atomic mint:
 *   Call[0] = FXRP.approve(zap, MAX_UINT256)
 *   Call[1] = zap.openVaultAndForwardAll(mint18, annualInterestRateBps, vusdDestination, prevHint, nextHint)
 *
 * Both run from the PersonalAccount context, so the Zap reads the PA's live FXRP
 * balance at execution and opens a vault owned by it. Reading the balance on-chain
 * (rather than baking a collateral figure into the userOp) is deliberate: the 0xFE
 * memo commits keccak256(userOp) BEFORE the mint, so any amount here would only be
 * a prediction of (net minted after feeBIPS, AMG-rounded, minus executorFeeUBA).
 * `annualInterestRateBps` is V2: for the smoothest XRPL 1-payment UX pass the
 * VaultManager's defaultInterestRateBps().
 */
export function buildZapMintCalls(args: {
  fxrp: Address;
  zap: Address;
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
      args: [args.zap, MAX_UINT256],
    }),
  };
  const open: Call = {
    target: args.zap,
    value: 0n,
    data: encodeFunctionData({
      abi: vulcraZapAbi,
      functionName: "openVaultAndForwardAll",
      args: [
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
 * addCollateral: supply MORE FXRP to the existing vault. The FXRP is freshly
 * minted from the XRP the user sends (net mint > 0), so this rides the mint-style
 * payment. Like the open path, it goes through the Zap's balance-read entrypoint
 * (`addCollateralAll`) rather than baking a predicted amount into the userOp — the
 * Zap sweeps the PersonalAccount's live FXRP balance into the vault at execution.
 */
export function buildAddCollateralCalls(args: {
  fxrp: Address;
  zap: Address;
  prevHint?: Address;
  nextHint?: Address;
}): Call[] {
  return [
    {
      target: args.fxrp,
      value: 0n,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [args.zap, MAX_UINT256] }),
    },
    {
      target: args.zap,
      value: 0n,
      data: encodeFunctionData({
        abi: vulcraZapAbi,
        functionName: "addCollateralAll",
        args: [args.prevHint ?? ZERO, args.nextHint ?? ZERO],
      }),
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

/** Minimal StabilityPool write ABI. */
const stabilityPoolWriteAbi = [
  { type: "function", name: "provideToSP", stateMutability: "nonpayable", inputs: [{ name: "amount18", type: "uint256" }], outputs: [] },
] as const satisfies Abi;

/**
 * provideToSP(amount18): deposit vUSD from the PersonalAccount into the branch's
 * StabilityPool to EARN. Net mint = 0 (memo-only): the vUSD already lives on the
 * PersonalAccount (e.g. it was just borrowed), so this only approves + provides it
 * to the pool — "borrow → earn" in one XRPL payment, no EVM wallet needed.
 */
export function buildStabilityDepositCalls(args: {
  vusd: Address;
  pool: Address;
  amount18: bigint;
}): Call[] {
  return [
    {
      target: args.vusd,
      value: 0n,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [args.pool, args.amount18] }),
    },
    {
      target: args.pool,
      value: 0n,
      data: encodeFunctionData({ abi: stabilityPoolWriteAbi, functionName: "provideToSP", args: [args.amount18] }),
    },
  ];
}

/**
 * transfer(to, amount18): send vUSD held on the PersonalAccount to an arbitrary
 * EVM address (e.g. a Rabby / MetaMask wallet). Net mint = 0 (memo-only): the vUSD
 * already lives on the PA (it was just borrowed), so this is a plain ERC-20
 * transfer committed as a 0xFE call — "borrow on XRPL → hold real vUSD on any EVM
 * wallet" in one signed XRPL payment, no EVM wallet needed to move it out.
 */
export function buildSendVusdCalls(args: {
  vusd: Address;
  to: Address;
  amount18: bigint;
}): Call[] {
  return [
    {
      target: args.vusd,
      value: 0n,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [args.to, args.amount18] }),
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
