// Fetch the NFL player pool from Yahoo and map it into our `Player` shape.
//
// Yahoo's JSON is awkward: collections are objects keyed by numeric strings with
// a trailing `count`, and each player's metadata is an array of single-key
// objects. We flatten those into plain maps before reading fields.

import type { Player, PlayerPosition } from "../../../shared/types.js";
import { yahooGet } from "./client.js";

const OUR_POSITIONS: PlayerPosition[] = ["QB", "RB", "WR", "TE", "K", "DEF"];
const PAGE_SIZE = 25; // Yahoo caps players collections at 25 per request.

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

/**
 * Yahoo headshots come wrapped through their image resizer as a tiny face-crop,
 * e.g. `https://s.yimg.com/iu/api/res/1.2/HASH/PARAMS/https://.../players_l/40055.png`.
 * The trailing URL is the full-size transparent player cutout — much better for
 * a big TV reveal. Unwrap to it when present.
 */
function unwrapHeadshot(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const inner = url.indexOf("https://", "https://".length);
  return inner > 0 ? url.slice(inner) : url;
}

/** Pick the first eligible fantasy position we recognize. */
function mapPosition(meta: Record<string, any>): PlayerPosition | null {
  const candidates: string[] = [];
  if (typeof meta.display_position === "string") {
    candidates.push(...meta.display_position.split(",").map((s: string) => s.trim()));
  }
  if (typeof meta.primary_position === "string") candidates.push(meta.primary_position);
  if (Array.isArray(meta.eligible_positions)) {
    for (const ep of meta.eligible_positions) {
      const p = flatten(ep).position;
      if (typeof p === "string") candidates.push(p);
    }
  }
  for (const c of candidates) {
    if ((OUR_POSITIONS as string[]).includes(c)) return c as PlayerPosition;
  }
  return null;
}

interface RawPlayer {
  name: string;
  position: PlayerPosition;
  nflTeam: string;
  byeWeek: number;
  adp: number | null; // real average draft pick (lower = better); null if undrafted
  percentDrafted: number | null;
  headshotUrl?: string;
}

/** Map one Yahoo `player` entry (array form) into our intermediate shape. */
function mapRawPlayer(entry: any): RawPlayer | null {
  // entry.player is [ metaArray, {draft_analysis}, {ownership}, ... ]
  const parts: any[] = entry?.player;
  if (!Array.isArray(parts) || parts.length === 0) return null;

  const meta = flatten(parts[0]);
  const position = mapPosition(meta);
  if (!position) return null; // skip IDP / non-fantasy positions

  const name =
    flatten(meta.name).full ?? (typeof meta.name === "string" ? meta.name : null);
  if (!name) return null;

  const nflTeam = String(meta.editorial_team_abbr ?? "FA").toUpperCase();
  const byeWeek = Number(flatten(meta.bye_weeks).week ?? 0) || 0;

  const headshotUrl = unwrapHeadshot(
    flatten(meta.headshot).url ??
      (typeof meta.image_url === "string" ? meta.image_url : undefined)
  );

  // draft_analysis / ownership live in the sibling objects of the player array.
  let adp: number | null = null;
  let percentDrafted: number | null = null;
  for (let i = 1; i < parts.length; i++) {
    const obj = parts[i];
    if (obj && typeof obj === "object" && "draft_analysis" in obj) {
      const da = flatten(obj.draft_analysis);
      const ap = parseFloat(da.average_pick);
      adp = Number.isFinite(ap) && ap > 0 ? ap : null;
      const pd = parseFloat(da.percent_drafted);
      percentDrafted = Number.isFinite(pd) ? pd : null;
    }
  }

  return { name, position, nflTeam, byeWeek, adp, percentDrafted, headshotUrl };
}

