import type { Hex } from "viem";
import type { MintStore } from "./orchestrator/store.js";
import {
  applyExecuteOutcome,
  beginExecute,
  beginRetry,
  type ExecuteOutcome,
} from "./orchestrator/orchestrator.js";
import { decideRecovery } from "./recovery/recovery.js";

/**
 * Mint processor — the live pipeline that turns an intaken mint into an on-chain
 * FXRP mint (R11):
 *   attestation (FDC XRPPayment) -> executeDirectMintingWithData -> outcome
 *   -> on DirectMintingDelayed: retry the SAME proof at executionAllowedAt (AE1)
 *   -> on revert: 0xE0 recovery (AE4)
 *
 * Chain I/O is injected (attest/submit/scheduleRetry/recover) so the control flow
 * is unit-testable without a live chain. In production these are the real FDC +
 * AssetManager calls (never mocked); the processor is only WIRED when a funded
 * executor key + verifier/DA config are present — otherwise the mint stays queued
 * with a gated status.
 */
export interface ProcessorHooks {
  /** Obtain a finalized FDC XRPPayment proof for the mint's XRPL tx. */
  attest(mint: { xrplTxId: string }): Promise<{ proof: unknown }>;
  /** Submit executeDirectMintingWithData(proof, userOpBytes); returns the outcome. */
  submit(args: { proof: unknown; userOpBytes: Hex }): Promise<ExecuteOutcome>;
  /** Schedule fn to run at/after `atSeconds` (setTimeout in prod). */
  scheduleRetry(atSeconds: bigint, fn: () => void): void;
  /** Whether the stuck XRPL tx id is already used on-chain (isTransactionIdUsed). */
  isTxIdUsed(xrplTxId: string): Promise<boolean>;
  /** Run the 0xE0 recovery for a reverted/stuck mint (service XRPL wallet). */
  recover(mint: { id: string; xrplTxId: string; userOpBytes: Hex }): Promise<void>;
  now(): bigint;
  log?: (msg: string) => void;
}

export function makeMintProcessor(store: MintStore, hooks: ProcessorHooks) {
  const log = hooks.log ?? (() => {});

  async function runFromProofReady(id: string, proof: unknown): Promise<void> {
    const rec = store.get(id);
    if (!rec) return;
    if (rec.state === "PROOF_READY") beginExecute(store, id);

    const outcome = await hooks.submit({ proof, userOpBytes: rec.userOpBytes });
    const updated = applyExecuteOutcome(store, id, outcome);

    if (outcome.kind === "delayed") {
      log(`[${id}] delayed until ${outcome.executionAllowedAt}; will retry same proof`);
      hooks.scheduleRetry(outcome.executionAllowedAt, () => {
        beginRetry(store, id);
        void runFromProofReady(id, proof); // SAME proof (AE1)
      });
    } else if (outcome.kind === "reverted") {
      log(`[${id}] reverted: ${updated.lastError}; entering recovery`);
      await recover(id);
    } else {
      log(`[${id}] executed: ${outcome.txHash}`);
    }
  }

  async function recover(id: string): Promise<void> {
    const rec = store.get(id);
    if (!rec) return;
    const used = await hooks.isTxIdUsed(rec.xrplTxId);
    const action = decideRecovery({ isTxIdUsed: used });
    if (action === "ALREADY_MINTED") {
      log(`[${id}] stuck tx already minted; no recovery needed`);
      return;
    }
    await hooks.recover({ id, xrplTxId: rec.xrplTxId, userOpBytes: rec.userOpBytes });
  }

  /** Entry point: drive a freshly-intaken mint to completion. */
  async function processMint(id: string): Promise<void> {
    const rec = store.get(id);
    if (!rec) return;
    if (rec.state === "REJECTED") return;
    try {
      const { proof } = await hooks.attest({ xrplTxId: rec.xrplTxId });
      // mark proof ready then execute
      store.update(id, { state: "PROOF_READY", proofJson: JSON.stringify(serializeProof(proof)) });
      await runFromProofReady(id, proof);
    } catch (err) {
      store.update(id, { lastError: (err as Error).message });
      log(`[${id}] pipeline error: ${(err as Error).message}`);
    }
  }

  return { processMint };
}

function serializeProof(proof: unknown): unknown {
  return JSON.parse(JSON.stringify(proof, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}
