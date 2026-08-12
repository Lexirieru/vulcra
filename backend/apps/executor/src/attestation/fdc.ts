import { stringToHex, type Address, type Hex, type PublicClient } from "viem";
import { computeRoundId, FDC_PROTOCOL_ID } from "./roundId.js";

/**
 * FDC XRPPayment attestation client (R11) — LIVE path, gated by verifier/DA env.
 *
 * Flow (per the flare-fdc skill): prepareRequest (verifier) -> requestAttestation
 * (FdcHub) -> compute roundId -> Relay.isFinalized(200, roundId) -> fetch proof
 * (DA layer) -> decoded IXRPPayment.Proof for executeDirectMintingWithData.
 *
 * Not mocked. Verifier/DA response shapes and FdcHub/Relay ABIs are per the
 * Coston2 testnet docs; VERIFY at integration against the live services.
 */

const fdcHubAbi = [
  {
    type: "function",
    name: "requestAttestation",
    stateMutability: "payable",
    inputs: [{ name: "_data", type: "bytes" }],
    outputs: [],
  },
] as const;

const relayAbi = [
  {
    type: "function",
    name: "isFinalized",
    stateMutability: "view",
    inputs: [
      { name: "_protocolId", type: "uint256" },
      { name: "_votingRoundId", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const fdcVerificationAbi = [
  {
    type: "function",
    name: "fdcProtocolId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

export interface FdcConfig {
  verifierUrl: string;
  verifierApiKey: string;
  daLayerUrl: string;
  fdcHub: Address;
  relay: Address;
  /**
   * FDC protocol id for the Relay finalization check. Read live from
   * FdcVerification.fdcProtocolId() (drift-proof, single source of truth), with
   * the canonical 200 as a fallback if the read fails.
   */
  protocolId: bigint;
  firstVotingRoundStartTs: bigint;
  votingEpochDurationSeconds: bigint;
  sourceId?: string; // "testXRP" on Coston2
}

/**
 * Resolve the live FDC config: FdcHub + Relay from FlareContractRegistry, verifier/DA
 * from env, and the voting-round timing from FlareSystemsManager (with env override /
 * Coston2 default of 90s epochs). Endpoint format is verified live: the XRPPayment
 * verifier is `${verifierUrl}/verifier/xrp/XRPPayment/prepareRequest` and returns
 * `{ status: "VALID"|"INVALID: ...", abiEncodedRequest }`.
 */
export async function resolveFdcConfig(
  publicClient: PublicClient,
  resolve: (name: string) => Promise<Address>,
  env: {
    verifierUrl: string;
    verifierApiKey: string;
    daLayerUrl: string;
    firstVotingRoundStartTs?: bigint;
    votingEpochDurationSeconds?: bigint;
    sourceId?: string;
  },
): Promise<FdcConfig> {
  const [fdcHub, relay] = await Promise.all([resolve("FdcHub"), resolve("Relay")]);
  // Read the FDC protocol id from FdcVerification (drift-proof) rather than
  // hardcoding it; fall back to the canonical 200 if the read fails.
  let protocolId = BigInt(FDC_PROTOCOL_ID);
  try {
    const fdcVerification = await resolve("FdcVerification");
    protocolId = BigInt(
      (await publicClient.readContract({
        address: fdcVerification,
        abi: fdcVerificationAbi,
        functionName: "fdcProtocolId",
        args: [],
      })) as number,
    );
  } catch {
    // leave the canonical 200 fallback.
  }
  let firstVotingRoundStartTs = env.firstVotingRoundStartTs ?? 0n;
  let votingEpochDurationSeconds = env.votingEpochDurationSeconds ?? 90n;
  if (firstVotingRoundStartTs === 0n) {
    try {
      const fsm = await resolve("FlareSystemsManager");
      firstVotingRoundStartTs = (await publicClient.readContract({
        address: fsm,
        abi: [
          {
            type: "function",
            name: "firstVotingRoundStartTs",
            stateMutability: "view",
            inputs: [],
            outputs: [{ name: "", type: "uint64" }],
          },
        ] as const,
        functionName: "firstVotingRoundStartTs",
        args: [],
      })) as bigint;
    } catch {
      // leave 0n; caller must supply FDC_FIRST_VOTING_ROUND_START_TS for a real submit.
    }
  }
  return {
    verifierUrl: env.verifierUrl,
    verifierApiKey: env.verifierApiKey,
    daLayerUrl: env.daLayerUrl,
    fdcHub,
    relay,
    protocolId,
    firstVotingRoundStartTs,
    votingEpochDurationSeconds,
    sourceId: env.sourceId,
  };
}

export interface XrpPaymentProof {
  merkleProof: Hex[];
  data: unknown; // decoded IXRPPayment.Proof response body — passed to executeDirectMintingWithData
}

/** Prepare the ABI-encoded attestation request from the verifier. */
export async function prepareXrpPaymentRequest(
  cfg: FdcConfig,
  args: { transactionId: Hex; proofOwner: Address },
): Promise<Hex> {
  const url = `${cfg.verifierUrl.replace(/\/$/, "")}/verifier/xrp/XRPPayment/prepareRequest`;
  const body = {
    attestationType: stringToHex("XRPPayment", { size: 32 }),
    sourceId: stringToHex(cfg.sourceId ?? "testXRP", { size: 32 }),
    requestBody: {
      transactionId: args.transactionId,
      proofOwner: args.proofOwner,
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": cfg.verifierApiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`verifier prepareRequest failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { abiEncodedRequest?: Hex; status?: string };
  // The verifier returns { status: "VALID", abiEncodedRequest } or
  // { status: "INVALID: TRANSACTION DOES NOT EXIST" } (200) — surface INVALID clearly.
  if (json.status && json.status.toUpperCase().startsWith("INVALID")) {
    throw new Error(`verifier rejected XRPPayment ${args.transactionId}: ${json.status}`);
  }
  if (!json.abiEncodedRequest) {
    throw new Error(`verifier returned no abiEncodedRequest (status=${json.status ?? "?"})`);
  }
  return json.abiEncodedRequest;
}

/** Submit the request to FdcHub and derive the voting round id from the receipt. */
export async function submitAttestation(
  publicClient: PublicClient,
  walletSubmit: (data: Hex) => Promise<{ blockTimestamp: bigint }>,
  cfg: FdcConfig,
  abiEncodedRequest: Hex,
): Promise<{ roundId: bigint }> {
  const { blockTimestamp } = await walletSubmit(abiEncodedRequest);
  const roundId = computeRoundId({
    blockTimestamp,
    firstVotingRoundStartTs: cfg.firstVotingRoundStartTs,
    votingEpochDurationSeconds: cfg.votingEpochDurationSeconds,
  });
  return { roundId };
}

/** Poll Relay.isFinalized(200, roundId). Rounds finalize in ~90-180s. */
export async function waitFinalized(
  publicClient: PublicClient,
  cfg: FdcConfig,
  roundId: bigint,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<void> {
  const interval = opts.intervalMs ?? 5_000;
  const deadline = Date.now() + (opts.timeoutMs ?? 300_000);
  for (;;) {
    const finalized = (await publicClient.readContract({
      address: cfg.relay,
      abi: relayAbi,
      functionName: "isFinalized",
      args: [cfg.protocolId, roundId],
    })) as boolean;
    if (finalized) return;
    if (Date.now() > deadline) throw new Error(`round ${roundId} not finalized before timeout`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

/** Fetch the Merkle proof + decoded response from the DA layer. */
export async function fetchProof(
  cfg: FdcConfig,
  roundId: bigint,
  requestBytes: Hex,
): Promise<XrpPaymentProof> {
  const url = `${cfg.daLayerUrl.replace(/\/$/, "")}/api/v1/fdc/proof-by-request-round`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": cfg.verifierApiKey,
    },
    body: JSON.stringify({ votingRoundId: Number(roundId), requestBytes }),
  });
  if (!res.ok) {
    throw new Error(`DA layer proof fetch failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { proof?: Hex[]; response?: unknown; response_hex?: Hex };
  if (!json.proof) {
    throw new Error("DA layer proof not available yet (retry after finalization)");
  }
  // `response` is the DA layer's decoded IXRPPayment.Proof object — the shape viem
  // encodes for executeDirectMintingWithData (proven live). Do NOT fall back to the
  // raw `response_hex` blob: it is ABI-encoded bytes, not the tuple object, so viem
  // would mis-encode it. If a DA layer ever omits `response`, switch this call to the
  // `/proof-by-request-round-raw` endpoint and decode `response_hex` via the periphery
  // `ixrpPaymentVerificationAbi` (flare-viem-starter pattern) rather than passing raw hex.
  if (json.response === undefined) {
    throw new Error(
      "DA layer returned a proof without a decoded `response` object; the raw `response_hex` " +
        "cannot be passed to executeDirectMintingWithData directly (use the *-raw endpoint + " +
        "periphery decode).",
    );
  }
  return { merkleProof: json.proof, data: json.response };
}

export { fdcHubAbi, relayAbi };