/** Pull one page of a single position, sorted by Yahoo's overall rank. */
async function fetchPage(position: PlayerPosition, start: number): Promise<RawPlayer[]> {
  const path = `game/nfl/players;position=${position};start=${start};count=${PAGE_SIZE};sort=OR;out=draft_analysis,ownership`;
  const data = await yahooGet(path);
  const game = data?.fantasy_content?.game;
  const playersObj = Array.isArray(game)
    ? game.find((g: any) => g && typeof g === "object" && "players" in g)?.players
    : undefined;
  if (!playersObj) return [];

  const raws: RawPlayer[] = [];
  for (const key of Object.keys(playersObj)) {
    if (key === "count") continue;
    const mapped = mapRawPlayer(playersObj[key]);
    if (mapped) raws.push(mapped);
  }
  return raws;
}

function projectedFromRank(rank: number): number {
  // No real season projection is exposed; derive a smooth, descending number so
  // the player pool shows sensible values. Top player ~320, tapering down.
  return Math.round(Math.max(20, 330 - rank * 1.4) * 10) / 10;
}

function buildStats(raw: RawPlayer): Record<string, string | number> {
  const stats: Record<string, string | number> = {};
  if (raw.adp != null) stats["ADP"] = raw.adp.toFixed(1);
  if (raw.percentDrafted != null) {
    stats["Drafted"] = `${Math.round(raw.percentDrafted * 100)}%`;
  }
  stats["Bye"] = raw.byeWeek || "—";
  return stats;
}

function buildBlurb(raw: RawPlayer): string {
  const where = raw.nflTeam === "FA" ? "a free agent" : `${raw.nflTeam}'s ${raw.position}`;
  if (raw.adp != null) {
    return `${raw.name} — ${where}, going around pick ${raw.adp.toFixed(1)} on average in Yahoo drafts.`;
  }
  return `${raw.name} — ${where}. A late-round flier with upside.`;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export interface FetchPoolOptions {
  /**
   * Safety cap on players fetched per position (paged 25 at a time), purely to
   * bound runaway pagination. Set high enough to include every player — Yahoo
   * naturally runs out (a short page) well before this for any position.
   */
  maxPerPosition?: number;
  /** Optional progress logger. */
  onProgress?: (msg: string) => void;
}

/**
 * Fetch every fantasy-eligible NFL player from Yahoo, one position at a time so
 * each slot is fully covered (all 32 defenses, every kicker, deep RB/WR), and
 * return them mapped to `Player[]` sorted best-first by real ADP (undrafted
 * players last) with `rank`/`positionRank` assigned. Duplicates (players
 * eligible at multiple positions) are de-duplicated by id.
 */
export async function fetchPlayerPool(opts: FetchPoolOptions = {}): Promise<Player[]> {
  const maxPerPosition = opts.maxPerPosition ?? 1000;
  const log = opts.onProgress ?? (() => {});

  const candidates: RawPlayer[] = [];
  for (const position of OUR_POSITIONS) {
    let got = 0;
    for (let start = 0; start < maxPerPosition; start += PAGE_SIZE) {
      const page = await fetchPage(position, start);
      candidates.push(...page);
      got += page.length;
      if (page.length < PAGE_SIZE) break; // ran out of players for this position
    }
    log(`${position}: ${got} players`);
  }

  // De-duplicate by id (a player can be eligible at multiple positions).
  const seen = new Set<string>();
  const unique = candidates.filter((r) => {
    const id = slugify(r.name);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  // Sort by ADP ascending (best first); undrafted players (null adp) sink last.
  unique.sort((a, b) => {
    if (a.adp == null && b.adp == null) return 0;
    if (a.adp == null) return 1;
    if (b.adp == null) return -1;
    return a.adp - b.adp;
  });

  const posCounters: Record<string, number> = {};

  return unique.map((raw, idx) => {
    const rank = idx + 1;
    posCounters[raw.position] = (posCounters[raw.position] ?? 0) + 1;
    const player: Player = {
      id: slugify(raw.name),
      name: raw.name,
      position: raw.position,
      nflTeam: raw.nflTeam,
      byeWeek: raw.byeWeek,
      rank,
      positionRank: posCounters[raw.position],
      adp: raw.adp ?? rank, // fall back to rank so the field is always a number
      projectedPoints: projectedFromRank(rank),
      stats: buildStats(raw),
      blurb: buildBlurb(raw),
    };
    if (raw.headshotUrl) player.headshotUrl = raw.headshotUrl;
    return player;
  });
}
