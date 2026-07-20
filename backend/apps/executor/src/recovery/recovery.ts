import { encodeSkipMemo, encodeFastForwardMemo } from "@vulcra/userop";
import type { Hex } from "viem";

/**
 * Stuck-mint recovery decisions (pure) — AE4.
 *
 * When executeDirectMintingWithData reverts, no FXRP is minted and the XRP sits
 * at the Core Vault. Recovery:
 *   1. If the stuck txId is NOT yet used on-chain -> 0xE0 skip flow: the service
 *      XRPL wallet sends a small positive-net-mint recovery payment carrying the
 *      0xE0 memo, the executor sets the skip flag, then re-submits the original
 *      payment so FXRP mints WITHOUT running the failed userOp.
 *   2. If it IS already used -> nothing to recover (someone finalized it).
 *   3. 0xE1 fast-forward the nonce only AFTER the stuck payment is confirmed
 *      minted, to move past the abandoned userOp slot.
 */

export type RecoveryAction = "SKIP_0xE0" | "ALREADY_MINTED";

export function decideRecovery(input: { isTxIdUsed: boolean }): RecoveryAction {
  return input.isTxIdUsed ? "ALREADY_MINTED" : "SKIP_0xE0";
}

export const UINT32_MAX = (1n << 32n) - 1n;

/** Validate a 0xE1 nonce jump before sending (guards on-chain InvalidNonceIncrease). */
export function validateFastForward(input: {
  currentNonce: bigint;
  newNonce: bigint;
  isTxIdUsed: boolean;
}): void {
  if (!input.isTxIdUsed) {
    throw new Error(
      "fast-forward (0xE1) is only valid after the stuck payment is confirmed minted — run 0xE0 recovery first",
    );
  }
  if (input.newNonce <= input.currentNonce) {
    throw new Error(`newNonce ${input.newNonce} must be strictly greater than current ${input.currentNonce}`);
  }
  if (input.newNonce - input.currentNonce > UINT32_MAX) {
    throw new Error("nonce jump exceeds uint32.max");
  }
}

/** Build the 0xE0 recovery memo targeting the stuck XRPL transaction id. */
export function buildSkipMemo(args: {
  walletId: number;
  executorFeeUBA: bigint;
  stuckTxId: Hex;
}): Hex {
  return encodeSkipMemo({
    walletId: args.walletId,
    executorFeeUBA: args.executorFeeUBA,
    targetTxId: args.stuckTxId,
  });
}

/** Build the 0xE1 fast-forward memo (after validation). */
export function buildFastForwardMemo(args: {
  walletId: number;
  executorFeeUBA: bigint;
  currentNonce: bigint;
  newNonce: bigint;
  isTxIdUsed: boolean;
}): Hex {
  validateFastForward({
    currentNonce: args.currentNonce,
    newNonce: args.newNonce,
    isTxIdUsed: args.isTxIdUsed,
  });
  return encodeFastForwardMemo({
    walletId: args.walletId,
    executorFeeUBA: args.executorFeeUBA,
    newNonce: args.newNonce,
  });
}
