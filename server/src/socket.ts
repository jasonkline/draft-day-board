import type { Server, Socket } from "socket.io";
import type {
  ClientToServerEvents,
  PickRevealEvent,
  ServerToClientEvents,
  JoinAck,
} from "../../shared/types.js";
import { store, type InternalSession } from "./store.js";
import { PLAYERS } from "./players.js";

type IO = Server<ClientToServerEvents, ServerToClientEvents>;
type Sock = Socket<ClientToServerEvents, ServerToClientEvents>;

function room(code: string): string {
  return `session:${code}`;
}

function broadcastState(io: IO, s: InternalSession): void {
  io.to(room(s.code)).emit("state:update", store.toPublicState(s));
}

function fail(error: string): JoinAck {
  return { ok: false, error };
}

export function registerSocketHandlers(io: IO): void {
  io.on("connection", (socket: Sock) => {
    socket.on("session:create", ({ config, teamNames }, cb) => {
      try {
        const s = store.create(config?.leagueName ?? "Fantasy Draft", teamNames ?? []);
        if (config) store.updateConfig(s, config);
        socket.join(room(s.code));
        cb({
          ok: true,
          state: store.toPublicState(s),
          adminToken: s.adminToken,
        });
      } catch (err) {
        cb(fail(errMsg(err)));
      }
    });

    socket.on("session:watch", ({ code }, cb) => {
      const s = store.get(code);
      if (!s) return cb(fail("Session not found"));
      socket.join(room(s.code));
      cb({ ok: true, state: store.toPublicState(s) });
    });

    socket.on("session:adminJoin", ({ code, adminToken }, cb) => {
      const s = store.get(code);
      if (!s) return cb(fail("Session not found"));
      if (!store.isAdmin(s, adminToken)) return cb(fail("Invalid commissioner link"));
      socket.join(room(s.code));
      cb({ ok: true, state: store.toPublicState(s), adminToken: s.adminToken });
    });

    socket.on("session:claimTeam", ({ code, teamId, teamToken }, cb) => {
      const s = store.get(code);
      if (!s) return cb(fail("Session not found"));
      try {
        const team = store.claimTeam(s, teamId, teamToken);
        socket.join(room(s.code));
        broadcastState(io, s);
        cb({
          ok: true,
          state: store.toPublicState(s),
          teamToken: team.token,
          teamId: team.id,
        });
      } catch (err) {
        cb(fail(errMsg(err)));
      }
    });

    socket.on("admin:updateConfig", ({ code, adminToken, config }, cb) =>
      withAdmin(io, code, adminToken, cb, (s) => {
        store.updateConfig(s, config);
      })
    );

    socket.on("admin:updateTeams", ({ code, adminToken, teams }, cb) =>
      withAdmin(io, code, adminToken, cb, (s) => {
        store.updateTeams(s, teams);
      })
    );

    socket.on("admin:setOrder", ({ code, adminToken, order }, cb) =>
      withAdmin(io, code, adminToken, cb, (s) => {
        store.setOrder(s, order);
      })
    );

    socket.on("admin:startDraft", ({ code, adminToken }, cb) =>
      withAdmin(io, code, adminToken, cb, (s) => {
        store.startDraft(s);
      })
    );

    socket.on("admin:undoPick", ({ code, adminToken }, cb) =>
      withAdmin(io, code, adminToken, cb, (s) => {
        store.undoLastPick(s);
      })
    );

    socket.on("pick:make", ({ code, playerId, adminToken, teamToken }, cb) => {
      const s = store.get(code);
      if (!s) return cb({ ok: false, error: "Session not found" });
      try {
        if (s.status !== "drafting") throw new Error("Draft is not active");
        const overall = s.picks.length + 1;
        const actingTeamId = store.authorizeActor(s, overall, {
          adminToken,
          teamToken,
        });
        const pick = store.applyPick(s, playerId, actingTeamId);

        // First broadcast the authoritative state so everyone is consistent...
        const snapshot = store.toPublicState(s);
        io.to(room(s.code)).emit("state:update", snapshot);

        // ...then fire the dramatic reveal for the room (board animates + dings).
        const player = PLAYERS.find((p) => p.id === pick.playerId)!;
        const team = s.teams.find((t) => t.id === pick.teamId)!;
        const { token, ...publicTeam } = team;
        const reveal: PickRevealEvent = {
          pick,
          player,
          team: publicTeam,
          isFirstOverall: pick.overall === 1,
          isLastPick: snapshot.status === "complete",
        };
        io.to(room(s.code)).emit("pick:reveal", reveal);

        cb({ ok: true });
      } catch (err) {
        cb({ ok: false, error: errMsg(err) });
      }
    });
  });
}

function withAdmin(
  io: IO,
  code: string,
  adminToken: string,
  cb: (ack: JoinAck) => void,
  mutate: (s: InternalSession) => void
): void {
  const s = store.get(code);
  if (!s) return cb(fail("Session not found"));
  if (!store.isAdmin(s, adminToken)) return cb(fail("Not authorized"));
  try {
    mutate(s);
    broadcastState(io, s);
    cb({ ok: true, state: store.toPublicState(s) });
  } catch (err) {
    cb(fail(errMsg(err)));
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : "Unexpected error";
}
