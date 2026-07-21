import {
  decodeEventLog,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { assetManagerAbi, resolveContract } from "@vulcra/chain-client";
import { makeMintProcessor, type ProcessorHooks } from "./processor.js";
import {
  prepareXrpPaymentRequest,
  submitAttestation,
  waitFinalized,
  fetchProof,
  resolveFdcConfig,
  fdcHubAbi,
  type FdcConfig,
} from "./attestation/fdc.js";
import { submitDirectMinting } from "./submit.js";
import type { ExecuteOutcome } from "./orchestrator/orchestrator.js";
import type { MintStore } from "./orchestrator/store.js";
import type { ExecutorEnv } from "./env.js";

/** Direct-minting delay events (from the FAssets AssetManager) for outcome parsing. */
const delayEventAbi = [
  {
    type: "event",
    name: "DirectMintingDelayed",
    inputs: [
      { name: "transactionId", type: "bytes32", indexed: false },
      { name: "executionAllowedAt", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "LargeDirectMintingDelayed",
    inputs: [
      { name: "transactionId", type: "bytes32", indexed: false },
      { name: "executionAllowedAt", type: "uint256", indexed: false },
    ],
  },
] as const;

/**
 * Assemble the LIVE processor (R11). Fully wired: FDC XRPPayment attestation ->
 * executeDirectMintingWithData -> outcome (executed / delayed-retry / reverted).
 * GATED by env in main.ts; never mocked. Recovery (0xE0) broadcasts an XRPL
 * payment from the service wallet — that broadcast needs the `xrpl` client and a
 * funded SERVICE_XRPL_SEED, which is a documented operator step.
 */
export async function makeLiveProcessor(
  publicClient: PublicClient,
  walletClient: WalletClient,
  env: ExecutorEnv,
  store: MintStore,
): Promise<{ processMint: (id: string) => void }> {
  const account = walletClient.account;
  if (!account) throw new Error("wallet client has no account (EXECUTOR_PRIVATE_KEY missing)");
  const executorAddress = account.address as Address;

  const [assetManager, fdcFeeConfig, fdcConfig] = await Promise.all([
    resolveContract(publicClient, "AssetManagerFXRP"),
    resolveContract(publicClient, "FdcRequestFeeConfigurations"),
    resolveFdcConfig(publicClient, (n) => resolveContract(publicClient, n), {
      verifierUrl: env.verifierUrl!,
      verifierApiKey: env.verifierApiKey!,
      daLayerUrl: env.daLayerUrl!,
      firstVotingRoundStartTs: env.fdcFirstVotingRoundStartTs,
      votingEpochDurationSeconds: env.fdcVotingEpochDurationSeconds,
    }),
  ]);

  const walletSubmitAttestation = async (data: Hex): Promise<{ blockTimestamp: bigint }> => {
    // FdcHub charges a per-request fee; the amount is configured on the
    // FdcRequestFeeConfigurations contract (getRequestFee reverts on FdcHub).
    // Query it there and send it as msg.value (zero reverts with "fee to low").
    const fee =
      env.fdcRequestFeeWei ??
      ((await publicClient.readContract({
        address: fdcFeeConfig,
        abi: [
          {
            type: "function",
            name: "getRequestFee",
            stateMutability: "view",
            inputs: [{ name: "_data", type: "bytes" }],
            outputs: [{ name: "", type: "uint256" }],
          },
        ],
        functionName: "getRequestFee",
        args: [data],
      })) as bigint);
    const hash = await walletClient.writeContract({
      address: fdcConfig.fdcHub,
      abi: fdcHubAbi,
      functionName: "requestAttestation",
      args: [data],
      account,
      chain: walletClient.chain,
      value: fee,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
    return { blockTimestamp: block.timestamp };
  };

  // XRPL tx hashes are 32-byte hex; ensure the 0x prefix so viem treats them as
  // bytes32 (a bare 64-char hex is misread as bytes64).
  const asBytes32 = (t: string): Hex =>
    (t.startsWith("0x") ? t.toLowerCase() : "0x" + t.toLowerCase()) as Hex;

  const hooks: ProcessorHooks = {
    async attest(mint) {
      const abiEncodedRequest = await prepareXrpPaymentRequest(fdcConfig, {
        transactionId: asBytes32(mint.xrplTxId),
        proofOwner: executorAddress,
      });
      const { roundId } = await submitAttestation(publicClient, walletSubmitAttestation, fdcConfig, abiEncodedRequest);
      console.log(`[fdc] attestation submitted, votingRound=${roundId}; waiting for finalization`);
      await waitFinalized(publicClient, fdcConfig, roundId);
      // The DA layer indexes proofs shortly AFTER the round finalizes; poll
      // rather than failing on the first "not found" (which would otherwise
      // re-submit a brand-new attestation and never converge).
      let proof: unknown;
      let lastErr: unknown;
      for (let i = 0; i < 24; i++) {
        try {
          proof = await fetchProof(fdcConfig, roundId, abiEncodedRequest);
          break;
        } catch (err) {
          lastErr = err;
          console.log(`[fdc] proof not ready for round ${roundId} (try ${i + 1}), retrying in 10s`);
          await new Promise((r) => setTimeout(r, 10_000));
        }
      }
      if (!proof) throw lastErr;
      console.log(`[fdc] proof retrieved for round ${roundId}`);
      return { proof };
    },

    async submit({ proof, userOpBytes }): Promise<ExecuteOutcome> {
      try {
        const txHash = await submitDirectMinting(
          { publicClient, walletClient, assetManager },
          // _payment is the full IXRPPayment.Proof tuple {merkleProof, data}.
          { proof, userOpBytes },
        );
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        // A delay does NOT revert — scan the receipt for a delay event.
        for (const lg of receipt.logs) {
          try {
            const dec = decodeEventLog({ abi: delayEventAbi, data: lg.data, topics: lg.topics });
            const at = (dec.args as { executionAllowedAt?: bigint }).executionAllowedAt;
            if (at !== undefined) return { kind: "delayed", executionAllowedAt: at };
          } catch {
            /* not a delay event */
          }
        }
        return { kind: "executed", txHash };
      } catch (err) {
        return { kind: "reverted", error: (err as Error).message };
      }
    },

    scheduleRetry(atSeconds, fn) {
      const ms = Number(atSeconds * 1000n - BigInt(Date.now()));
      setTimeout(fn, Math.max(0, ms));
    },

    async isTxIdUsed(xrplTxId) {
      return (await publicClient.readContract({
        address: assetManager,
        abi: assetManagerAbi,
        functionName: "isTransactionIdUsed",
        args: [asBytes32(xrplTxId)],
      })) as boolean;
    },

    async recover() {
      throw new Error(
        "0xE0 recovery requires broadcasting an XRPL payment from SERVICE_XRPL_SEED via the `xrpl` client — " +
          "wire the XRPL broadcaster to enable automated recovery (operator step).",
      );
    },

    now: () => BigInt(Math.floor(Date.now() / 1000)),
    log: (m) => console.log(`[processor] ${m}`),
  };

  const processor = makeMintProcessor(store, hooks);
  return { processMint: (id: string) => void processor.processMint(id) };
}

export type { FdcConfig };
