import type { Address, Hex, PublicClient } from "viem";
import { vaultManagerAbi } from "@vulcra/interfaces";
import type { VaultStore } from "./store.js";

/**
 * Metadata every decoded log carries; also the idempotency key source.
 *
 * `blockTimestamp` is NOT present on a raw viem log — `pollOnce` attaches it (one
 * `getBlock` per unique block number). It is the accrual origin the store records
 * as `lastAccrualTs` for debt-updating events.
 */
interface EventMeta {
  blockNumber: bigint;
  blockTimestamp: bigint;
  transactionHash: Hex;
  logIndex: number;
}

/**
 * A V2 VaultManager event, normalized into a discriminated union that `applyEvent`
 * can consume without any viem/chain coupling (so it is trivially unit-testable).
 */
export type DecodedVaultEvent = EventMeta &
  (
    | { eventName: "VaultOpened"; owner: Address; collateral6: bigint; debt18: bigint; annualInterestRateBps: bigint }
    | { eventName: "CollateralAdded"; owner: Address; amount6: bigint; newCollateral6: bigint }
    | { eventName: "CollateralWithdrawn"; owner: Address; amount6: bigint; newCollateral6: bigint }
    | { eventName: "DebtMinted"; owner: Address; minted18: bigint; fee18: bigint; newDebt18: bigint }
    | { eventName: "DebtRepaid"; owner: Address; amount18: bigint; newDebt18: bigint }
    | { eventName: "InterestRateAdjusted"; owner: Address; newAnnualInterestRateBps: bigint; newDebt18: bigint }
    | { eventName: "VaultClosed"; owner: Address; collateralReturned6: bigint; debtBurned18: bigint }
    | {
        eventName: "VaultLiquidated";
        owner: Address;
        liquidator: Address;
        debtCleared18: bigint;
        collateralToLiquidator6: bigint;
        collateralToOwner6: bigint;
      }
    | { eventName: "Redemption"; redeemer: Address; vusdRedeemed18: bigint; collateralPaid6: bigint; fee6: bigint }
    | { eventName: "DelegatedRepay"; owner: Address; funder: Address; amount18: bigint }
  );

/**
 * Apply a single decoded V2 VaultManager event to the store. PURE with respect to
 * the chain: it only touches the injected store, so tests drive it directly.
 *
 * Idempotent on (transactionHash, logIndex): a replayed log is a no-op. Returns
 * `true` if the event was applied, `false` if it was skipped as a duplicate.
 *
 * Event handling (V2 — user-set interest rates, by-rate redemption):
 *   - VaultOpened → upsert the row (active; records debt18, rateBps = annual rate,
 *     lastAccrualTs = block timestamp).
 *   - DebtMinted / DebtRepaid → debt18 = newDebt18; lastAccrualTs = block timestamp
 *     (rate unchanged).
 *   - InterestRateAdjusted → rateBps = new rate; debt18 = newDebt18;
 *     lastAccrualTs = block timestamp.
 *   - CollateralAdded / CollateralWithdrawn → collateral6 = newCollateral6 only.
 *     debt18 and lastAccrualTs are left untouched: the recorded debt keeps accruing
 *     from its last debt-event timestamp, which is exactly correct here.
 *   - VaultClosed / VaultLiquidated → mark the vault inactive.
 *   - DelegatedRepay → reduce debt18 by amount18 (floored at 0);
 *     lastAccrualTs = block timestamp.
 *   - Redemption → protocol-level; the event carries no per-vault delta, so no row
 *     change is made. A later per-vault event (e.g. CollateralWithdrawn / DebtRepaid
 *     emitted by the redemption path, or a re-read) reconciles the touched vaults.
 *
 * CR is never stored here — it is computed on read from the live FTSO price and the
 * accrued current debt.
 */
