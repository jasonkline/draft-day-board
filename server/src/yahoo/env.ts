// Minimal, dependency-free .env loader. We avoid adding `dotenv` to keep the
// server's dependency surface small. Only the Yahoo CLIs call this; the runtime
// server never needs env (it reads the cached player pool from disk).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Walk up from `start` until we find a `.env` file (repo root), or hit the
// filesystem root.
function findEnvFile(start: string): string | null {
  let dir = start;
  for (;;) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

let loaded = false;

/**
 * Parse `.env` (KEY=VALUE per line) into `process.env` without overwriting
 * variables that are already set. Idempotent. Returns the path it loaded, or
 * null if no `.env` was found.
 */
export function loadEnv(): string | null {
  if (loaded) return null;
  loaded = true;

  const envPath = findEnvFile(process.cwd());
  if (!envPath) return null;

  const text = readFileSync(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip matching surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && !(key in process.env)) process.env[key] = value;
  }
  return envPath;
}

export interface YahooConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  refreshToken?: string;
}

/** Read Yahoo config from the environment, throwing if the essentials are missing. */
export function readYahooConfig(): YahooConfig {
  loadEnv();
  const clientId = process.env.YAHOO_CLIENT_ID?.trim();
  const clientSecret = process.env.YAHOO_CLIENT_SECRET?.trim();
  const redirectUri = process.env.YAHOO_REDIRECT_URI?.trim();
  const refreshToken = process.env.YAHOO_REFRESH_TOKEN?.trim() || undefined;

  const missing = [
    ["YAHOO_CLIENT_ID", clientId],
    ["YAHOO_CLIENT_SECRET", clientSecret],
    ["YAHOO_REDIRECT_URI", redirectUri],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length) {
    throw new Error(
      `Missing Yahoo env var(s): ${missing.join(", ")}. Fill them into .env (see .env.example).`
    );
  }

  return {
    clientId: clientId!,
    clientSecret: clientSecret!,
    redirectUri: redirectUri!,
    refreshToken,
  };
}

/**
 * Persist a value into the repo-root `.env`, replacing the line if the key
 * exists or appending it otherwise. Used by the auth CLI to save the refresh
 * token after the one-time authorization.
 */
export function writeEnvVar(key: string, value: string): string {
  const envPath = findEnvFile(process.cwd());
  if (!envPath) throw new Error("Could not locate .env to write to.");
  const text = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const lines = text.split(/\r?\n/);
  const idx = lines.findIndex((l) => l.trim().startsWith(`${key}=`));
  const newLine = `${key}=${value}`;
  if (idx === -1) {
    // Append, keeping a single trailing newline. .env holds credentials, so
    // keep it readable by this user only.
    const body = text.endsWith("\n") || text === "" ? text : text + "\n";
    writeFileSync(envPath, body + newLine + "\n", { mode: 0o600 });
  } else {
    lines[idx] = newLine;
    writeFileSync(envPath, lines.join("\n"), { mode: 0o600 });
  }
  return envPath;
}
