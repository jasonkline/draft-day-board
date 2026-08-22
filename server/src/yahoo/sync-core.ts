// Shared player-pool sync: fetch from Yahoo, write the cache file, and swap the
// running server's in-memory pool. Used by both the CLI (sync.ts) and the
// admin "Refresh from Yahoo" socket handler.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Player } from "../../../shared/types.js";
import { fetchPlayerPool, type FetchPoolOptions } from "./pool.js";
import { POOL_FILENAME, setPlayers } from "../players.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// server/src/yahoo -> server/data (server/dist/yahoo -> server/data in prod)
const DATA_DIR = join(__dirname, "..", "..", "data");

export interface SyncResult {
  players: Player[];
  path: string;
}

/**
 * Fetch the full player pool from Yahoo, persist it to server/data, and update
 * the live in-memory pool. Throws on any Yahoo/network error, leaving the
 * existing cache and in-memory pool untouched.
 */
export async function syncPlayerPool(opts: FetchPoolOptions = {}): Promise<SyncResult> {
  const players = await fetchPlayerPool(opts);
  // A full pool is ~1,200 players. If Yahoo's response shape shifts and we
  // silently map only a sliver, refuse to clobber the known-good cache.
  if (players.length < 300) {
    throw new Error(
      `Refusing to overwrite the player pool: fetch returned only ${players.length} players`
    );
  }
  mkdirSync(DATA_DIR, { recursive: true });
  const path = join(DATA_DIR, POOL_FILENAME);
  writeFileSync(path, JSON.stringify(players, null, 2) + "\n");
  setPlayers(players);
  return { players, path };
}
