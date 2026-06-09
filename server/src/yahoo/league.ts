// Fetch a specific Yahoo league's structure (teams, roster size, scoring) and
// the authorized account's league list. The parsing functions are pure and
// I/O-free so they can be unit-tested against captured JSON fixtures; the thin
// `listLeagues`/`fetchLeague` wrappers add the network call.
//
// Yahoo's JSON is awkward: collections are objects keyed by numeric strings with
// a trailing `count`, resources are `[meta, { subResource }]` arrays, and
// metadata is sometimes an array of single-key objects. We flatten as we go.

import type { YahooLeagueSummary } from "../../../shared/types.js";
import { yahooGet } from "./client.js";

// Yahoo NFL stat id for Receptions — its scoring modifier tells PPR vs standard.
const RECEPTION_STAT_ID = 11;
// Roster slots that are NOT drafted (injured-reserve style), excluded from the
// round count. Bench (BN) IS drafted, so it counts.
const UNDRAFTED_SLOTS = new Set(["IR", "IL", "NA"]);

/** Merge an array of single-key objects (Yahoo's metadata style) into one map. */
function flatten(arr: unknown): Record<string, any> {
  if (Array.isArray(arr)) {
    const out: Record<string, any> = {};
    for (const item of arr) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        Object.assign(out, item);
      }
    }
    return out;
  }
  if (arr && typeof arr === "object") return arr as Record<string, any>;
  return {};
}

/** Iterate a Yahoo keyed collection ({ "0": x, "1": y, count: n }) values. */
function collectionValues(obj: any): any[] {
  if (!obj || typeof obj !== "object") return [];
  return Object.keys(obj)
    .filter((k) => k !== "count")
    .map((k) => obj[k]);
}

/** A resource is `[meta, { sub }]`; pull `meta` and a named sub-resource. */
function resourceMeta(resource: any): Record<string, any> {
  if (Array.isArray(resource)) return flatten(resource[0]);
  return flatten(resource);
}
function resourceSub(resource: any, key: string): any {
  if (!Array.isArray(resource)) return resource?.[key];
  for (const part of resource) {
    if (part && typeof part === "object" && key in part) return part[key];
  }
  return undefined;
}

/** Human label for the raw `scoring_type` code. */
export function scoringLabelFromType(scoringType: string | undefined): string {
  switch (scoringType) {
    case "head":
      return "H2H";
    case "point":
      return "Points";
    case "roto":
      return "Rotisserie";
    default:
      return scoringType ? scoringType : "—";
  }
}

/** PPR flavor from the reception modifier value (null/0 = standard). */
function pprLabel(receptionValue: number | null): string {
  if (receptionValue == null || receptionValue <= 0) return "Standard";
  if (receptionValue >= 1) return "Full PPR";
  if (receptionValue === 0.5) return "Half PPR";
  return `${receptionValue} PPR`;
}

// ---- league list (users;use_login=1/games;game_keys=nfl/leagues) ----

/** Parse the user's leagues envelope into flat summaries. Pure. */
export function parseLeagueList(json: any): YahooLeagueSummary[] {
  const out: YahooLeagueSummary[] = [];
  const users = json?.fantasy_content?.users;
  for (const userEntry of collectionValues(users)) {
    const games = resourceSub(userEntry?.user, "games");
    for (const gameEntry of collectionValues(games)) {
      const game = gameEntry?.game;
      const gameMeta = resourceMeta(game);
      const season = String(gameMeta.season ?? "");
      const leagues = resourceSub(game, "leagues");
      for (const leagueEntry of collectionValues(leagues)) {
        const meta = resourceMeta(leagueEntry?.league);
        if (!meta.league_key) continue;
        out.push({
          leagueKey: String(meta.league_key),
          name: String(meta.name ?? "Unnamed league"),
          season: String(meta.season ?? season),
          numTeams: Number(meta.num_teams) || 0,
          scoringLabel: scoringLabelFromType(meta.scoring_type),
        });
      }
    }
  }
  return out;
}

// ---- league settings (league/{key}/settings) ----

export interface LeagueSettings {
  leagueName: string;
  numTeams: number;
  rounds: number; // total drafted roster slots (starters + bench, minus IR/IL)
  scoringType: string | undefined;
  receptionValue: number | null;
}

