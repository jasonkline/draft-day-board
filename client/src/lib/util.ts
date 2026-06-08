import type { PlayerPosition, SessionState } from "@shared/types";

export const POSITION_COLORS: Record<PlayerPosition, string> = {
  QB: "#ef4444",
  RB: "#22c55e",
  WR: "#3b82f6",
  TE: "#f59e0b",
  K: "#a855f7",
  DEF: "#64748b",
};

export const POSITION_ORDER: PlayerPosition[] = [
  "QB",
  "RB",
  "WR",
  "TE",
  "K",
  "DEF",
];

export function draftedPlayerIds(state: SessionState): Set<string> {
  return new Set(state.picks.map((p) => p.playerId));
}

export function availablePlayers(state: SessionState) {
  const drafted = draftedPlayerIds(state);
  return state.players
    .filter((p) => !drafted.has(p.id))
    .sort((a, b) => a.rank - b.rank);
}

export function teamById(state: SessionState, id: string | null | undefined) {
  if (!id) return undefined;
  return state.teams.find((t) => t.id === id);
}

export function playerById(state: SessionState, id: string | null | undefined) {
  if (!id) return undefined;
  return state.players.find((p) => p.id === id);
}

/**
 * Client-side mirror of the server's draft ordering: which team is on the clock
 * for a 1-based overall pick. Snake reverses the order on even (0-based) rounds.
 * Kept in sync with server/src/draft.ts `teamIdForOverall`.
 */
export function teamIdForOverall(state: SessionState, overall: number): string | undefined {
  const order = state.draftOrder;
  const n = order.length;
  if (n === 0 || overall < 1 || overall > state.totalPicks) return undefined;
  const zero = overall - 1;
  const round = Math.floor(zero / n);
  const idxInRound = zero % n;
  if (state.config.draftStyle === "snake" && round % 2 === 1) {
    return order[n - 1 - idxInRound];
  }
  return order[idxInRound];
}

/**
 * Steal/reach verdict for a pick relative to a player's ADP.
 *
 * diff = overall − adp: negative means drafted earlier than ADP (a reach),
 * positive means the player fell past their ADP (a steal).
 *
 * The threshold scales with the draft: one "round" of ADP = `numTeams` picks.
 * It takes a 2-round swing to flag a steal/reach, except for picks made in the
 * first two rounds (overall ≤ 2 × numTeams), where a single round is enough —
 * early ADP is tighter, so smaller swings are still notable.
 */
export function pickValue(
  overall: number,
  adp: number,
  numTeams: number
): { kind: "steal" | "reach" | "fair"; spots: number } {
  const roundSize = Math.max(1, numTeams);
  const inEarlyRounds = overall <= 2 * roundSize;
  const threshold = inEarlyRounds ? roundSize : 2 * roundSize;
  const diff = Math.round(overall - adp);
  if (diff <= -threshold) return { kind: "reach", spots: -diff };
  if (diff >= threshold) return { kind: "steal", spots: diff };
  return { kind: "fair", spots: Math.abs(diff) };
}

/**
 * Detect a positional run over the most recent picks: if a single position
 * accounts for at least `min` of the last `window` picks, return it.
 */
export function positionRun(
  state: SessionState,
  windowSize = 5,
  min = 3
): { position: PlayerPosition; count: number; of: number } | null {
  const recent = state.picks.slice(-windowSize);
  if (recent.length < min) return null;
  const counts = new Map<PlayerPosition, number>();
  for (const p of recent) {
    const player = playerById(state, p.playerId);
    if (player) counts.set(player.position, (counts.get(player.position) ?? 0) + 1);
  }
  let best: { position: PlayerPosition; count: number } | null = null;
  for (const [position, count] of counts) {
    if (!best || count > best.count) best = { position, count };
  }
  if (best && best.count >= min) {
    return { position: best.position, count: best.count, of: recent.length };
  }
  return null;
}

export function formatStatKey(key: string): string {
  const map: Record<string, string> = {
    rushYds: "Rush Yds",
    rushTD: "Rush TD",
    rec: "Rec",
    recYds: "Rec Yds",
    recTD: "Rec TD",
    targets: "Targets",
    passYds: "Pass Yds",
    passTD: "Pass TD",
    ints: "INT",
    games: "Games",
    fgm: "FG Made",
    fga: "FG Att",
    longFg: "Long FG",
    xp: "XP",
    sacks: "Sacks",
    fumRec: "Fum Rec",
    defTD: "Def TD",
    ptsAllowed: "Pts Allowed/G",
  };
  return map[key] ?? key;
}

// ESPN uses different abbreviations for a few teams than our dataset does.
const ESPN_TEAM_ALIASES: Record<string, string> = {
  WAS: "wsh",
};

/**
 * URL for an NFL team logo from ESPN's CDN. Returns undefined for unknown/blank
 * abbreviations so callers can fall back to text. Images that fail to load
 * (e.g. offline) should be hidden via an onError handler.
 */
export function teamLogoUrl(nflTeam: string | undefined): string | undefined {
  if (!nflTeam) return undefined;
  const abbr = (ESPN_TEAM_ALIASES[nflTeam.toUpperCase()] ?? nflTeam).toLowerCase();
  if (!/^[a-z]{2,3}$/.test(abbr)) return undefined;
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${abbr}.png`;
}

/** Build the shareable absolute URL for a given route. */
export function absUrl(path: string): string {
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
}
