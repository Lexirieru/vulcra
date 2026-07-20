import type { Address, Hex, PublicClient } from "viem";
import { vaultManagerAbi } from "@vulcra/interfaces";
import type { VaultRow, VaultStore } from "./store.js";

/** Metadata every decoded log carries; also the idempotency key source. */
interface EventMeta {
  blockNumber: bigint;
  transactionHash: Hex;
  logIndex: number;
}

/**
 * A VaultManager event, normalized into a discriminated union that `applyEvent`
 * can consume without any viem/chain coupling (so it is trivially unit-testable).
 */
export type DecodedVaultEvent = EventMeta &
  (
    | { eventName: "VaultOpened"; owner: Address; collateral6: bigint; debt18: bigint; nicr: bigint }
    | { eventName: "VaultAdjusted"; owner: Address; collateral6: bigint; debt18: bigint; nicr: bigint }
    | { eventName: "VaultClosed"; owner: Address }
    | {
        eventName: "VaultLiquidated";
        owner: Address;
        liquidator: Address;
        debtCleared18: bigint;
        collateralToLiquidator6: bigint;
        collateralToOwner6: bigint;
      }
    | { eventName: "DelegatedRepay"; owner: Address; funder: Address; amount18: bigint }
    | { eventName: "Redeemed"; redeemer: Address; vusdAmount18: bigint; fxrpPaid6: bigint }
  );

/**
 * Apply a single decoded VaultManager event to the store. PURE with respect to
 * the chain: it only touches the injected store, so tests drive it directly.
 *
 * Idempotent on (transactionHash, logIndex): a replayed log is a no-op. Returns
 * `true` if the event was applied, `false` if it was skipped as a duplicate.
 *
 * Event handling:
 *   - VaultOpened / VaultAdjusted → upsert the row (active, latest amounts + nicr).
 *   - VaultClosed / VaultLiquidated → mark the vault inactive.
 *   - DelegatedRepay → reduce debt by the repaid amount and rescale nicr to match
 *     (nicr ∝ 1/debt at fixed collateral), so the pre-filter stays consistent.
 *   - Redeemed → protocol-level; carries no per-vault delta, so no row change.
 *
 * CR is never stored here — it is computed on read from the live FTSO price.
 */
export function applyEvent(store: VaultStore, event: DecodedVaultEvent): boolean {
  const { transactionHash, logIndex } = event;
  if (store.hasProcessed(transactionHash, logIndex)) return false;

  switch (event.eventName) {
    case "VaultOpened":
    case "VaultAdjusted": {
      store.upsertVault({
        owner: event.owner.toLowerCase(),
        collateral6: event.collateral6,
        debt18: event.debt18,
        nicr: event.nicr,
        active: true,
        lastBlock: event.blockNumber,
        lastTxHash: transactionHash,
      });
      break;
    }
    case "VaultClosed":
    case "VaultLiquidated": {
      store.closeVault(event.owner.toLowerCase());
      break;
    }
    case "DelegatedRepay": {
      const existing = store.getVault(event.owner);
      if (existing) {
        const newDebt18 = existing.debt18 > event.amount18 ? existing.debt18 - event.amount18 : 0n;
        // nicr ∝ 1/debt at fixed collateral; rescale to keep it consistent.
        const newNicr =
          newDebt18 > 0n && existing.debt18 > 0n
            ? (existing.nicr * existing.debt18) / newDebt18
            : existing.nicr;
        const updated: VaultRow = {
          ...existing,
          debt18: newDebt18,
          nicr: newNicr,
          lastBlock: event.blockNumber,
          lastTxHash: transactionHash,
        };
        store.upsertVault(updated);
      }
      break;
    }
    case "Redeemed": {
      // Protocol-level redemption; no per-vault row change to make here.
      break;
    }
  }

  store.markProcessed(transactionHash, logIndex);
  return true;
}

// ---------------------------------------------------------------------------
// Live polling (thin; NOT unit-tested against a live chain)
// ---------------------------------------------------------------------------

