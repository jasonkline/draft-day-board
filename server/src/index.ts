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
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: true, credentials: true },
});

registerSocketHandlers(io);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

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
        } else if (filePath.includes(`${sep}assets${sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );
  // SPA fallback for client-side routes (always serve fresh HTML).
  app.get(/^(?!\/api|\/socket\.io).*/, (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
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
