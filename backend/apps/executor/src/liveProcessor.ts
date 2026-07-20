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

  const [assetManager, fdcConfig] = await Promise.all([
    resolveContract(publicClient, "AssetManagerFXRP"),
    resolveFdcConfig(publicClient, (n) => resolveContract(publicClient, n), {
      verifierUrl: env.verifierUrl!,
      verifierApiKey: env.verifierApiKey!,
      daLayerUrl: env.daLayerUrl!,
      firstVotingRoundStartTs: env.fdcFirstVotingRoundStartTs,
      votingEpochDurationSeconds: env.fdcVotingEpochDurationSeconds,
    }),
  ]);

  const walletSubmitAttestation = async (data: Hex): Promise<{ blockTimestamp: bigint }> => {
    const hash = await walletClient.writeContract({
      address: fdcConfig.fdcHub,
      abi: fdcHubAbi,
      functionName: "requestAttestation",
      args: [data],
      account,
      chain: walletClient.chain,
      value: env.fdcRequestFeeWei ?? 0n,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
    return { blockTimestamp: block.timestamp };
  };

  const hooks: ProcessorHooks = {
    async attest(mint) {
      const abiEncodedRequest = await prepareXrpPaymentRequest(fdcConfig, {
        transactionId: mint.xrplTxId as Hex,
        proofOwner: executorAddress,
      });
      const { roundId } = await submitAttestation(publicClient, walletSubmitAttestation, fdcConfig, abiEncodedRequest);
      await waitFinalized(publicClient, fdcConfig, roundId);
      const proof = await fetchProof(fdcConfig, roundId, abiEncodedRequest);
      return { proof };
    },

    async submit({ proof, userOpBytes }): Promise<ExecuteOutcome> {
      try {
        const txHash = await submitDirectMinting(
          { publicClient, walletClient, assetManager },
          { proof: (proof as { data?: unknown }).data ?? proof, userOpBytes },
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
        args: [xrplTxId as Hex],
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