const VAULT_EVENT_ABI = vaultManagerAbi.filter(
  (item): item is Extract<(typeof vaultManagerAbi)[number], { type: "event" }> =>
    item.type === "event",
);

/** Shape of the raw fields we read off a viem decoded log. */
interface RawLog {
  eventName?: string;
  args?: Record<string, unknown>;
  blockNumber?: bigint | null;
  transactionHash?: Hex | null;
  logIndex?: number | null;
}

/** Normalize a viem decoded log into our DecodedVaultEvent, or null if unusable. */
export function decodeLog(log: RawLog): DecodedVaultEvent | null {
  const { eventName, args, blockNumber, transactionHash, logIndex } = log;
  if (
    !eventName ||
    !args ||
    blockNumber == null ||
    transactionHash == null ||
    logIndex == null
  ) {
    return null;
  }
  const meta: EventMeta = { blockNumber, transactionHash, logIndex };
  const a = args;
  switch (eventName) {
    case "VaultOpened":
    case "VaultAdjusted":
      return {
        ...meta,
        eventName,
        owner: a.owner as Address,
        collateral6: a.collateral6 as bigint,
        debt18: a.debt18 as bigint,
        nicr: a.nicr as bigint,
      };
    case "VaultClosed":
      return { ...meta, eventName, owner: a.owner as Address };
    case "VaultLiquidated":
      return {
        ...meta,
        eventName,
        owner: a.owner as Address,
        liquidator: a.liquidator as Address,
        debtCleared18: a.debtCleared18 as bigint,
        collateralToLiquidator6: a.collateralToLiquidator6 as bigint,
        collateralToOwner6: a.collateralToOwner6 as bigint,
      };
    case "DelegatedRepay":
      return {
        ...meta,
        eventName,
        owner: a.owner as Address,
        funder: a.funder as Address,
        amount18: a.amount18 as bigint,
      };
    case "Redeemed":
      return {
        ...meta,
        eventName,
        redeemer: a.redeemer as Address,
        vusdAmount18: a.vusdAmount18 as bigint,
        fxrpPaid6: a.fxrpPaid6 as bigint,
      };
    default:
      return null;
  }
}

export interface PollOptions {
  /** Confirmation lag: only scan up to `head - confirmations`. */
  confirmations: number;
  /** Cap on blocks scanned per call so a single poll never requests an unbounded range. */
  maxBlocksPerPoll?: bigint;
}

export interface PollResult {
  fromBlock: bigint;
  toBlock: bigint;
  applied: number;
  scannedLogs: number;
}

/**
 * Read new VaultManager logs from the cursor (with a confirmation lag) and apply
 * them. Live and intentionally thin — do NOT unit-test this against a real chain.
 */
export async function pollOnce(
  client: PublicClient,
  store: VaultStore,
  vaultManagerAddress: Address,
  opts: PollOptions,
): Promise<PollResult> {
  const head = await client.getBlockNumber();
  const confirmations = BigInt(opts.confirmations);
  if (head < confirmations) {
    const cur = store.getCursor();
    return { fromBlock: cur, toBlock: cur, applied: 0, scannedLogs: 0 };
  }
  const safeHead = head - confirmations;
  const fromBlock = store.getCursor();
  if (fromBlock > safeHead) {
    return { fromBlock, toBlock: fromBlock, applied: 0, scannedLogs: 0 };
  }

  const maxSpan = opts.maxBlocksPerPoll ?? 9_000n;
  const toBlock = safeHead - fromBlock > maxSpan ? fromBlock + maxSpan : safeHead;

  const logs = (await client.getLogs({
    address: vaultManagerAddress,
    events: VAULT_EVENT_ABI,
    fromBlock,
    toBlock,
  })) as RawLog[];

  let applied = 0;
  for (const log of logs) {
    const decoded = decodeLog(log);
    if (decoded && applyEvent(store, decoded)) applied += 1;
  }

  store.setCursor(toBlock + 1n);
  return { fromBlock, toBlock, applied, scannedLogs: logs.length };
}
