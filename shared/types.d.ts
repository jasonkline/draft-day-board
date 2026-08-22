// Shared domain types used by both the server and the client.

export type DraftStyle = "snake" | "linear";
export type DraftMode = "commissioner" | "self";
export type SessionStatus = "setup" | "drafting" | "complete";

export type PlayerPosition = "QB" | "RB" | "WR" | "TE" | "K" | "DEF";

export interface Player {
  id: string;
  name: string;
  position: PlayerPosition;
  nflTeam: string;
  byeWeek: number;
  rank: number; // overall preseason rank
  positionRank: number;
  adp: number; // average draft position
  projectedPoints: number;
  // Flavorful per-position stat line for the TV reveal/spotlight.
  stats: Record<string, string | number>;
  blurb: string;
  // Optional player headshot (populated from real data sources like Yahoo).
  headshotUrl?: string;
  // Yahoo player key (e.g. "nfl.p.40055") when sourced from Yahoo. The numeric
  // suffix is the `pid` Yahoo's offline-draft results form expects, enabling an
  // exact (non-fuzzy) push of finished picks back into a Yahoo league. Absent
  // for the built-in dataset.
  yahooPlayerKey?: string;
}

export interface Team {
  id: string;
  name: string;
  // Secret capability token for the participant controlling this team (self-pick mode).
  // Never sent to the board/other participants.
  token: string;
  claimed: boolean;
  avatarColor: string;
  emoji: string;
  // Optional team logo (e.g. imported from a Yahoo league). When present the UI
  // shows it in place of the emoji avatar.
  logoUrl?: string;
}

// Team as exposed to non-owners (token stripped).
export type PublicTeam = Omit<Team, "token">;

export interface DraftConfig {
  leagueName: string;
  draftStyle: DraftStyle;
  mode: DraftMode;
  rounds: number;
  secondsPerPick: number; // 0 = no timer

  // ---- Presentation & extras (additional options) ----
  // The reveal-show settings below are editable live during the draft (it's the
  // stuff that can get annoying); the board-display group locks at start like
  // the core rules.
  //
  // The big-screen reveal has two beats, each an independent visual + sound:
  //   1. the "THE PICK IS IN" announcement (suspense), and
  //   2. the player-card reveal (the payoff).
  // Sound toggles only affect audio; visual toggles only affect the on-screen
  // beat. Each sound also obeys the master `sounds` switch.

  sounds: boolean; // master switch over both cue sounds

  announcementVisual: boolean; // show the "THE PICK IS IN" screen
  announcementSound: boolean; // play the chime when a pick lands
  announcementSeconds: number; // how long the announcement holds

  revealVisual: boolean; // show the dramatic full-screen player card
  revealSound: boolean; // play the fanfare on the card reveal
  revealSeconds: number; // how long the reveal card holds

  // Board display elements — lock at start.
  showPositionRuns: boolean; // "🔥 QB RUN" banner on the board rail
  showValueBadges: boolean; // STEAL / REACH badges on the last-pick card
  showOnDeck: boolean; // the "ON DECK" next-team indicator

  // ---- NSFW (rated-R extras for adult leagues) — live-editable, off by default ----
  nsfw: boolean; // master switch for all rated-R features
  hurryUpButton: boolean; // "hurry the f*** up" heckle button for off-clock players
  bruhButton: boolean; // "bruh… you stupid" heckle button for off-clock players
}

// The NSFW heckle buttons an off-clock player can fire at the board.
export type HeckleKind = "hurryUp" | "bruh";

// Who fired off a heckle (slim, token-free) for the board to display.
export interface HeckleFrom {
  name: string;
  emoji: string;
  color: string;
}

export interface Pick {
  overall: number; // 1-based overall pick number
  round: number; // 1-based
  pickInRound: number; // 1-based
  teamId: string;
  playerId: string;
  timestamp: number;
}

export interface SlotRef {
  overall: number;
  round: number;
  pickInRound: number;
  teamId: string;
}

// Full session snapshot sent to clients (no secret tokens).
export interface SessionState {
  code: string;
  status: SessionStatus;
  config: DraftConfig;
  teams: PublicTeam[];
  // draftOrder is the round-1 ordering of team ids; snake/linear derived from style.
  draftOrder: string[];
  players: Player[];
  picks: Pick[];
  currentOverall: number | null; // null when complete
  onClockTeamId: string | null;
  pickDeadline: number | null; // epoch ms, or null if no timer
  totalPicks: number;
  updatedAt: number;
}

