import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "../../shared/types.js";
import { registerSocketHandlers } from "./socket.js";
import { store, type InternalSession } from "./store.js";
import { buildDraftExport } from "./yahoo/export.js";
import {
  buildResultsCsv,
  buildResultsJson,
  resultsFilenameBase,
} from "./results.js";
import { RateLimiter } from "./ratelimit.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4000;

const app = express();
const httpServer = createServer(app);

// The client is always served same-origin (Vite proxies /socket.io in dev; the
// server serves client/dist in prod), so cross-origin access is opt-in only:
// CORS_ORIGINS is a comma-separated allowlist for the rare split-host deploy.
const extraOrigins = new Set(
  (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  // Real payloads are a few KB (codes, tokens, config patches); cap incoming
  // messages well below Socket.IO's 1 MB default.
  maxHttpBufferSize: 64 * 1024,
  ...(extraOrigins.size > 0 ? { cors: { origin: [...extraOrigins] } } : {}),
  // CORS headers don't gate WebSocket upgrades, so enforce the origin policy
  // here too: no Origin (same-origin nav / non-browser client), an Origin
  // matching the Host, or an allowlisted one.
  allowRequest(req, callback) {
    const origin = req.headers.origin;
    if (!origin) return callback(null, true);
    if (extraOrigins.has(origin)) return callback(null, true);
    try {
      callback(null, new URL(origin).host === req.headers.host);
    } catch {
      callback(null, false);
    }
  },
});

registerSocketHandlers(io);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// Push-to-Yahoo: the offline-draft importer userscript runs ON yahoo.com and
// fetches the finished draft (picks keyed to Yahoo player ids) from here. It's a
// cross-origin call guarded solely by the session's admin token (no cookies are
// involved), so a wildcard CORS origin is safe — the 24-char token is the only
// credential and brute-forcing it is infeasible.
app.options("/api/yahoo/export", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.sendStatus(204);
});
app.post("/api/yahoo/export", express.json({ limit: "16kb" }), (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const { code, adminToken } = (req.body ?? {}) as {
    code?: string;
    adminToken?: string;
  };
  const s = code ? store.get(code) : undefined;
  if (!s) return res.status(404).json({ ok: false, error: "Session not found" });
  if (!store.isAdmin(s, adminToken))
    return res.status(403).json({ ok: false, error: "Not authorized" });
  res.json({ ok: true, export: buildDraftExport(s) });
});

// The HTTP endpoints below are code-addressed like the socket lookup events,
// so give them the same enumeration throttle (per-IP token bucket).
const httpLimiter = new RateLimiter(
  Number(process.env.SESSION_LOOKUP_BURST) || 30,
  Number(process.env.SESSION_LOOKUP_PER_SEC) || 1
);
function httpAllowed(req: express.Request, res: express.Response): boolean {
  if (httpLimiter.allow(req.ip ?? "unknown")) return true;
  res.status(429).json({ ok: false, error: "Too many requests — wait a moment and try again" });
  return false;
}

// Draft results download (CSV or JSON). No token required: the board page
// already shows every pick to anyone holding the join code. Mid-draft exports
// are allowed on purpose — partial results are useful insurance.
app.get("/api/export/:code", (req, res) => {
  if (!httpAllowed(req, res)) return;
  const s = store.get(req.params.code);
  if (!s) return res.status(404).json({ ok: false, error: "Session not found" });
  const players = store.playersFor(s);
  const base = resultsFilenameBase(s);
  if (req.query.format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${base}-results.csv"`);
    res.send(buildResultsCsv(s, players));
  } else {
    res.setHeader("Content-Disposition", `attachment; filename="${base}-results.json"`);
    res.json(buildResultsJson(s, players));
  }
});

// Wipe insurance: full session backup, tokens and imported pool included —
// admin-only. The token travels as a query param, matching the commissioner
// link pattern (it's already a URL credential).
app.get("/api/backup/:code", (req, res) => {
  if (!httpAllowed(req, res)) return;
  const s = store.get(req.params.code);
  if (!s) return res.status(404).json({ ok: false, error: "Session not found" });
  if (!store.isAdmin(s, typeof req.query.token === "string" ? req.query.token : undefined))
    return res.status(403).json({ ok: false, error: "Not authorized" });
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="draft-backup-${s.code}.json"`
  );
  res.json({ ok: true, version: 1, session: s });
});

// Recreate a session from a backup file. Possession of the backup (it contains
// the adminToken) is the credential; if the code is still live, the incoming
// token must match so a restore can't hijack an existing session. The 2mb cap
// comfortably covers the largest imported pool.
app.post("/api/restore", express.json({ limit: "2mb" }), (req, res) => {
  if (!httpAllowed(req, res)) return;
  const { session } = (req.body ?? {}) as { session?: InternalSession };
  if (!session || typeof session !== "object")
    return res.status(400).json({ ok: false, error: "Missing session in backup" });
  const existing = store.get(session.code ?? "");
  if (existing && !store.isAdmin(existing, session.adminToken))
    return res.status(403).json({ ok: false, error: "Not authorized" });
  try {
    const restored = store.restore(session);
    res.json({ ok: true, code: restored.code });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : "Invalid backup",
    });
  }
});

// Lock down what the app's pages may load/run: only our own scripts, images
// from ourselves + the known player/team art CDNs (Yahoo, ESPN), and only
// same-origin (or ws) connections. Inline styles stay allowed — React style
// props need them.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://*.yimg.com https://a.espncdn.com",
  "connect-src 'self' ws: wss:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
].join("; ");

// Serve the built client in production (client builds to ../client/dist).
const clientDist = join(__dirname, "..", "..", "client", "dist");
if (existsSync(clientDist)) {
  app.use(
    express.static(clientDist, {
      setHeaders(res, filePath) {
        // Vite emits content-hashed files under /assets — the hash changes
        // when content changes, so they're safe to cache forever. This means
        // a browser that loaded the page once never re-requests the JS/CSS,
        // so a dropped connection (e.g. Render free-tier cold start) on a
        // later refresh can't strip the styles. index.html must stay fresh
        // so it always points at the current asset hashes.
        if (filePath.endsWith("index.html")) {
          res.setHeader("Cache-Control", "no-cache");
          res.setHeader("Content-Security-Policy", CSP);
        } else if (filePath.includes(`${sep}assets${sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );
  // SPA fallback for client-side routes (always serve fresh HTML).
  app.get(/^(?!\/api|\/socket\.io).*/, (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Content-Security-Policy", CSP);
    res.sendFile(join(clientDist, "index.html"));
  });
}

// Load persisted sessions (from Postgres when DATABASE_URL is set, else the
// local data dir) before accepting any traffic. A rejection here (e.g. a bad
// DATABASE_URL) crashes the boot on purpose — better a failed deploy than a
// silently memory-only server.
await store.init();

httpServer.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] listening on http://localhost:${PORT}`);
  if (!existsSync(clientDist)) {
    console.log("[server] client/dist not found — run the Vite dev server separately.");
  }
});

// Render sends SIGTERM on every deploy and free-tier spin-down — land the
// final debounced save before exiting.
process.on("SIGTERM", () => {
  void store.flushNow().finally(() => process.exit(0));
});
