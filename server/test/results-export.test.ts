import { describe, it, expect } from "vitest";
import { SessionStore } from "../src/store.js";
import {
  buildResultRows,
  buildResultsCsv,
  buildResultsJson,
  resultsFilenameBase,
} from "../src/results.js";
import { teamIdForOverall } from "../src/draft.js";
import type { Player } from "../../shared/types.js";

function pool(): Player[] {
  const positions: Player["position"][] = ["QB", "RB", "WR", "TE"];
  return Array.from({ length: 8 }, (_, i) => ({
    id: `p${i}`,
    // A comma and a quote in one name exercises CSV escaping.
    name: i === 2 ? `Smith, Jr. "The Truck"` : `Player ${i}`,
    position: positions[i % positions.length],
    nflTeam: "KC",
    byeWeek: 10,
    rank: i + 1,
    positionRank: 1,
    adp: i + 1,
    projectedPoints: 100 - i,
    stats: {},
    blurb: "",
    yahooPlayerKey: `nfl.p.${1000 + i}`,
  }));
}

function completedDraft() {
  const store = new SessionStore();
  const s = store.create("Primo League", ["Ice", "Quarter", "MVP", "Peak"]);
  store.updateConfig(s, { rounds: 2 }); // 4 teams x 2 rounds = 8 picks
  s.players = pool();
  store.startDraft(s);
  for (let overall = 1; overall <= 8; overall++) {
    const teamId = teamIdForOverall(overall, s.draftOrder, s.config.draftStyle);
    store.applyPick(s, `p${overall - 1}`, teamId);
  }
  return { store, s };
}

describe("results export", () => {
  it("builds one row per pick with resolved player/team fields", () => {
    const { store, s } = completedDraft();
    const rows = buildResultRows(s, store.playersFor(s));
    expect(rows).toHaveLength(8);
    expect(rows[0]).toMatchObject({
      overall: 1,
      round: 1,
      pickInRound: 1,
      team: "Ice",
      player: "Player 0",
      position: "QB",
      nflTeam: "KC",
      bye: 10,
      yahooPlayerKey: "nfl.p.1000",
    });
    // Snake: round 2 opens with the last team of round 1.
    expect(rows[4].team).toBe("Peak");
  });

  it("JSON groups rosters by team in draft order and stamps metadata", () => {
    const { store, s } = completedDraft();
    const json = buildResultsJson(s, store.playersFor(s));
    expect(json.league).toBe("Primo League");
    expect(json.status).toBe("complete");
    expect(json.teams.map((t) => t.name)).toEqual(["Ice", "Quarter", "MVP", "Peak"]);
    for (const t of json.teams) expect(t.picks).toHaveLength(2);
    expect(json.picks).toHaveLength(8);
  });

  it("CSV has a header, one line per pick, and escapes commas/quotes", () => {
    const { store, s } = completedDraft();
    const csv = buildResultsCsv(s, store.playersFor(s));
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("Overall,Round,Pick,Team,Player,Position,NFL Team,Bye");
    expect(lines).toHaveLength(9);
    // The tricky name arrives quoted with doubled inner quotes.
    expect(csv).toContain(`"Smith, Jr. ""The Truck"""`);
  });

  it("derives a safe filename base from the league name", () => {
    const { s } = completedDraft();
    expect(resultsFilenameBase(s)).toBe("primo-league");
    s.config.leagueName = "🏈🏈🏈";
    expect(resultsFilenameBase(s)).toBe(`draft-${s.code}`);
  });

  it("exports partial results mid-draft", () => {
    const store = new SessionStore();
    const s = store.create("Half", ["A", "B"]);
    store.updateConfig(s, { rounds: 2 });
    s.players = pool();
    store.startDraft(s);
    store.applyPick(s, "p0", teamIdForOverall(1, s.draftOrder, s.config.draftStyle));
    const json = buildResultsJson(s, store.playersFor(s));
    expect(json.status).toBe("drafting");
    expect(json.picks).toHaveLength(1);
  });
});