export function applyEvent(store: VaultStore, event: DecodedVaultEvent): boolean {
  const { transactionHash, logIndex } = event;
  if (store.hasProcessed(transactionHash, logIndex)) return false;

  switch (event.eventName) {
    case "VaultOpened": {
      store.upsertVault({
        owner: event.owner.toLowerCase(),
        collateral6: event.collateral6,
        debt18: event.debt18,
        rateBps: event.annualInterestRateBps,
        lastAccrualTs: event.blockTimestamp,
        active: true,
        lastBlock: event.blockNumber,
        lastTxHash: transactionHash,
      });
      break;
    }
    case "DebtMinted":
    case "DebtRepaid": {
      const existing = store.getVault(event.owner);
      if (existing) {
        store.upsertVault({
          ...existing,
          debt18: event.newDebt18,
          lastAccrualTs: event.blockTimestamp,
          lastBlock: event.blockNumber,
          lastTxHash: transactionHash,
        });
      }
      break;
    }
    case "InterestRateAdjusted": {
      const existing = store.getVault(event.owner);
      if (existing) {
        store.upsertVault({
          ...existing,
          rateBps: event.newAnnualInterestRateBps,
          debt18: event.newDebt18,
          lastAccrualTs: event.blockTimestamp,
          lastBlock: event.blockNumber,
          lastTxHash: transactionHash,
        });
      }
      break;
    }
    case "CollateralAdded":
    case "CollateralWithdrawn": {
      const existing = store.getVault(event.owner);
      if (existing) {
        store.upsertVault({
          ...existing,
          collateral6: event.newCollateral6,
          // debt18 / lastAccrualTs deliberately unchanged — accrual continues.
          lastBlock: event.blockNumber,
          lastTxHash: transactionHash,
        });
      }
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
        store.upsertVault({
          ...existing,
          debt18: newDebt18,
          lastAccrualTs: event.blockTimestamp,
          lastBlock: event.blockNumber,
          lastTxHash: transactionHash,
        });
      }
      break;
    }
    case "Redemption": {
      // Protocol-level redemption; no per-vault delta available from this event.
      // Touched vaults reconcile via their own subsequent events (or a re-read).
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

/** Shape of the raw fields we read off a viem decoded log (+ the ts pollOnce attaches). */
interface RawLog {
  eventName?: string;
  args?: Record<string, unknown>;
  blockNumber?: bigint | null;
  /** Attached by pollOnce (viem logs do not carry a block timestamp). */
  blockTimestamp?: bigint | null;
  transactionHash?: Hex | null;
  logIndex?: number | null;
}

/** Normalize a viem decoded log into our DecodedVaultEvent, or null if unusable. */
export function decodeLog(log: RawLog): DecodedVaultEvent | null {
  const { eventName, args, blockNumber, blockTimestamp, transactionHash, logIndex } = log;
  if (
    !eventName ||
    !args ||
    blockNumber == null ||
    blockTimestamp == null ||
    transactionHash == null ||
    logIndex == null
  ) {
    return null;
  }
  const meta: EventMeta = { blockNumber, blockTimestamp, transactionHash, logIndex };
  const a = args;
  switch (eventName) {
    case "VaultOpened":
      return {
        ...meta,
        eventName,
        owner: a.owner as Address,
        collateral6: a.collateral6 as bigint,
        debt18: a.debt18 as bigint,
        annualInterestRateBps: a.annualInterestRateBps as bigint,
      };
    case "CollateralAdded":
      return {
        ...meta,
        eventName,
        owner: a.owner as Address,
        amount6: a.amount6 as bigint,
        newCollateral6: a.newCollateral6 as bigint,
      };
    case "CollateralWithdrawn":
      return {
        ...meta,
        eventName,
        owner: a.owner as Address,
        amount6: a.amount6 as bigint,
        newCollateral6: a.newCollateral6 as bigint,
      };
    case "DebtMinted":
      return {
        ...meta,
        eventName,
        owner: a.owner as Address,
        minted18: a.minted18 as bigint,
        fee18: a.fee18 as bigint,
        newDebt18: a.newDebt18 as bigint,
      };
    case "DebtRepaid":
      return {
        ...meta,
        eventName,
        owner: a.owner as Address,
        amount18: a.amount18 as bigint,
        newDebt18: a.newDebt18 as bigint,
      };
    case "InterestRateAdjusted":
      return {
        ...meta,
        eventName,
        owner: a.owner as Address,
        newAnnualInterestRateBps: a.newAnnualInterestRateBps as bigint,
        newDebt18: a.newDebt18 as bigint,
      };
    case "VaultClosed":
      return {
        ...meta,
        eventName,
        owner: a.owner as Address,
        collateralReturned6: a.collateralReturned6 as bigint,
        debtBurned18: a.debtBurned18 as bigint,
      };
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
    case "Redemption":
      return {
        ...meta,
        eventName,
        redeemer: a.redeemer as Address,
        vusdRedeemed18: a.vusdRedeemed18 as bigint,
        collateralPaid6: a.collateralPaid6 as bigint,
        fee6: a.fee6 as bigint,
      };
    case "DelegatedRepay":
      return {
        ...meta,
        eventName,
        owner: a.owner as Address,
        funder: a.funder as Address,
        amount18: a.amount18 as bigint,
      };
    default:
      // Unhandled events (e.g. AggInterestMinted) carry no per-vault state.
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
 *
 * V2 debt accrual is timestamp-driven, so each event needs its block timestamp.
 * viem logs don't carry one, so we resolve it via `getBlock({ blockNumber })`,
 * cached per unique block number for this poll (bounded by the scanned span).
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

  // Resolve block timestamps once per unique block number (bounded by the span).
  const tsCache = new Map<bigint, bigint>();
  const blockTimestamp = async (bn: bigint): Promise<bigint> => {
    const cached = tsCache.get(bn);
    if (cached !== undefined) return cached;
    const block = await client.getBlock({ blockNumber: bn });
    const ts = block.timestamp as bigint;
    tsCache.set(bn, ts);
    return ts;
  };

  let applied = 0;
  for (const log of logs) {
    if (log.blockNumber != null) {
      log.blockTimestamp = await blockTimestamp(log.blockNumber);
    }
    const decoded = decodeLog(log);
    if (decoded && applyEvent(store, decoded)) applied += 1;
  }

  store.setCursor(toBlock + 1n);
  return { fromBlock, toBlock, applied, scannedLogs: logs.length };
}
