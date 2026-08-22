// Pluggable persistence for SessionStore. The file backend keeps the original
// layout (sessions.json + pools/<CODE>.json sidecars) for local dev and tests;
// the Postgres backend mirrors the same split into two jsonb tables so state
// survives hosts with ephemeral filesystems (Render wipes the disk on every
// deploy and free-tier spin-down). Selected by DATABASE_URL at boot.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { Player } from "../../shared/types.js";
import type { InternalSession } from "./store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const DATA_FILE = join(DATA_DIR, "sessions.json");
// Per-session imported player pools live separately, keyed by code, so they
// survive restarts without bloating the session snapshot (which is rewritten
// on every pick).
const POOLS_DIR = join(DATA_DIR, "pools");
const poolFile = (code: string) => join(POOLS_DIR, `${code}.json`);

export interface PersistedData {
  /** Sessions without their `players` key — the store re-attaches from `pools`. */
  sessions: InternalSession[];
  pools: Map<string, Player[]>;
}

export interface PersistenceBackend {
  /** Prepare storage (mkdir / CREATE TABLE) and read everything persisted. */
  load(): Promise<PersistedData>;
  /** Persist a full snapshot. Each session's `players` key is stripped. */
  saveSessions(sessions: InternalSession[]): void | Promise<void>;
  savePool(code: string, players: Player[]): void | Promise<void>;
  deletePool(code: string): void | Promise<void>;
}

export function createBackend(): PersistenceBackend {
  const url = process.env.DATABASE_URL;
  return url ? new PostgresBackend(url) : new FileBackend();
}

export class FileBackend implements PersistenceBackend {
  async load(): Promise<PersistedData> {
    const pools = new Map<string, Player[]>();
    if (!existsSync(DATA_FILE)) return { sessions: [], pools };
    // writeFileSync's mode only applies on creation — retro-tighten files
    // written before permissions were locked down (they hold every token).
    chmodSync(DATA_FILE, 0o600);
    const sessions = JSON.parse(readFileSync(DATA_FILE, "utf8")) as InternalSession[];
    for (const s of sessions) {
      const pool = this.loadPoolSidecar(s.code);
      if (pool) pools.set(s.code, pool);
    }
    return { sessions, pools };
  }

  private loadPoolSidecar(code: string): Player[] | undefined {
    const path = poolFile(code);
    if (!existsSync(path)) return undefined;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      if (Array.isArray(parsed) && parsed.length > 0) return parsed as Player[];
    } catch (err) {
      console.error(`[store] failed to read pool sidecar for ${code}:`, err);
    }
    return undefined;
  }

  saveSessions(sessions: InternalSession[]): void {
    // sessions.json holds every session's capability tokens — keep it readable
    // by this user only.
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(
      DATA_FILE,
      JSON.stringify(sessions, (k, v) => (k === "players" ? undefined : v)),
      { mode: 0o600 }
    );
  }

  // Pool ops must stay synchronous: callers (and tests) rely on the sidecar
  // existing on disk the moment setSessionPlayers returns.
  savePool(code: string, players: Player[]): void {
    mkdirSync(POOLS_DIR, { recursive: true });
    writeFileSync(poolFile(code), JSON.stringify(players));
  }

  deletePool(code: string): void {
    rmSync(poolFile(code), { force: true });
  }
}

export class PostgresBackend implements PersistenceBackend {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    // pg is CJS; default-import then destructure. Neon/Supabase require TLS;
    // rejectUnauthorized:false (≈ sslmode=no-verify) sidesteps their pooler
    // cert-chain quirks while keeping the connection encrypted.
    const { Pool } = pg;
    this.pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 3,
    });
  }

  async load(): Promise<PersistedData> {
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS sessions (
         code text PRIMARY KEY,
         data jsonb NOT NULL,
         updated_at timestamptz NOT NULL DEFAULT now()
       )`
    );
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS pools (
         code text PRIMARY KEY,
         data jsonb NOT NULL
       )`
    );
    // These tables hold capability tokens. On Supabase, the public schema is
    // also reachable through PostgREST — RLS with no policies shuts that door,
    // while this app (as table owner) is unaffected. Idempotent, harmless on
    // plain Postgres.
    await this.pool.query("ALTER TABLE sessions ENABLE ROW LEVEL SECURITY");
    await this.pool.query("ALTER TABLE pools ENABLE ROW LEVEL SECURITY");
    const [sess, pools] = await Promise.all([
      this.pool.query("SELECT data FROM sessions"),
      this.pool.query("SELECT code, data FROM pools"),
    ]);
    const poolMap = new Map<string, Player[]>();
    for (const row of pools.rows) {
      if (Array.isArray(row.data) && row.data.length > 0)
        poolMap.set(row.code as string, row.data as Player[]);
    }
    return { sessions: sess.rows.map((r) => r.data as InternalSession), pools: poolMap };
  }

  /**
   * Full-snapshot semantics matching the file rewrite: rows for sessions that
   * no longer exist in memory (idle cleanup) are deleted, everything else is
   * upserted. One transaction so a crash can't leave a half-written snapshot.
   */
  async saveSessions(sessions: InternalSession[]): Promise<void> {
    const codes = sessions.map((s) => s.code);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM sessions WHERE NOT (code = ANY($1))", [codes]);
      await client.query("DELETE FROM pools WHERE NOT (code = ANY($1))", [codes]);
      for (const s of sessions) {
        // Strip the pool (stored separately) before serializing. Explicit
        // JSON.stringify — node-pg would treat a bare JS array as a Postgres
        // array literal, and objects are safer stringified too.
        const { players: _players, ...data } = s;
        await client.query(
          `INSERT INTO sessions (code, data, updated_at) VALUES ($1, $2, now())
           ON CONFLICT (code) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
          [s.code, JSON.stringify(data)]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async savePool(code: string, players: Player[]): Promise<void> {
    await this.pool.query(
      `INSERT INTO pools (code, data) VALUES ($1, $2)
       ON CONFLICT (code) DO UPDATE SET data = EXCLUDED.data`,
      [code, JSON.stringify(players)]
    );
  }

  async deletePool(code: string): Promise<void> {
    await this.pool.query("DELETE FROM pools WHERE code = $1", [code]);
  }
}
