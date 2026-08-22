import { customAlphabet } from "nanoid";
import { timingSafeEqual } from "node:crypto";
import type {
  DraftConfig,
  Pick,
  Player,
  SessionState,
  Team,
} from "../../shared/types.js";
import { PLAYERS } from "./players.js";
import { slotForOverall, teamIdForOverall, totalPicks } from "./draft.js";
import {
  createBackend,
  FileBackend,
  type PersistenceBackend,
} from "./persistence.js";

// Unambiguous code alphabet (no 0/O/1/I) for easy reading off a TV / typing on a phone.
const codeId = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 5);
const tokenId = customAlphabet(
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  24
);

// Hard ceilings so an unauthenticated client can't grow memory/disk without
// bound. Idle sessions age out (a draft is a one-evening event) to make room.
const MAX_SESSIONS = Number(process.env.MAX_SESSIONS) || 500;
const MAX_TEAMS = 32;
const SESSION_TTL_MS =
  (Number(process.env.SESSION_TTL_DAYS) || 14) * 24 * 60 * 60 * 1000;

/**
 * Constant-time comparison for secret tokens (admin + team capability tokens).
 * Accepts unknown so unvalidated wire input can be passed directly.
 */
export function safeEqual(candidate: unknown, secret: string): boolean {
  if (typeof candidate !== "string" || candidate.length !== secret.length)
    return false;
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(secret));
}

const TEAM_COLORS = [
  "#e63946", "#2a9d8f", "#e9c46a", "#f4a261", "#457b9d", "#9b5de5",
  "#00bbf9", "#06d6a0", "#ef476f", "#ffd166", "#118ab2", "#8338ec",
  "#fb5607", "#3a86ff", "#ff006e", "#43aa8b",
];
const TEAM_EMOJI = [
  "🦅", "🐻", "🦁", "🐺", "🦈", "🐉", "🦬", "🐅", "🦏", "🐆",
  "🦌", "🐗", "🦅", "🐲", "🦂", "🐊",
];

export interface InternalSession {
  code: string;
  adminToken: string;
  status: SessionState["status"];
  config: DraftConfig;
  teams: Team[];
  draftOrder: string[];
  picks: Pick[];
  createdAt: number;
  updatedAt: number;
  // Session-scoped player pool from a Yahoo league import. When undefined the
  // session uses the universal PLAYERS pool. Persisted as a sidecar file, never
  // inlined into sessions.json.
  players?: Player[];
}

function defaultConfig(leagueName: string): DraftConfig {
  return {
    leagueName: leagueName || "Fantasy Draft",
    draftStyle: "snake",
    mode: "commissioner",
    rounds: 15,
    secondsPerPick: 90,
    sounds: true,
    announcementVisual: true,
    announcementSound: true,
    announcementSeconds: 6,
    revealVisual: true,
    revealSound: true,
    revealSeconds: 10,
    showPositionRuns: true,
    showValueBadges: true,
    showOnDeck: true,
    nsfw: false,
    hurryUpButton: true,
    bruhButton: true,
  };
}

// Presentation settings that may change at any time, even mid-draft (they don't
// affect draft integrity, only the show). Everything else in DraftConfig locks
// once the draft starts.
const LIVE_CONFIG_KEYS = new Set<keyof DraftConfig>([
  "sounds",
  "announcementVisual",
  "announcementSound",
  "announcementSeconds",
  "revealVisual",
  "revealSound",
  "revealSeconds",
  "nsfw",
  "hurryUpButton",
  "bruhButton",
]);

export class SessionStore {
  private sessions = new Map<string, InternalSession>();
  private saveTimer: NodeJS.Timeout | null = null;
  private savePromise: Promise<void> = Promise.resolve();
  private saveQueued = false;

  constructor(private backend: PersistenceBackend = new FileBackend()) {
    setInterval(() => this.cleanupIdle(), 60 * 60 * 1000).unref();
  }

