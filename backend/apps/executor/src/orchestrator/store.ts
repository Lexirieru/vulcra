import type { MintRecord, MintState } from "./state.js";

/**
 * Durable mint store. The in-memory implementation backs unit tests; the
 * node:sqlite implementation gives crash-durability so a DELAYED/RECOVERING
 * mint resumes with the SAME proof after a restart (KTD2).
 */
export interface MintStore {
  create(record: MintRecord): void;
  get(id: string): MintRecord | undefined;
  getByXrplTxId(xrplTxId: string): MintRecord | undefined;
  update(id: string, patch: Partial<MintRecord>): MintRecord;
  /** Records that are DELAYED and whose executionAllowedAt has passed. */
  dueRetries(nowSeconds: bigint): MintRecord[];
  /** Non-terminal records to resume on boot. */
  resumable(): MintRecord[];
}

export class InMemoryMintStore implements MintStore {
  private readonly byId = new Map<string, MintRecord>();
  private readonly byTx = new Map<string, string>();

  create(record: MintRecord): void {
    if (this.byId.has(record.id)) throw new Error(`mint ${record.id} already exists`);
    this.byId.set(record.id, { ...record });
    this.byTx.set(record.xrplTxId.toLowerCase(), record.id);
  }

  get(id: string): MintRecord | undefined {
    const r = this.byId.get(id);
    return r ? { ...r } : undefined;
  }

  getByXrplTxId(xrplTxId: string): MintRecord | undefined {
    const id = this.byTx.get(xrplTxId.toLowerCase());
    return id ? this.get(id) : undefined;
  }

  update(id: string, patch: Partial<MintRecord>): MintRecord {
    const existing = this.byId.get(id);
    if (!existing) throw new Error(`mint ${id} not found`);
    const updated: MintRecord = { ...existing, ...patch, updatedAt: Date.now() };
    this.byId.set(id, updated);
    return { ...updated };
  }

  dueRetries(nowSeconds: bigint): MintRecord[] {
    return [...this.byId.values()]
      .filter(
        (r) =>
          r.state === "DELAYED" &&
          r.executionAllowedAt !== undefined &&
          r.executionAllowedAt <= nowSeconds,
      )
      .map((r) => ({ ...r }));
  }

  resumable(): MintRecord[] {
    const active: MintState[] = [
      "INTAKE",
      "ATTEST_REQUESTED",
      "ATTEST_FINALIZING",
      "PROOF_READY",
      "EXECUTING",
      "DELAYED",
      "REVERTED",
      "RECOVERING",
    ];
    return [...this.byId.values()].filter((r) => active.includes(r.state)).map((r) => ({ ...r }));
  }
}

/**
 * node:sqlite-backed store (Node >= 22). Lazily imported so unit tests (which
 * use InMemoryMintStore) never depend on the experimental module. Same schema
 * mirrors MintRecord; bigint fields stored as TEXT.
 */
export async function createSqliteMintStore(dbPath: string): Promise<MintStore> {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS mints (
      id TEXT PRIMARY KEY,
      xrplTxId TEXT UNIQUE NOT NULL,
      userOpBytes TEXT NOT NULL,
      userOpHash TEXT NOT NULL,
      state TEXT NOT NULL,
      proofJson TEXT,
      executionAllowedAt TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      lastError TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
  `);

  type Row = {
    id: string;
    xrplTxId: string;
    userOpBytes: string;
    userOpHash: string;
    state: string;
    proofJson: string | null;
    executionAllowedAt: string | null;
    attempts: number;
    lastError: string | null;
    createdAt: number;
    updatedAt: number;
  };

  const toRecord = (row: Row): MintRecord => ({
    id: row.id,
    xrplTxId: row.xrplTxId,
    userOpBytes: row.userOpBytes as `0x${string}`,
    userOpHash: row.userOpHash as `0x${string}`,
    state: row.state as MintState,
    proofJson: row.proofJson ?? undefined,
    executionAllowedAt: row.executionAllowedAt !== null ? BigInt(row.executionAllowedAt) : undefined,
    attempts: row.attempts,
    lastError: row.lastError ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  const getRec = (id: string): MintRecord | undefined => {
    const row = db.prepare(`SELECT * FROM mints WHERE id = ?`).get(id) as Row | undefined;
    return row ? toRecord(row) : undefined;
  };

  return {
    create(record) {
      db.prepare(
        `INSERT INTO mints (id, xrplTxId, userOpBytes, userOpHash, state, proofJson, executionAllowedAt, attempts, lastError, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        record.id,
        record.xrplTxId,
        record.userOpBytes,
        record.userOpHash,
        record.state,
        record.proofJson ?? null,
        record.executionAllowedAt !== undefined ? record.executionAllowedAt.toString() : null,
        record.attempts,
        record.lastError ?? null,
        record.createdAt,
        record.updatedAt,
      );
    },
    get: getRec,
    getByXrplTxId(xrplTxId) {
      const row = db
        .prepare(`SELECT * FROM mints WHERE xrplTxId = ?`)
        .get(xrplTxId) as Row | undefined;
      return row ? toRecord(row) : undefined;
    },
    update(id, patch) {
      const current = getRec(id);
      if (!current) throw new Error(`mint ${id} not found`);
      const next: MintRecord = { ...current, ...patch, updatedAt: Date.now() };
      db.prepare(
        `UPDATE mints SET state=?, proofJson=?, executionAllowedAt=?, attempts=?, lastError=?, updatedAt=? WHERE id=?`,
      ).run(
        next.state,
        next.proofJson ?? null,
        next.executionAllowedAt !== undefined ? next.executionAllowedAt.toString() : null,
        next.attempts,
        next.lastError ?? null,
        next.updatedAt,
        id,
      );
      return next;
    },
    dueRetries(nowSeconds) {
      const rows = db.prepare(`SELECT * FROM mints WHERE state = 'DELAYED'`).all() as Row[];
      return rows
        .map(toRecord)
        .filter((r) => r.executionAllowedAt !== undefined && r.executionAllowedAt <= nowSeconds);
    },
    resumable() {
      const rows = db
        .prepare(
          `SELECT * FROM mints WHERE state NOT IN ('EXECUTED','RECOVERED','REJECTED')`,
        )
        .all() as Row[];
      return rows.map(toRecord);
    },
  };
}
