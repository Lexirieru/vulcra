/**
 * FDC voting-round math (pure).
 * roundId = floor((blockTimestamp - firstVotingRoundStartTs) / votingEpochDurationSeconds)
 */
export function computeRoundId(args: {
  blockTimestamp: bigint;
  firstVotingRoundStartTs: bigint;
  votingEpochDurationSeconds: bigint;
}): bigint {
  if (args.votingEpochDurationSeconds <= 0n) {
    throw new Error("votingEpochDurationSeconds must be > 0");
  }
  if (args.blockTimestamp < args.firstVotingRoundStartTs) {
    throw new Error("blockTimestamp precedes the first voting round");
  }
  return (args.blockTimestamp - args.firstVotingRoundStartTs) / args.votingEpochDurationSeconds;
}

/**
 * Canonical FDC protocol id — used as the FALLBACK for the Relay finalization
 * check. The live value is read from `FdcVerification.fdcProtocolId()` in
 * `resolveFdcConfig` (drift-proof); this constant only applies if that read fails.
 */
export const FDC_PROTOCOL_ID = 200;