/** Parse a league/settings response. Pure. */
export function parseLeagueSettings(json: any): LeagueSettings {
  const league = json?.fantasy_content?.league;
  const meta = resourceMeta(league);
  const settings = resourceSub(league, "settings");
  const s = Array.isArray(settings) ? flatten(settings[0]) : flatten(settings);

  let rounds = 0;
  for (const rp of collectionValues(s.roster_positions)) {
    const pos = rp?.roster_position ?? rp;
    const name = String(pos?.position ?? "");
    if (UNDRAFTED_SLOTS.has(name)) continue;
    rounds += Number(pos?.count) || 0;
  }

  let receptionValue: number | null = null;
  const mods = s.stat_modifiers?.stats;
  if (Array.isArray(mods)) {
    for (const m of mods) {
      const stat = m?.stat ?? m;
      if (Number(stat?.stat_id) === RECEPTION_STAT_ID) {
        const v = parseFloat(stat?.value);
        receptionValue = Number.isFinite(v) ? v : null;
      }
    }
  }

  return {
    leagueName: String(meta.name ?? "Fantasy Draft"),
    numTeams: Number(meta.num_teams) || 0,
    rounds,
    scoringType: meta.scoring_type,
    receptionValue,
  };
}

// ---- league teams (league/{key}/teams) ----

export interface LeagueTeam {
  name: string;
  logoUrl?: string;
}

/**
 * First usable logo url from a team's `team_logos` collection. Only https URLs
 * qualify — these are broadcast to every client and rendered as <img src>, so
 * other schemes (javascript:, data:, http:) are dropped at the boundary.
 */
function teamLogoUrl(meta: Record<string, any>): string | undefined {
  for (const entry of collectionValues(meta.team_logos)) {
    const logo = entry?.team_logo ?? entry;
    if (typeof logo?.url === "string" && logo.url.startsWith("https://"))
      return logo.url;
  }
  return undefined;
}

/** Parse a league/teams response into ordered teams (name + logo). Pure. */
export function parseTeams(json: any): LeagueTeam[] {
  const teams = resourceSub(json?.fantasy_content?.league, "teams");
  const out: LeagueTeam[] = [];
  for (const entry of collectionValues(teams)) {
    const meta = resourceMeta(entry?.team);
    const name =
      flatten(meta.name).full ?? (typeof meta.name === "string" ? meta.name : null);
    if (!name) continue;
    const team: LeagueTeam = { name: String(name) };
    const logoUrl = teamLogoUrl(meta);
    if (logoUrl) team.logoUrl = logoUrl;
    out.push(team);
  }
  return out;
}

// ---- normalized import shape + network wrappers ----

export interface LeagueImport {
  leagueKey: string;
  leagueName: string;
  numTeams: number;
  rounds: number;
  teams: LeagueTeam[];
  scoringLabel: string; // refined, e.g. "10-team · Full PPR"
}

/** List the authorized account's NFL leagues for the current season. */
export async function listLeagues(): Promise<YahooLeagueSummary[]> {
  const json = await yahooGet("users;use_login=1/games;game_keys=nfl/leagues");
  return parseLeagueList(json);
}

/** Fetch one league's settings + teams and normalize for import. */
export async function fetchLeague(leagueKey: string): Promise<LeagueImport> {
  if (!/^[0-9]+\.l\.[0-9]+$/.test(leagueKey)) {
    throw new Error(`Invalid league key: ${leagueKey}`);
  }
  const [settingsJson, teamsJson] = await Promise.all([
    yahooGet(`league/${leagueKey}/settings`),
    yahooGet(`league/${leagueKey}/teams`),
  ]);
  const settings = parseLeagueSettings(settingsJson);
  const teams = parseTeams(teamsJson);
  const numTeams = teams.length || settings.numTeams;
  const flavor =
    settings.scoringType === "head" || settings.scoringType === "point"
      ? pprLabel(settings.receptionValue)
      : scoringLabelFromType(settings.scoringType);

  return {
    leagueKey,
    leagueName: settings.leagueName,
    numTeams,
    rounds: settings.rounds,
    teams,
    scoringLabel: `${numTeams}-team · ${flavor}`,
  };
}