// ---- Socket.IO event payloads ----

export interface JoinAck {
  ok: boolean;
  error?: string;
  state?: SessionState;
  // Role-specific secrets returned only to the rightful client, and only on
  // first issuance (session:create / session:claimTeam) — never echoed back
  // on rejoin.
  adminToken?: string;
  teamToken?: string;
  teamId?: string;
}

export interface PickRevealEvent {
  pick: Pick;
  player: Player;
  team: PublicTeam;
  isFirstOverall: boolean;
  isLastPick: boolean;
}

// ---- Pushing a finished draft back into Yahoo (offline "Submit Draft Results") ----
// The importer userscript runs on yahoo.com and fetches this from the server. It
// maps our picks to the numeric player ids Yahoo's offline-draft form expects.

export interface YahooExportPick {
  round: number;
  pid: string; // Yahoo numeric player id (the player_key suffix, e.g. "40055")
  playerName: string;
  position: PlayerPosition;
}

export interface YahooExportTeam {
  // 1-based slot in the league team list — matches the order of Yahoo's team
  // dropdown on the offline-draft form (the league was imported in this order).
  order: number;
  name: string;
  picks: YahooExportPick[]; // sorted by round ascending → drops into Yahoo's pick slots
  missing: number; // this team's drafted players with no Yahoo id (can't be pushed)
}

export interface YahooDraftExport {
  code: string;
  leagueName: string;
  rounds: number;
  status: SessionStatus;
  complete: boolean;
  generatedAt: number;
  teams: YahooExportTeam[];
  warnings: string[];
}

// Client -> server events
export interface ClientToServerEvents {
  "session:create": (
    // config is applied as a patch over server defaults, so a partial is fine.
    payload: { config: Partial<DraftConfig>; teamNames: string[] },
    cb: (ack: JoinAck) => void
  ) => void;
  "session:watch": (payload: { code: string }, cb: (ack: JoinAck) => void) => void;
  "session:adminJoin": (
    payload: { code: string; adminToken: string },
    cb: (ack: JoinAck) => void
  ) => void;
  "session:claimTeam": (
    payload: { code: string; teamId: string; teamToken?: string },
    cb: (ack: JoinAck) => void
  ) => void;
  "admin:updateConfig": (
    payload: { code: string; adminToken: string; config: Partial<DraftConfig> },
    cb: (ack: JoinAck) => void
  ) => void;
  "admin:updateTeams": (
    payload: { code: string; adminToken: string; teams: { id: string; name: string }[] },
    cb: (ack: JoinAck) => void
  ) => void;
  "admin:setOrder": (
    payload: { code: string; adminToken: string; order: string[] },
    cb: (ack: JoinAck) => void
  ) => void;
  "admin:startDraft": (
    payload: { code: string; adminToken: string },
    cb: (ack: JoinAck) => void
  ) => void;
  "admin:undoPick": (
    payload: { code: string; adminToken: string },
    cb: (ack: JoinAck) => void
  ) => void;
  "admin:refreshPlayers": (
    payload: { code: string; adminToken: string },
    cb: (ack: { ok: boolean; error?: string; count?: number }) => void
  ) => void;
  "pick:make": (
    payload: {
      code: string;
      playerId: string;
      // authorization: either adminToken (commissioner) or teamToken (self-pick)
      adminToken?: string;
      teamToken?: string;
    },
    cb: (ack: { ok: boolean; error?: string }) => void
  ) => void;
  // NSFW: an off-clock player heckles whoever is on the clock. teamToken is
  // optional and used only to attribute the heckle on the board.
  "fan:heckle": (
    payload: { code: string; kind: HeckleKind; teamToken?: string },
    cb: (ack: { ok: boolean; error?: string }) => void
  ) => void;
}

// Server -> client events
export interface ServerToClientEvents {
  "state:update": (state: SessionState) => void;
  "pick:reveal": (event: PickRevealEvent) => void;
  // Fire the heckle animation + audio (by kind) on the board.
  "fan:heckle": (event: { kind: HeckleKind; from?: HeckleFrom }) => void;
}
