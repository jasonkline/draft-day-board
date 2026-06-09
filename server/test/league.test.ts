import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseLeagueList,
  parseLeagueSettings,
  parseTeams,
  scoringLabelFromType,
} from "../src/yahoo/league.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

// These fixtures are real Yahoo Fantasy API responses (a 10-team, full-PPR NFL
// league) with names/guids/urls scrubbed — the awkward shape is preserved.
describe("yahoo league parsing", () => {
  it("parses the user's league list", () => {
    const leagues = parseLeagueList(fixture("users-leagues.json"));
    expect(leagues).toHaveLength(1);
    expect(leagues[0]).toMatchObject({
      leagueKey: "470.l.44749",
      season: "2026",
      numTeams: 10,
      scoringLabel: "H2H",
    });
  });

  it("parses settings: team count, drafted rounds (excludes IR), PPR", () => {
    const s = parseLeagueSettings(fixture("league-settings.json"));
    expect(s.numTeams).toBe(10);
    // 1 QB + 3 WR + 2 RB + 1 TE + 1 W/R/T + 1 K + 1 DEF + 6 BN = 16; IR excluded.
    expect(s.rounds).toBe(16);
    expect(s.scoringType).toBe("head");
    expect(s.receptionValue).toBe(1); // full PPR
  });

  it("parses teams (name + logo) in order", () => {
    const teams = parseTeams(fixture("league-teams.json"));
    expect(teams).toHaveLength(10);
    expect(teams.every((t) => t.name.length > 0)).toBe(true);
    // every team in this league has a logo url
    expect(teams.every((t) => typeof t.logoUrl === "string")).toBe(true);
  });

  it("labels scoring types", () => {
    expect(scoringLabelFromType("head")).toBe("H2H");
    expect(scoringLabelFromType("point")).toBe("Points");
    expect(scoringLabelFromType("roto")).toBe("Rotisserie");
  });

  it("tolerates an empty/garbage envelope without throwing", () => {
    expect(parseLeagueList({})).toEqual([]);
    expect(parseTeams({})).toEqual([]);
    const s = parseLeagueSettings({});
    expect(s.rounds).toBe(0);
    expect(s.receptionValue).toBeNull();
  });
});
