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
}

// Team as exposed to non-owners (token stripped).
export type PublicTeam = Omit<Team, "token">;

export interface DraftConfig {
  leagueName: string;
  draftStyle: DraftStyle;
  mode: DraftMode;
  rounds: number;
  secondsPerPick: number; // 0 = no timer
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
  // Role-specific secrets returned only to the rightful client.
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

// Client -> server events
export interface ClientToServerEvents {
  "session:create": (
    payload: { config: DraftConfig; teamNames: string[] },
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
}

// Server -> client events
export interface ServerToClientEvents {
  "state:update": (state: SessionState) => void;
  "pick:reveal": (event: PickRevealEvent) => void;
}
