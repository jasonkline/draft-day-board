import { describe, it, expect } from "vitest";
import { SessionStore } from "../src/store.js";
import { buildDraftExport } from "../src/yahoo/export.js";
import { teamIdForOverall } from "../src/draft.js";
import type { Player } from "../../shared/types.js";

// A pool whose players carry Yahoo keys (plus one that doesn't), so we can prove
// the export maps to Yahoo numeric ids and reports the unmappable one.
function keyedPool(): Player[] {
  const positions: Player["position"][] = ["QB", "RB", "WR", "TE", "K", "DEF"];
  const players: Player[] = [];
  for (let i = 0; i < 8; i++) {
    players.push({
      id: `p${i}`,
      name: `Player ${i}`,
      position: positions[i % positions.length],
      nflTeam: "FA",
      byeWeek: 7,
      rank: i + 1,
      positionRank: 1,
      adp: i + 1,
      projectedPoints: 100 - i,
      stats: {},
      blurb: "",
      yahooPlayerKey: `nfl.p.${1000 + i}`,
    });
  }
  // One drafted-from-built-in-style player with no Yahoo key.
  players.push({
    id: "nokey",
    name: "Mystery Man",
    position: "WR",
    nflTeam: "FA",
    byeWeek: 7,
    rank: 9,
    positionRank: 2,
    adp: 9,
    projectedPoints: 50,
    stats: {},
    blurb: "",
  });
  return players;
}

describe("buildDraftExport", () => {
  function completedDraft() {
    const store = new SessionStore();
    const s = store.create("Primo League", ["Ice", "Quarter", "MVP", "Peak"]);
    store.updateConfig(s, { rounds: 2 }); // 4 teams x 2 = 8 picks
    s.players = keyedPool(); // bypass the sidecar file write
    store.startDraft(s);

    // Snake order over 8 picks; last pick (overall 8 → team 1, round 2) is the
    // keyless player so we exercise the "missing" path.
    const order = ["p0", "p1", "p2", "p3", "p4", "p5", "p6", "nokey"];
    for (let overall = 1; overall <= 8; overall++) {
      const teamId = teamIdForOverall(overall, s.draftOrder, s.config.draftStyle);
      store.applyPick(s, order[overall - 1], teamId);
    }
    return { store, s };
  }

  it("maps each team's picks to Yahoo numeric ids, in league + round order", () => {
    const { s } = completedDraft();
    const exp = buildDraftExport(s);

    expect(exp.complete).toBe(true);
    expect(exp.leagueName).toBe("Primo League");
    expect(exp.teams).toHaveLength(4);
    // Teams come out in league order with 1-based `order`.
    expect(exp.teams.map((t) => t.order)).toEqual([1, 2, 3, 4]);
    expect(exp.teams.map((t) => t.name)).toEqual(["Ice", "Quarter", "MVP", "Peak"]);

    // pid is the numeric suffix of the player_key (nfl.p.1000 -> "1000").
    const team2 = exp.teams[1];
    for (const pick of team2.picks) expect(pick.pid).toMatch(/^\d+$/);
    // Picks within a team are sorted by round ascending.
    for (const t of exp.teams) {
      const rounds = t.picks.map((p) => p.round);
      expect(rounds).toEqual([...rounds].sort((a, b) => a - b));
    }
  });

  it("counts and warns about picks with no Yahoo id", () => {
    const { s } = completedDraft();
    const exp = buildDraftExport(s);

    // Team 1 holds overall 1 (p0, keyed) and overall 8 (nokey, unmapped).
    const team1 = exp.teams[0];
    expect(team1.missing).toBe(1);
    expect(team1.picks).toHaveLength(1); // only the keyed pick survives
    expect(team1.picks[0].pid).toBe("1000");

    const totalMissing = exp.teams.reduce((n, t) => n + t.missing, 0);
    expect(totalMissing).toBe(1);
    expect(exp.warnings.some((w) => /no Yahoo ID/i.test(w))).toBe(true);
  });

  it("flags an unfinished draft in warnings", () => {
    const store = new SessionStore();
    const s = store.create("Half Draft", ["A", "B", "C", "D"]);
    store.updateConfig(s, { rounds: 2 });
    s.players = keyedPool();
    store.startDraft(s);
    // Only 2 of 8 picks.
    store.applyPick(s, "p0", teamIdForOverall(1, s.draftOrder, s.config.draftStyle));
    store.applyPick(s, "p1", teamIdForOverall(2, s.draftOrder, s.config.draftStyle));

    const exp = buildDraftExport(s);
    expect(exp.complete).toBe(false);
    expect(exp.warnings.some((w) => /isn't finished/i.test(w))).toBe(true);
  });
});
