import {
  encodeAbiParameters,
  keccak256,
  type Address,
  type Hex,
} from "viem";

/**
 * PackedUserOperation (EIP-4337 v0.7) — the struct the Flare smart-account
 * PersonalAccount / MasterAccountController hashes and dispatches.
 *
 * The 0xFE custom instruction commits `keccak256(abi.encode(userOp))` in the
 * XRPL memo; the executor delivers the full ABI-encoded bytes as `_data` to
 * `executeDirectMintingWithData`, and the controller re-hashes `_data` and
 * requires it equals the memo hash. A single wrong byte here => every mint
 * reverts with CustomInstructionHashMismatch.
 *
 * SINGLE SOURCE OF TRUTH: the struct layout is defined ONCE below. If the live
 * MasterAccountController uses a different layout, fix it here only.
 *
 * !! VERIFY-BEFORE-MAINNET: confirm this 9-field packed layout against the live
 *    smart-accounts `custom-instruction` docs / MasterAccountController ABI on
 *    Coston2 before any real mint. Flare DevHub docs were mid-update at authoring.
 */
export const PACKED_USER_OP_COMPONENTS = [
  { name: "sender", type: "address" },
  { name: "nonce", type: "uint256" },
  { name: "initCode", type: "bytes" },
  { name: "callData", type: "bytes" },
  { name: "accountGasLimits", type: "bytes32" },
  { name: "preVerificationGas", type: "uint256" },
  { name: "gasFees", type: "bytes32" },
  { name: "paymasterAndData", type: "bytes" },
  { name: "signature", type: "bytes" },
] as const;

const PACKED_USER_OP_TUPLE = [
  { type: "tuple", components: PACKED_USER_OP_COMPONENTS },
] as const;

const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

export interface PackedUserOperation {
  sender: Address;
  nonce: bigint;
  initCode: Hex;
  callData: Hex;
  accountGasLimits: Hex; // bytes32
  preVerificationGas: bigint;
  gasFees: Hex; // bytes32
  paymasterAndData: Hex;
  signature: Hex;
}

/**
 * Build a PackedUserOperation from the only three fields the controller
 * validates: sender (= PersonalAccount), nonce (= getNonce), callData
 * (= executeUserOp(Call[])). All other fields are zero/empty.
 */
export function buildPackedUserOp(args: {
  sender: Address;
  nonce: bigint;
  callData: Hex;
}): PackedUserOperation {
  return {
    sender: args.sender,
    nonce: args.nonce,
    initCode: "0x",
    callData: args.callData,
    accountGasLimits: ZERO_BYTES32,
    preVerificationGas: 0n,
    gasFees: ZERO_BYTES32,
    paymasterAndData: "0x",
    signature: "0x",
  };
}

/** `abi.encode(userOp)` — the exact bytes delivered as `_data`. */
export function encodePackedUserOp(op: PackedUserOperation): Hex {
  return encodeAbiParameters(PACKED_USER_OP_TUPLE, [
    {
      sender: op.sender,
      nonce: op.nonce,
      initCode: op.initCode,
      callData: op.callData,
      accountGasLimits: op.accountGasLimits,
      preVerificationGas: op.preVerificationGas,
      gasFees: op.gasFees,
      paymasterAndData: op.paymasterAndData,
      signature: op.signature,
    },
  ]);
}

/** `keccak256(abi.encode(userOp))` — the 32-byte hash committed in the 0xFE memo. */
export function userOpHash(op: PackedUserOperation): Hex {
  return keccak256(encodePackedUserOp(op));
}
