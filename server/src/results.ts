// Draft-results serialization for the CSV/JSON download endpoints. Pure and
// I/O-free (like yahoo/export.ts, which stays dedicated to the push-to-Yahoo
// userscript) so it's unit-testable without HTTP.

import type { Player } from "../../shared/types.js";
import type { InternalSession } from "./store.js";

export interface ResultRow {
  overall: number;
  round: number;
  pickInRound: number;
  teamId: string;
  team: string;
  player: string;
  position: string;
  nflTeam: string;
  bye: number | "";
  yahooPlayerKey?: string;
}

export function buildResultRows(s: InternalSession, players: Player[]): ResultRow[] {
  const byId = new Map(players.map((p) => [p.id, p]));
  const teamName = new Map(s.teams.map((t) => [t.id, t.name]));
  return s.picks.map((pick) => {
    const p = byId.get(pick.playerId);
    const row: ResultRow = {
      overall: pick.overall,
      round: pick.round,
      pickInRound: pick.pickInRound,
      teamId: pick.teamId,
      team: teamName.get(pick.teamId) ?? pick.teamId,
      player: p?.name ?? pick.playerId,
      position: p?.position ?? "",
      nflTeam: p?.nflTeam ?? "",
      bye: p?.byeWeek || "",
    };
    if (p?.yahooPlayerKey) row.yahooPlayerKey = p.yahooPlayerKey;
    return row;
  });
}

export function buildResultsJson(s: InternalSession, players: Player[]) {
  const rows = buildResultRows(s, players);
  return {
    league: s.config.leagueName,
    code: s.code,
    status: s.status,
    draftStyle: s.config.draftStyle,
    rounds: s.config.rounds,
    exportedAt: new Date().toISOString(),
    // Rosters by team, in draft order.
    teams: s.draftOrder.map((id) => ({
      name: s.teams.find((t) => t.id === id)?.name ?? id,
      picks: rows.filter((r) => r.teamId === id),
    })),
    picks: rows,
  };
}

function csvField(v: string | number): string {
  const str = String(v);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export function buildResultsCsv(s: InternalSession, players: Player[]): string {
  const header = ["Overall", "Round", "Pick", "Team", "Player", "Position", "NFL Team", "Bye"];
  const lines = buildResultRows(s, players).map((r) =>
    [r.overall, r.round, r.pickInRound, r.team, r.player, r.position, r.nflTeam, r.bye]
      .map(csvField)
      .join(",")
  );
  return [header.join(","), ...lines].join("\r\n") + "\r\n";
}

/** Safe download-filename base derived from the league name. */
export function resultsFilenameBase(s: InternalSession): string {
  const base = s.config.leagueName
    .replace(/[^\w\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
  return base || `draft-${s.code}`;
}
