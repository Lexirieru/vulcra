import { createRequire } from "node:module";
import type { Address, Hex } from "viem";

/**
 * A vault row as tracked by the indexer.
 *
 * Vault identity is the OWNER ADDRESS (one vault per address) — we key everything
 * by the lowercased owner. We deliberately do NOT store a collateral ratio: CR is
 * computed ON READ from the live FTSO price. We only persist the raw amounts plus
 * `nicr` (the price-free nominal collateral ratio) used as a fast pre-filter, and
 * the last block/tx we ingested for that vault.
 */
export interface VaultRow {
  /** Lowercased owner address (the vault key). */
  owner: string;
  /** FXRP collateral, 6 decimals. */
  collateral6: bigint;
  /** vUSD debt, 18 decimals. */
  debt18: bigint;
  /** Nominal individual collateral ratio (price-free); ascending nicr = ascending CR under single collateral. */
  nicr: bigint;
  /** Whether the vault is currently open. */
  active: boolean;
  /** Block number of the last event applied to this vault. */
  lastBlock: bigint;
  /** Transaction hash of the last event applied to this vault. */
  lastTxHash: string;
}

/**
 * Storage seam for the indexer. Two implementations exist:
 *   - `InMemoryVaultStore` — used by unit tests (no I/O, deterministic).
 *   - `SqliteVaultStore`   — used at runtime (Node's built-in `node:sqlite`).
 *
 * All bigints are handled as bigints across this interface. The SQLite backing
 * store persists them as TEXT (decimal strings) because vUSD debt (~1e20) exceeds
 * SQLite's signed 64-bit INTEGER range.
 */
export interface VaultStore {
  /** Insert or fully replace a vault row (keyed by `row.owner`). */
  upsertVault(row: VaultRow): void;
  /** Mark a vault inactive (VaultClosed / VaultLiquidated). No-op if unknown. */
  closeVault(owner: string): void;
  /** Fetch a single vault by owner (lowercased). */
  getVault(owner: string): VaultRow | undefined;
  /** All currently-active vaults, unordered. */
  listActive(): VaultRow[];
  /** Active vaults ordered ascending by nicr (riskiest first), optionally capped. */
  listAtRiskByNicr(limit?: number): VaultRow[];

  /** Next block to scan from (0 if never scanned). */
  getCursor(): bigint;
  /** Persist the next block to scan from. */
  setCursor(block: bigint): void;

  /** Idempotency guard — has this (txHash, logIndex) already been applied? */
  hasProcessed(txHash: string, logIndex: number): boolean;
  /** Record a (txHash, logIndex) as applied. */
  markProcessed(txHash: string, logIndex: number): void;
}

/** Sort active vaults ascending by nicr (riskiest first). Does not mutate input. */
function sortByNicrAsc(rows: VaultRow[]): VaultRow[] {
  return [...rows].sort((a, b) => (a.nicr < b.nicr ? -1 : a.nicr > b.nicr ? 1 : 0));
}

// ---------------------------------------------------------------------------
// In-memory implementation (tests)
// ---------------------------------------------------------------------------

export class InMemoryVaultStore implements VaultStore {
  private readonly vaults = new Map<string, VaultRow>();
  private readonly processed = new Set<string>();
  private cursor = 0n;

  upsertVault(row: VaultRow): void {
    const owner = row.owner.toLowerCase();
    this.vaults.set(owner, { ...row, owner });
  }

  closeVault(owner: string): void {
    const key = owner.toLowerCase();
    const existing = this.vaults.get(key);
    if (existing) this.vaults.set(key, { ...existing, active: false });
  }

  getVault(owner: string): VaultRow | undefined {
    const row = this.vaults.get(owner.toLowerCase());
    return row ? { ...row } : undefined;
  }

  listActive(): VaultRow[] {
    return [...this.vaults.values()].filter((v) => v.active).map((v) => ({ ...v }));
  }

  listAtRiskByNicr(limit?: number): VaultRow[] {
    const sorted = sortByNicrAsc(this.listActive());
    return limit === undefined ? sorted : sorted.slice(0, limit);
  }

  getCursor(): bigint {
    return this.cursor;
  }

  setCursor(block: bigint): void {
    this.cursor = block;
  }

  hasProcessed(txHash: string, logIndex: number): boolean {
    return this.processed.has(`${txHash.toLowerCase()}:${logIndex}`);
  }

  markProcessed(txHash: string, logIndex: number): void {
    this.processed.add(`${txHash.toLowerCase()}:${logIndex}`);
  }
}

// ---------------------------------------------------------------------------
// SQLite implementation (runtime) — Node's built-in node:sqlite (DatabaseSync)
// ---------------------------------------------------------------------------