  // ---- persistence ----
  /** Load persisted state. Must be awaited before the server accepts connections. */
  async init(): Promise<void> {
    try {
      const { sessions, pools } = await this.backend.load();
      for (const s of sessions) {
        // Backfill config fields added after this session was persisted, so the
        // new presentation toggles don't read as undefined (≈ everything off).
        s.config = { ...defaultConfig(s.config.leagueName), ...s.config };
        // Rehydrate the session's imported pool, if any.
        s.players = pools.get(s.code);
        this.sessions.set(s.code, s);
      }
      // eslint-disable-next-line no-console
      console.log(`[store] loaded ${sessions.length} session(s)`);
    } catch (err) {
      console.error("[store] failed to load sessions:", err);
      throw err;
    }
    this.cleanupIdle();
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flush();
    }, 250);
  }

  /**
   * Serialized snapshot save. The Postgres backend is async, so overlapping
   * flushes must not interleave: saves are chained on a promise queue, with at
   * most one queued behind the in-flight one. The snapshot is taken when the
   * save runs, so the last write always carries the latest state. The file
   * backend completes synchronously inside the chain — timing is effectively
   * unchanged from the original writeFileSync-in-setTimeout.
   */
  private flush(): Promise<void> {
    if (this.saveQueued) return this.savePromise;
    this.saveQueued = true;
    this.savePromise = this.savePromise.then(async () => {
      this.saveQueued = false;
      try {
        await this.backend.saveSessions([...this.sessions.values()]);
      } catch (err) {
        console.error("[store] failed to save sessions:", err);
      }
    });
    return this.savePromise;
  }

  /** Cancel any pending debounce and persist now (shutdown hook). */
  async flushNow(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.flush();
  }

  /** Run a backend write, logging sync throws and async rejections alike. */
  private persist(label: string, op: () => void | Promise<void>): void {
    try {
      const r = op();
      if (r) r.catch((err) => console.error(`[store] ${label}:`, err));
    } catch (err) {
      console.error(`[store] ${label}:`, err);
    }
  }

  // ---- lifecycle ----
  create(leagueName: string, teamNames: string[]): InternalSession {
    if (this.sessions.size >= MAX_SESSIONS) {
      this.cleanupIdle();
      if (this.sessions.size >= MAX_SESSIONS)
        throw new Error("Server is at capacity — try again later");
    }

    let code = codeId();
    while (this.sessions.has(code)) code = codeId();

    const sanitized = (Array.isArray(teamNames) ? teamNames : [])
      .slice(0, MAX_TEAMS)
      .map((n) => (typeof n === "string" ? n : "").slice(0, 40));
    const names =
      sanitized.length > 0
        ? sanitized
        : Array.from({ length: 10 }, (_, i) => `Team ${i + 1}`);

    const teams: Team[] = names.map((name, i) => ({
      id: `team-${i + 1}`,
      name: name.trim() || `Team ${i + 1}`,
      token: tokenId(),
      claimed: false,
      avatarColor: TEAM_COLORS[i % TEAM_COLORS.length],
      emoji: TEAM_EMOJI[i % TEAM_EMOJI.length],
    }));

    const now = Date.now();
    const session: InternalSession = {
      code,
      adminToken: tokenId(),
      status: "setup",
      config: defaultConfig(leagueName),
      teams,
      draftOrder: teams.map((t) => t.id),
      picks: [],
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(code, session);
    this.scheduleSave();
    return session;
  }

  get(code: string): InternalSession | undefined {
    return this.sessions.get(code?.toUpperCase?.() ?? code);
  }

  /**
   * Recreate a session from a backup file (wipe insurance for ephemeral
   * hosting). The backup is admin-held and contains the tokens, but every
   * field is still validated/normalized — picks are rebuilt through the same
   * draft math as live picks so a tampered file can't produce an inconsistent
   * board. Throws with a human-readable message on invalid input.
   */
  restore(raw: InternalSession): InternalSession {
    if (!raw || typeof raw !== "object") throw new Error("Invalid backup file");
    const code = typeof raw.code === "string" ? raw.code.toUpperCase() : "";
    if (!/^[A-Z2-9]{5}$/.test(code))
      throw new Error("Backup has an invalid session code");
    if (typeof raw.adminToken !== "string" || raw.adminToken.length !== 24)
      throw new Error("Backup has an invalid admin token");
    if (
      !Array.isArray(raw.teams) ||
      raw.teams.length < 2 ||
      raw.teams.length > MAX_TEAMS
    )
      throw new Error("Backup has an invalid team list");

    if (!this.sessions.has(code) && this.sessions.size >= MAX_SESSIONS) {
      this.cleanupIdle();
      if (this.sessions.size >= MAX_SESSIONS)
        throw new Error("Server is at capacity — try again later");
    }

    const teams: Team[] = raw.teams.map((t, i) => {
      if (
        !t ||
        typeof t !== "object" ||
        typeof t.id !== "string" ||
        typeof t.token !== "string" ||
        t.token.length !== 24
      )
        throw new Error(`Backup team ${i + 1} is invalid`);
      const team: Team = {
        id: t.id.slice(0, 16),
        name:
          (typeof t.name === "string" && t.name.trim()
            ? t.name.trim()
            : `Team ${i + 1}`
          ).slice(0, 40),
        token: t.token,
        claimed: Boolean(t.claimed),
        avatarColor:
          typeof t.avatarColor === "string"
            ? t.avatarColor.slice(0, 16)
            : TEAM_COLORS[i % TEAM_COLORS.length],
        emoji:
          typeof t.emoji === "string"
            ? t.emoji.slice(0, 8)
            : TEAM_EMOJI[i % TEAM_EMOJI.length],
      };
      // Same rule as league import: this URL is rendered as an <img src> on
      // every client, so only https may pass.
      if (typeof t.logoUrl === "string" && t.logoUrl.startsWith("https://"))
        team.logoUrl = t.logoUrl.slice(0, 300);
      return team;
    });
    const ids = new Set(teams.map((t) => t.id));
    if (ids.size !== teams.length)
      throw new Error("Backup has duplicate team ids");

    const rawOrder = Array.isArray(raw.draftOrder) ? raw.draftOrder : [];
    const orderValid =
      rawOrder.length === teams.length &&
      rawOrder.every((id) => typeof id === "string" && ids.has(id)) &&
      new Set(rawOrder).size === rawOrder.length;
    const draftOrder = orderValid ? [...rawOrder] : teams.map((t) => t.id);

    const rawConfig =
      raw.config && typeof raw.config === "object" ? raw.config : ({} as DraftConfig);
    const config = sanitizeConfig({
      ...defaultConfig(
        typeof rawConfig.leagueName === "string" ? rawConfig.leagueName : ""
      ),
      ...rawConfig,
    });

    // Rebuild picks through the same math as live drafting: slot and team are
    // re-derived from position, so the restored board is always self-consistent.
    const total = totalPicks(teams.length, config.rounds);
    const rawPicks = Array.isArray(raw.picks) ? raw.picks.slice(0, total) : [];
    const seenPlayers = new Set<string>();
    const picks: Pick[] = rawPicks.map((p, i) => {
      const overall = i + 1;
      const playerId =
        p && typeof p === "object" && typeof p.playerId === "string"
          ? p.playerId.slice(0, 80)
          : "";
      if (!playerId || seenPlayers.has(playerId))
        throw new Error(`Backup pick ${overall} is invalid`);
      seenPlayers.add(playerId);
      const { round, pickInRound } = slotForOverall(overall, teams.length);
      return {
        overall,
        round,
        pickInRound,
        teamId: teamIdForOverall(overall, draftOrder, config.draftStyle),
        playerId,
        timestamp: typeof p.timestamp === "number" ? p.timestamp : Date.now(),
      };
    });

    const status: SessionState["status"] =
      total > 0 && picks.length >= total
        ? "complete"
        : picks.length > 0 || raw.status === "drafting"
          ? "drafting"
          : "setup";

    const session: InternalSession = {
      code,
      adminToken: raw.adminToken,
      status,
      config,
      teams,
      draftOrder,
      picks,
      createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
      updatedAt: Date.now(),
    };
    if (Array.isArray(raw.players) && raw.players.length > 0) {
      session.players = raw.players;
      this.persist(`failed to persist pool for ${code}`, () =>
        this.backend.savePool(code, session.players!)
      );
    } else {
      // Restoring over an existing session: don't let a stale pool linger.
      this.persist(`failed to remove pool for ${code}`, () =>
        this.backend.deletePool(code)
      );
    }
    this.sessions.set(code, session);
    this.scheduleSave();
    return session;
  }

  /** Drop sessions idle past the TTL (and their pool sidecars). */
  private cleanupIdle(): void {
    const cutoff = Date.now() - SESSION_TTL_MS;
    let removed = 0;
    for (const [code, s] of this.sessions) {
      if (s.updatedAt < cutoff) {
        this.sessions.delete(code);
        // best-effort pool cleanup
        this.persist(`failed to remove pool for ${code}`, () =>
          this.backend.deletePool(code)
        );
        removed++;
      }
    }
    if (removed > 0) {
      // eslint-disable-next-line no-console
      console.log(`[store] removed ${removed} idle session(s)`);
      this.scheduleSave();
    }
  }

  private touch(s: InternalSession): void {
    s.updatedAt = Date.now();
    this.scheduleSave();
  }

  /** The pool this session draws from: its imported pool, else the universal one. */
  playersFor(s: InternalSession): Player[] {
    return s.players ?? PLAYERS;
  }

  // ---- derived public state ----
  toPublicState(s: InternalSession): SessionState {
    const total = totalPicks(s.teams.length, s.config.rounds);
    const currentOverall =
      s.status === "drafting" && s.picks.length < total
        ? s.picks.length + 1
        : null;
    const onClockTeamId =
      currentOverall != null
        ? teamIdForOverall(currentOverall, s.draftOrder, s.config.draftStyle)
        : null;
    const lastPick = s.picks[s.picks.length - 1];
    const pickDeadline =
      currentOverall != null && s.config.secondsPerPick > 0
        ? (lastPick?.timestamp ?? s.updatedAt) + s.config.secondsPerPick * 1000
        : null;

    return {
      code: s.code,
      status: s.status,
      config: s.config,
      teams: s.teams.map(({ token, ...rest }) => rest),
      draftOrder: s.draftOrder,
      players: this.playersFor(s),
      picks: s.picks,
      currentOverall,
      onClockTeamId,
      pickDeadline,
      totalPicks: total,
      updatedAt: s.updatedAt,
    };
  }

  // ---- mutations (all return the session or throw) ----
  updateConfig(s: InternalSession, patch: Partial<DraftConfig>): void {
    // Sound & reveal-pacing settings can change anytime; the rest is locked
    // once the draft is underway.
    if (s.status !== "setup") {
      const locked = (Object.keys(patch) as (keyof DraftConfig)[]).filter(
        (k) => !LIVE_CONFIG_KEYS.has(k)
      );
      if (locked.length)
        throw new Error("Draft has started — only sound & reveal settings can change");
    }
    s.config = sanitizeConfig({ ...s.config, ...patch });
    this.touch(s);
  }

  /**
   * Replace the session's teams and config from an imported Yahoo league. The
   * team count is fixed at creation, so importing a league with a different
   * number of teams means rebuilding the list (fresh tokens, reset claims) and
   * resetting the draft order. Setup-only — never after picks exist.
   */
  applyImportedLeague(
    s: InternalSession,
    imp: {
      leagueName: string;
      teams: { name: string; logoUrl?: string }[];
      rounds: number;
    }
  ): void {
    this.assertSetup(s);
    const teams = imp.teams.filter((t) => t.name.trim());
    if (teams.length < 2) throw new Error("League import returned fewer than 2 teams");

    s.teams = teams.map((t, i) => {
      const team: Team = {
        id: `team-${i + 1}`,
        name: t.name.trim().slice(0, 40),
        token: tokenId(),
        claimed: false,
        avatarColor: TEAM_COLORS[i % TEAM_COLORS.length],
        emoji: TEAM_EMOJI[i % TEAM_EMOJI.length],
      };
      // Only accept https logos — this URL is broadcast to every client and
      // rendered as an <img src>, so never let other schemes through.
      if (t.logoUrl && t.logoUrl.startsWith("https://")) team.logoUrl = t.logoUrl;
      return team;
    });
    s.draftOrder = s.teams.map((t) => t.id);

    s.config = {
      ...s.config,
      leagueName: (imp.leagueName || s.config.leagueName).slice(0, 60),
      rounds: clamp(Math.round(imp.rounds) || s.config.rounds, 1, 30),
    };
    this.touch(s);
  }

  /**
   * Set a session-scoped player pool (e.g. a league-scoped Yahoo pull) without
   * touching the universal pool or any other session. Persisted as a sidecar
   * file so it survives a mid-draft restart. Setup-only.
   */
  setSessionPlayers(s: InternalSession, players: Player[]): void {
    this.assertSetup(s);
    if (!Array.isArray(players) || players.length === 0)
      throw new Error("Imported player pool is empty");
    s.players = players;
    this.persist(`failed to persist pool for ${s.code}`, () =>
      this.backend.savePool(s.code, players)
    );
    this.touch(s);
  }

  /** Drop a session's imported pool, reverting it to the universal one. */
  clearSessionPlayers(s: InternalSession): void {
    this.assertSetup(s);
    delete s.players;
    this.persist(`failed to remove pool for ${s.code}`, () =>
      this.backend.deletePool(s.code)
    );
    this.touch(s);
  }

  updateTeams(s: InternalSession, updates: { id: string; name: string }[]): void {
    this.assertSetup(s);
    for (const u of updates) {
      const team = s.teams.find((t) => t.id === u.id);
      if (team) team.name = (u.name || team.name).slice(0, 40).trim() || team.name;
    }
    this.touch(s);
  }

  setOrder(s: InternalSession, order: string[]): void {
    this.assertSetup(s);
    const ids = new Set(s.teams.map((t) => t.id));
    const valid =
      order.length === s.teams.length && order.every((id) => ids.has(id));
    if (!valid) throw new Error("Invalid draft order");
    if (new Set(order).size !== order.length)
      throw new Error("Draft order has duplicates");
    s.draftOrder = order;
    this.touch(s);
  }

  claimTeam(s: InternalSession, teamId: string, existingToken?: string): Team {
    const team = s.teams.find((t) => t.id === teamId);
    if (!team) throw new Error("Team not found");
    // Re-claim with the correct token is always allowed (reconnect / refresh).
    if (existingToken && safeEqual(existingToken, team.token)) {
      team.claimed = true;
      this.touch(s);
      return team;
    }
    if (team.claimed) throw new Error("Team already taken");
    team.claimed = true;
    this.touch(s);
    return team;
  }

  startDraft(s: InternalSession): void {
    this.assertSetup(s);
    if (s.teams.length < 2) throw new Error("Need at least 2 teams to draft");
    s.status = "drafting";
    this.touch(s);
  }

  /** Apply a pick. Caller has already authorized the actor. */
  applyPick(s: InternalSession, playerId: string, actingTeamId: string): Pick {
    if (s.status !== "drafting") throw new Error("Draft is not active");
    const total = totalPicks(s.teams.length, s.config.rounds);
    if (s.picks.length >= total) throw new Error("Draft is complete");

    const overall = s.picks.length + 1;
    const onClock = teamIdForOverall(
      overall,
      s.draftOrder,
      s.config.draftStyle
    );
    if (actingTeamId !== onClock)
      throw new Error("It is not that team's turn to pick");

    const player = this.playersFor(s).find((p) => p.id === playerId);
    if (!player) throw new Error("Unknown player");
    if (s.picks.some((p) => p.playerId === playerId))
      throw new Error("Player already drafted");

    const { round, pickInRound } = slotForOverall(overall, s.teams.length);
    const pick: Pick = {
      overall,
      round,
      pickInRound,
      teamId: onClock,
      playerId,
      timestamp: Date.now(),
    };
    s.picks.push(pick);
    if (s.picks.length >= total) s.status = "complete";
    this.touch(s);
    return pick;
  }

  undoLastPick(s: InternalSession): Pick | null {
    if (s.picks.length === 0) return null;
    const pick = s.picks.pop()!;
    if (s.status === "complete") s.status = "drafting";
    this.touch(s);
    return pick;
  }

  /** Resolve which team a given actor controls, or throw if unauthorized. */
  authorizeActor(
    s: InternalSession,
    overall: number,
    opts: { adminToken?: string; teamToken?: string }
  ): string {
    const onClock = teamIdForOverall(overall, s.draftOrder, s.config.draftStyle);
    // Commissioner can always pick (and is the only picker in commissioner mode).
    if (opts.adminToken && safeEqual(opts.adminToken, s.adminToken)) return onClock;
    if (s.config.mode === "self" && opts.teamToken) {
      const team = s.teams.find((t) => safeEqual(opts.teamToken, t.token));
      if (!team) throw new Error("Invalid team token");
      if (team.id !== onClock) throw new Error("It is not your turn to pick");
      return onClock;
    }
    throw new Error("Not authorized to make this pick");
  }

  isAdmin(s: InternalSession, token?: string): boolean {
    return !!token && safeEqual(token, s.adminToken);
  }

  private assertSetup(s: InternalSession): void {
    if (s.status !== "setup")
      throw new Error("Draft has already started — setup is locked");
  }
}

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

