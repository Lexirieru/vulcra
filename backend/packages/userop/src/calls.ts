import {
  encodeFunctionData,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { erc20Abi, vulcraZapAbi } from "@vulcra/interfaces";

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
 *   Call[1] = zap.openVaultAndForward(collateral6, mint18, vusdDestination, prevHint, nextHint)
 *
 * Both run from the PersonalAccount context, so the Zap pulls FXRP from the
 * PersonalAccount and opens a vault owned by it. Vault identity = owner address
 * (the PersonalAccount), matching the smartcontract authority.
 */
export function buildZapMintCalls(args: {
  fxrp: Address;
  zap: Address;
  collateral6: bigint;
  mint18: bigint;
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
        args.vusdDestination,
        args.prevHint ?? zeroAddr,
        args.nextHint ?? zeroAddr,
      ],
    }),
  };
  return [approve, open];
}

/** `abi.encodeCall(IPersonalAccount.executeUserOp, (calls))` — the userOp callData. */
export function encodeExecuteUserOp(calls: Call[]): Hex {
  return encodeFunctionData({
    abi: personalAccountAbi,
    functionName: "executeUserOp",
    args: [calls],
  });
}