/**
 * Minimal structural types for the parts of `node:sqlite` we use. We declare
 * these locally rather than depending on `@types/node` shipping the (still
 * experimental) sqlite typings, and we load the module lazily so that merely
 * importing this file (as the unit tests do) never touches node:sqlite.
 */
interface SqliteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}
interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}
interface SqliteModule {
  DatabaseSync: new (path: string) => SqliteDatabase;
}

export class SqliteVaultStore implements VaultStore {
  private readonly db: SqliteDatabase;

  constructor(dbPath: string) {
    // Lazy, synchronous load: only reached when a SqliteVaultStore is actually
    // constructed (never in tests). Throws a clear error if node:sqlite is
    // unavailable on this runtime.
    const req = createRequire(import.meta.url);
    let mod: SqliteModule;
    try {
      mod = req("node:sqlite") as SqliteModule;
    } catch (err) {
      throw new Error(
        "node:sqlite is unavailable — Node >= 22.5 with the experimental sqlite " +
          "feature is required for SqliteVaultStore. Original error: " +
          (err instanceof Error ? err.message : String(err)),
      );
    }
    this.db = new mod.DatabaseSync(dbPath);
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vaults (
        owner       TEXT PRIMARY KEY,
        collateral6 TEXT NOT NULL,
        debt18      TEXT NOT NULL,
        nicr        TEXT NOT NULL,
        active      INTEGER NOT NULL,
        lastBlock   TEXT NOT NULL,
        lastTxHash  TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS processed_logs (
        txHash   TEXT NOT NULL,
        logIndex INTEGER NOT NULL,
        PRIMARY KEY (txHash, logIndex)
      );
      CREATE TABLE IF NOT EXISTS cursor (
        id    INTEGER PRIMARY KEY CHECK (id = 0),
        block TEXT NOT NULL
      );
    `);
  }

  private static toRow(r: Record<string, unknown>): VaultRow {
    return {
      owner: String(r.owner),
      collateral6: BigInt(String(r.collateral6)),
      debt18: BigInt(String(r.debt18)),
      nicr: BigInt(String(r.nicr)),
      active: Number(r.active) !== 0,
      lastBlock: BigInt(String(r.lastBlock)),
      lastTxHash: String(r.lastTxHash),
    };
  }

  upsertVault(row: VaultRow): void {
    const owner = row.owner.toLowerCase();
    this.db
      .prepare(
        `INSERT INTO vaults (owner, collateral6, debt18, nicr, active, lastBlock, lastTxHash)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner) DO UPDATE SET
           collateral6 = excluded.collateral6,
           debt18      = excluded.debt18,
           nicr        = excluded.nicr,
           active      = excluded.active,
           lastBlock   = excluded.lastBlock,
           lastTxHash  = excluded.lastTxHash`,
      )
      .run(
        owner,
        row.collateral6.toString(),
        row.debt18.toString(),
        row.nicr.toString(),
        row.active ? 1 : 0,
        row.lastBlock.toString(),
        row.lastTxHash,
      );
  }

  closeVault(owner: string): void {
    this.db
      .prepare(`UPDATE vaults SET active = 0 WHERE owner = ?`)
      .run(owner.toLowerCase());
  }

  getVault(owner: string): VaultRow | undefined {
    const r = this.db
      .prepare(`SELECT * FROM vaults WHERE owner = ?`)
      .get(owner.toLowerCase());
    return r ? SqliteVaultStore.toRow(r) : undefined;
  }

  listActive(): VaultRow[] {
    return this.db
      .prepare(`SELECT * FROM vaults WHERE active = 1`)
      .all()
      .map((r) => SqliteVaultStore.toRow(r));
  }

  listAtRiskByNicr(limit?: number): VaultRow[] {
    // Sort in JS by BigInt nicr — TEXT-stored bigints do not sort numerically in SQL.
    const sorted = sortByNicrAsc(this.listActive());
    return limit === undefined ? sorted : sorted.slice(0, limit);
  }

  getCursor(): bigint {
    const r = this.db.prepare(`SELECT block FROM cursor WHERE id = 0`).get();
    return r ? BigInt(String(r.block)) : 0n;
  }

  setCursor(block: bigint): void {
    this.db
      .prepare(
        `INSERT INTO cursor (id, block) VALUES (0, ?)
         ON CONFLICT(id) DO UPDATE SET block = excluded.block`,
      )
      .run(block.toString());
  }

  hasProcessed(txHash: string, logIndex: number): boolean {
    const r = this.db
      .prepare(`SELECT 1 AS hit FROM processed_logs WHERE txHash = ? AND logIndex = ?`)
      .get(txHash.toLowerCase(), logIndex);
    return r !== undefined;
  }

  markProcessed(txHash: string, logIndex: number): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO processed_logs (txHash, logIndex) VALUES (?, ?)`,
      )
      .run(txHash.toLowerCase(), logIndex);
  }
}

export type { Address, Hex };