/** Clamp/normalize every config field to its legal range. */
function sanitizeConfig(next: DraftConfig): DraftConfig {
  next = { ...next };
  next.rounds = clamp(Math.round(next.rounds), 1, 30);
  next.secondsPerPick = clamp(Math.round(next.secondsPerPick), 0, 600);
  if (next.draftStyle !== "snake" && next.draftStyle !== "linear")
    next.draftStyle = "snake";
  if (next.mode !== "commissioner" && next.mode !== "self")
    next.mode = "commissioner";
  next.leagueName = (next.leagueName || "Fantasy Draft").slice(0, 60);
  next.sounds = Boolean(next.sounds);
  next.announcementVisual = Boolean(next.announcementVisual);
  next.announcementSound = Boolean(next.announcementSound);
  next.announcementSeconds = clamp(Math.round(next.announcementSeconds), 1, 30);
  next.revealVisual = Boolean(next.revealVisual);
  next.revealSound = Boolean(next.revealSound);
  next.revealSeconds = clamp(Math.round(next.revealSeconds), 3, 60);
  next.showPositionRuns = Boolean(next.showPositionRuns);
  next.showValueBadges = Boolean(next.showValueBadges);
  next.showOnDeck = Boolean(next.showOnDeck);
  next.nsfw = Boolean(next.nsfw);
  next.hurryUpButton = Boolean(next.hurryUpButton);
  next.bruhButton = Boolean(next.bruhButton);
  return next;
}

export const store = new SessionStore(createBackend());
