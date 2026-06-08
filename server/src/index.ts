import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { dirname, join } from "node:path";
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
  app.use(express.static(clientDist));
  // SPA fallback for client-side routes.
  app.get(/^(?!\/api|\/socket\.io).*/, (_req, res) => {
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
