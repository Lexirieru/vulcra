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

export interface FdcConfig {
  verifierUrl: string;
  verifierApiKey: string;
  daLayerUrl: string;
  fdcHub: Address;
  relay: Address;
  firstVotingRoundStartTs: bigint;
  votingEpochDurationSeconds: bigint;
  sourceId?: string; // "testXRP" on Coston2
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
    headers: { "Content-Type": "application/json", "X-apikey": cfg.verifierApiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`verifier prepareRequest failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { abiEncodedRequest?: Hex; status?: string };
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
      args: [BigInt(FDC_PROTOCOL_ID), roundId],
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
  const url = `${cfg.daLayerUrl.replace(/\/$/, "")}/api/v1/fdc/proof-by-request-round-raw`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ votingRoundId: Number(roundId), requestBytes }),
  });
  if (!res.ok) {
    throw new Error(`DA layer proof fetch failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { proof?: Hex[]; response?: unknown; response_hex?: Hex };
  if (!json.proof) {
    throw new Error("DA layer proof not available yet (retry after finalization)");
  }
  return { merkleProof: json.proof, data: json.response ?? json.response_hex };
}

export { fdcHubAbi, relayAbi };
