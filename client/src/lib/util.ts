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

/** Build the shareable absolute URL for a given route. */
export function absUrl(path: string): string {
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
}
