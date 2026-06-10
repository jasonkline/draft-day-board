// Build the per-team, Yahoo-id-keyed view of a finished draft so the commissioner
// can push it into Yahoo's offline "Submit Draft Results" form (via the importer
// userscript). Pure and I/O-free — it just reshapes the session.

import type {
  YahooDraftExport,
  YahooExportTeam,
  YahooExportPick,
} from "../../../shared/types.js";
import { store, type InternalSession } from "../store.js";

/** Numeric Yahoo player id from a player_key like "nfl.p.40055" → "40055". */
function pidFromKey(key: string | undefined): string | null {
  if (!key) return null;
  const m = /(\d+)$/.exec(key);
  return m ? m[1] : null;
}

/**
 * Reshape a session's picks into the structure Yahoo's offline-draft form wants.
 * Teams come out in league order (matching Yahoo's team dropdown — the league was
 * imported in this order); each team's picks are sorted by round so they map
 * straight onto Yahoo's pick slots. Players drafted from the built-in dataset have
 * no Yahoo id and can't be pushed — they're counted in `missing` and surfaced in
 * `warnings` so the commissioner knows to enter those by hand.
 */
export function buildDraftExport(s: InternalSession): YahooDraftExport {
  const byId = new Map(store.playersFor(s).map((p) => [p.id, p]));
  const warnings: string[] = [];

  const teams: YahooExportTeam[] = s.teams.map((team, i) => {
    const picks: YahooExportPick[] = [];
    let missing = 0;
    const teamPicks = s.picks
      .filter((p) => p.teamId === team.id)
      .sort((a, b) => a.round - b.round);
    for (const pick of teamPicks) {
      const player = byId.get(pick.playerId);
      const pid = pidFromKey(player?.yahooPlayerKey);
      if (!player || !pid) {
        missing++;
        continue;
      }
      picks.push({
        round: pick.round,
        pid,
        playerName: player.name,
        position: player.position,
      });
    }
    return { order: i + 1, name: team.name, picks, missing };
  });

  const totalMissing = teams.reduce((n, t) => n + t.missing, 0);
  if (totalMissing > 0) {
    warnings.push(
      `${totalMissing} drafted player(s) have no Yahoo ID and were skipped. ` +
        `Push-to-Yahoo only maps players from a Yahoo-imported pool — import the ` +
        `league and re-sync players (or enter those picks by hand).`
    );
  }
  const total = store.toPublicState(s).totalPicks;
  if (s.picks.length < total) {
    warnings.push(
      `Draft isn't finished (${s.picks.length} of ${total} picks). ` +
        `Only completed picks are included.`
    );
  }

  return {
    code: s.code,
    leagueName: s.config.leagueName,
    rounds: s.config.rounds,
    status: s.status,
    complete: s.status === "complete",
    generatedAt: Date.now(),
    teams,
    warnings,
  };
}
