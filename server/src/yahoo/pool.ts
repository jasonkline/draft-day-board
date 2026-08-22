// Fetch the NFL player pool from Yahoo and map it into our `Player` shape.
//
// Since Yahoo gated the OAuth Fantasy API behind per-app approval (mid-2026),
// this pulls from `pub-api-ro.fantasysports.yahoo.com` instead — the host
// Yahoo's own Draft Analysis pages read from, which serves the same API with
// no auth at all. It only exposes public/global data (league-scoped ADP still
// needs OAuth), which is exactly what the player pool needs. `format=json_f`
// gives object-style JSON, so no array-of-single-key-objects flattening dance.

import type { Player, PlayerPosition } from "../../../shared/types.js";

const OUR_POSITIONS: PlayerPosition[] = ["QB", "RB", "WR", "TE", "K", "DEF"];
const PAGE_SIZE = 25; // Yahoo caps players collections at 25 per request.

const PUBLIC_API = "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2";
// "nfl.l.public" resolves to the current season's public league (e.g.
// 470.l.101 in 2026), so this never needs a yearly game-id bump.
const PUBLIC_LEAGUE = "nfl.l.public";

async function publicGet(path: string): Promise<any> {
  const res = await fetch(`${PUBLIC_API}/${path}?format=json_f`);
  if (!res.ok) throw new Error(`Yahoo public API ${res.status} for ${path}`);
  return res.json();
}

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
  const result = inner > 0 ? url.slice(inner) : url;
  // Clients render this as <img src> — only https URLs may pass the boundary.
  return result.startsWith("https://") ? result : undefined;
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
  playerKey?: string; // Yahoo player key, e.g. "nfl.p.40055"
}

/** Map one `json_f` player object into our intermediate shape. */
function mapRawPlayer(p: any): RawPlayer | null {
  if (!p || typeof p !== "object") return null;

  const position = mapPosition(p);
  if (!position) return null; // skip IDP / non-fantasy positions

  const name = typeof p.name?.full === "string" ? p.name.full : null;
  if (!name) return null;

  const nflTeam = String(p.editorial_team_abbr ?? "FA").toUpperCase();
  const byeWeek = Number(p.bye_weeks?.week ?? 0) || 0;
  // Yahoo's canonical player key ("nfl.p.40055"); its numeric suffix is the
  // `pid` the offline-draft results form expects when pushing picks back to
  // Yahoo. Prefer editorial_player_key — in a league context, player_key is
  // prefixed with the season's game id ("470.p.40055") instead of "nfl".
  const playerKey =
    typeof p.editorial_player_key === "string"
      ? p.editorial_player_key
      : typeof p.player_key === "string"
        ? p.player_key
        : undefined;

  const headshotUrl = unwrapHeadshot(
    typeof p.headshot?.url === "string"
      ? p.headshot.url
      : typeof p.image_url === "string"
        ? p.image_url
        : undefined
  );

  const da = p.draft_analysis ?? {};
  const ap = parseFloat(da.average_pick);
  const adp = Number.isFinite(ap) && ap > 0 ? ap : null;
  const pd = parseFloat(da.percent_drafted);
  const percentDrafted = Number.isFinite(pd) ? pd : null;

  return { name, position, nflTeam, byeWeek, adp, percentDrafted, headshotUrl, playerKey };
}

/** Pull one page of a single position, sorted by Yahoo's overall rank. */
async function fetchPage(
  position: PlayerPosition,
  start: number
): Promise<RawPlayer[]> {
  const path = `league/${PUBLIC_LEAGUE}/players;position=${position};start=${start};count=${PAGE_SIZE};sort=OR/draft_analysis`;
  const data = await publicGet(path);
  const players = data?.fantasy_content?.league?.players;
  if (!Array.isArray(players)) return [];

  const raws: RawPlayer[] = [];
  for (const entry of players) {
    const mapped = mapRawPlayer(entry?.player ?? entry);
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
    if (raw.playerKey) player.yahooPlayerKey = raw.playerKey;
    return player;
  });
}
