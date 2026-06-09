import { customAlphabet } from "nanoid";
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  DraftConfig,
  Pick,
  Player,
  SessionState,
  Team,
} from "../../shared/types.js";
import { PLAYERS } from "./players.js";
import { slotForOverall, teamIdForOverall, totalPicks } from "./draft.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const DATA_FILE = join(DATA_DIR, "sessions.json");
// Per-session imported player pools live as sidecar files here, keyed by code,
// so they survive restarts without bloating sessions.json (which is rewritten
// on every pick). Gitignored alongside the rest of server/data.
const POOLS_DIR = join(DATA_DIR, "pools");
const poolFile = (code: string) => join(POOLS_DIR, `${code}.json`);

// Unambiguous code alphabet (no 0/O/1/I) for easy reading off a TV / typing on a phone.
const codeId = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 5);
const tokenId = customAlphabet(
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  24
);

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

  constructor() {
    this.load();
  }

  // ---- persistence ----
  private load(): void {
    try {
      if (!existsSync(DATA_FILE)) return;
      const raw = readFileSync(DATA_FILE, "utf8");
      const arr = JSON.parse(raw) as InternalSession[];
      for (const s of arr) {
        // Backfill config fields added after this session was persisted, so the
        // new presentation toggles don't read as undefined (≈ everything off).
        s.config = { ...defaultConfig(s.config.leagueName), ...s.config };
        // Rehydrate the session's imported pool from its sidecar, if any.
        s.players = this.loadPoolSidecar(s.code);
        this.sessions.set(s.code, s);
      }
      // eslint-disable-next-line no-console
      console.log(`[store] loaded ${arr.length} session(s) from disk`);
    } catch (err) {
      console.error("[store] failed to load sessions:", err);
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        mkdirSync(DATA_DIR, { recursive: true });
        // `players` is a per-session sidecar — keep it out of sessions.json so
        // the file stays small (it's rewritten on every pick).
        writeFileSync(
          DATA_FILE,
          JSON.stringify([...this.sessions.values()], (k, v) =>
            k === "players" ? undefined : v
          )
        );
      } catch (err) {
        console.error("[store] failed to save sessions:", err);
      }
    }, 250);
  }

  /** Read a session's imported pool sidecar, or undefined if none/invalid. */
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

  // ---- lifecycle ----
  create(leagueName: string, teamNames: string[]): InternalSession {
    let code = codeId();
    while (this.sessions.has(code)) code = codeId();

    const names =
      teamNames.length > 0
        ? teamNames
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
    const next = { ...s.config, ...patch };
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
    s.config = next;
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
      if (t.logoUrl) team.logoUrl = t.logoUrl;
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
    try {
      mkdirSync(POOLS_DIR, { recursive: true });
      writeFileSync(poolFile(s.code), JSON.stringify(players));
    } catch (err) {
      console.error(`[store] failed to write pool sidecar for ${s.code}:`, err);
    }
    this.touch(s);
  }

  /** Drop a session's imported pool, reverting it to the universal one. */
  clearSessionPlayers(s: InternalSession): void {
    this.assertSetup(s);
    delete s.players;
    try {
      rmSync(poolFile(s.code), { force: true });
    } catch (err) {
      console.error(`[store] failed to remove pool sidecar for ${s.code}:`, err);
    }
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
    if (existingToken && existingToken === team.token) {
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
    if (opts.adminToken && opts.adminToken === s.adminToken) return onClock;
    if (s.config.mode === "self" && opts.teamToken) {
      const team = s.teams.find((t) => t.token === opts.teamToken);
      if (!team) throw new Error("Invalid team token");
      if (team.id !== onClock) throw new Error("It is not your turn to pick");
      return onClock;
    }
    throw new Error("Not authorized to make this pick");
  }

  isAdmin(s: InternalSession, token?: string): boolean {
    return !!token && token === s.adminToken;
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

export const store = new SessionStore();
