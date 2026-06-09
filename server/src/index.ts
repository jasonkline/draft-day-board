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

httpServer.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] listening on http://localhost:${PORT}`);
  if (!existsSync(clientDist)) {
    console.log("[server] client/dist not found — run the Vite dev server separately.");
  }
});
