import type { Server, Socket } from "socket.io";
import type {
  ClientToServerEvents,
  PickRevealEvent,
  ServerToClientEvents,
  JoinAck,
  HeckleFrom,
} from "../../shared/types.js";
import { store, type InternalSession } from "./store.js";
import { syncPlayerPool } from "./yahoo/sync-core.js";
import { fetchPlayerPool } from "./yahoo/pool.js";
import { listLeagues, fetchLeague } from "./yahoo/league.js";

type IO = Server<ClientToServerEvents, ServerToClientEvents>;
type Sock = Socket<ClientToServerEvents, ServerToClientEvents>;

function room(code: string): string {
  return `session:${code}`;
}

// Per-session cooldown (ms) so heckles can't be machine-gunned into
// overlapping audio/animation chaos on the board. Shared across kinds.
const HECKLE_COOLDOWN_MS = 2500;
const lastHeckleAt = new Map<string, number>();
const HECKLE_KINDS = ["hurryUp", "bruh"] as const;
// Each heckle kind is gated by its own NSFW sub-toggle.
const HECKLE_TOGGLE: Record<(typeof HECKLE_KINDS)[number], "hurryUpButton" | "bruhButton"> = {
  hurryUp: "hurryUpButton",
  bruh: "bruhButton",
};

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

    socket.on("admin:refreshPlayers", async ({ code, adminToken }, cb) => {
      const s = store.get(code);
      if (!s) return cb({ ok: false, error: "Session not found" });
      if (!store.isAdmin(s, adminToken)) return cb({ ok: false, error: "Not authorized" });
      // Swapping the pool mid-draft could orphan already-made picks, so only
      // allow it during setup.
      if (s.status !== "setup") {
        return cb({ ok: false, error: "Players can only be refreshed before the draft starts" });
      }
      try {
        const { players } = await syncPlayerPool();
        // The new pool flows into every snapshot via toPublicState.
        broadcastState(io, s);
        cb({ ok: true, count: players.length });
      } catch (err) {
        cb({ ok: false, error: errMsg(err) });
      }
    });

    socket.on("admin:listYahooLeagues", async ({ code, adminToken }, cb) => {
      const s = store.get(code);
      if (!s) return cb({ ok: false, error: "Session not found" });
      if (!store.isAdmin(s, adminToken)) return cb({ ok: false, error: "Not authorized" });
      try {
        const leagues = await listLeagues();
        cb({ ok: true, leagues });
      } catch (err) {
        cb({ ok: false, error: errMsg(err) });
      }
    });

    socket.on("admin:importYahooLeague", async ({ code, adminToken, leagueKey }, cb) => {
      const s = store.get(code);
      if (!s) return cb({ ok: false, error: "Session not found" });
      if (!store.isAdmin(s, adminToken)) return cb({ ok: false, error: "Not authorized" });
      // Rebuilding teams mid-draft would orphan picks, so import is setup-only.
      if (s.status !== "setup") {
        return cb({ ok: false, error: "A league can only be imported before the draft starts" });
      }
      try {
        const imp = await fetchLeague(leagueKey);
        // Apply structure first so the room sees teams/rounds even if the
        // (slower) player pull fails — that failure is surfaced separately.
        store.applyImportedLeague(s, imp);
        // Scope the league-adjusted ADP to THIS session only — never touch the
        // universal pool or other sessions.
        const players = await fetchPlayerPool({ leagueKey });
        store.setSessionPlayers(s, players);
        broadcastState(io, s);
        cb({
          ok: true,
          summary: {
            leagueName: imp.leagueName,
            numTeams: imp.numTeams,
            rounds: imp.rounds,
            scoringLabel: imp.scoringLabel,
            playerCount: players.length,
          },
        });
      } catch (err) {
        // Structure may have applied even if the pool sync threw; push whatever
        // state we have so the board reflects the imported teams.
        broadcastState(io, s);
        cb({ ok: false, error: errMsg(err) });
      }
    });

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
        const player = store.playersFor(s).find((p) => p.id === pick.playerId)!;
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

    socket.on("fan:heckle", ({ code, kind, teamToken }, cb) => {
      const s = store.get(code);
      if (!s) return cb({ ok: false, error: "Session not found" });
      if (s.status !== "drafting") return cb({ ok: false, error: "Draft is not active" });
      if (!HECKLE_KINDS.includes(kind as (typeof HECKLE_KINDS)[number]))
        return cb({ ok: false, error: "Unknown heckle" });
      if (!s.config.nsfw || !s.config[HECKLE_TOGGLE[kind]])
        return cb({ ok: false, error: "Feature not enabled" });

      // Validate + attribute first (so real errors always surface), then gate on
      // the cooldown. Never let the team currently on the clock heckle itself.
      const onClock = store.toPublicState(s).onClockTeamId;
      let from: HeckleFrom | undefined;
      if (teamToken) {
        const team = s.teams.find((t) => t.token === teamToken);
        if (team && team.id === onClock)
          return cb({ ok: false, error: "You're on the clock — pick already!" });
        if (team) from = { name: team.name, emoji: team.emoji, color: team.avatarColor };
      }

      // Swallow spam within the cooldown window (still ack ok so the phone
      // doesn't show an error for an over-eager tapper).
      const now = Date.now();
      if (now - (lastHeckleAt.get(s.code) ?? 0) < HECKLE_COOLDOWN_MS) return cb({ ok: true });
      lastHeckleAt.set(s.code, now);

      io.to(room(s.code)).emit("fan:heckle", { kind, from });
      cb({ ok: true });
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
