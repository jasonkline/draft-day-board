import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Player, PlayerPosition } from "../../shared/types.js";

// Where `npm run yahoo:sync` writes the real player pool. Lives under
// server/data (gitignored, alongside session persistence).
export const POOL_FILENAME = "players-yahoo.json";

// A hand-built set of ~50 fake players for the MVP. Names/teams are fictional-ish
// so we never imply real data. Stats are flavor for the TV reveal spotlight.

type Seed = Omit<Player, "id" | "rank" | "positionRank">;

const NFL_TEAMS = [
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN",
  "DET", "GB", "HOU", "IND", "JAX", "KC", "LV", "LAC", "LAR", "MIA",
  "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SF", "SEA", "TB",
  "TEN", "WAS",
];

function bye(i: number): number {
  // Spread bye weeks across 5-14
  return 5 + (i % 10);
}

const SEEDS: Seed[] = [
  // ---- Running Backs ----
  rb("Maxwell Thorne", "DEN", 1, 312.5, { rushYds: 1480, rushTD: 14, rec: 42, recYds: 360, games: 16 }, "Bell-cow back who carried the offense down the stretch. Goal-line lock."),
  rb("Dante Rollins", "ATL", 2, 298.1, { rushYds: 1325, rushTD: 11, rec: 58, recYds: 470, games: 17 }, "Dual-threat dynamo — catches everything out of the backfield."),
  rb("Isaiah Pope", "DET", 4, 285.7, { rushYds: 1290, rushTD: 12, rec: 35, recYds: 280, games: 16 }, "Powerful runner behind an elite line. Touchdown machine."),
  rb("Cameron Vasquez", "JAX", 7, 261.3, { rushYds: 1110, rushTD: 9, rec: 49, recYds: 410, games: 17 }, "Patient, vision-first back with sneaky big-play juice."),
  rb("Tyrell Banks", "CHI", 9, 248.9, { rushYds: 1040, rushTD: 8, rec: 44, recYds: 350, games: 15 }, "Workhorse with a nose for the end zone in the red area."),
  rb("Marcus Field", "SEA", 12, 233.4, { rushYds: 980, rushTD: 7, rec: 52, recYds: 430, games: 16 }, "PPR darling — leads all backs in targets out of the slot."),
  rb("Jaylen Reeves", "TB", 16, 214.2, { rushYds: 905, rushTD: 6, rec: 39, recYds: 300, games: 16 }, "Explosive cutback runner; one missed tackle from a house call."),
  rb("Devonte Sharpe", "NYG", 19, 201.8, { rushYds: 870, rushTD: 9, rec: 28, recYds: 220, games: 14 }, "Short-yardage hammer who vultures touchdowns by the bushel."),
  rb("Eli Crawford", "LAC", 23, 188.5, { rushYds: 760, rushTD: 5, rec: 47, recYds: 400, games: 17 }, "Third-down specialist trending toward a bigger early-down role."),
  rb("Bryce Holloway", "CAR", 28, 170.1, { rushYds: 690, rushTD: 5, rec: 33, recYds: 250, games: 15 }, "Committee back with standalone flex value and upside if the starter slips."),
  rb("Nico Alvarez", "MIA", 33, 152.6, { rushYds: 540, rushTD: 4, rec: 41, recYds: 360, games: 16 }, "Speedster used on jet sweeps and screens; boom-or-bust flex."),
  rb("Trevon Mack", "WAS", 41, 128.3, { rushYds: 480, rushTD: 6, rec: 19, recYds: 140, games: 13 }, "Handcuff with league-winning upside if pressed into a feature role."),

  // ---- Wide Receivers ----
  wr("Xavier Lennox", "CIN", 3, 291.0, { rec: 102, recYds: 1480, recTD: 12, targets: 158, games: 17 }, "Alpha X receiver — wins at all three levels and feasts in the red zone."),
  wr("Roman Castillo", "MIN", 5, 279.4, { rec: 98, recYds: 1390, recTD: 9, targets: 149, games: 16 }, "Route-running technician with elite hands and a massive target share."),
  wr("Jamal Whitfield", "PHI", 6, 271.2, { rec: 94, recYds: 1320, recTD: 11, targets: 145, games: 17 }, "Big-bodied playmaker who bullies corners on contested catches."),
  wr("Andre Solomon", "KC", 8, 256.8, { rec: 89, recYds: 1240, recTD: 10, targets: 138, games: 16 }, "Quarterback's best friend — automatic on third down."),
  wr("Quincy Park", "BUF", 11, 238.9, { rec: 91, recYds: 1180, recTD: 8, targets: 142, games: 17 }, "Slot maven who racks up catches and PPR points in bunches."),
  wr("Donovan Pierce", "SF", 13, 229.5, { rec: 80, recYds: 1230, recTD: 9, targets: 121, games: 15 }, "Vertical burner averaging over 15 yards a grab. Home-run hitter."),
  wr("Keenan Vaughn", "LAR", 15, 219.7, { rec: 86, recYds: 1090, recTD: 7, targets: 130, games: 16 }, "Crafty veteran with a rock-solid floor every single week."),
  wr("Malik Osei", "HOU", 18, 205.4, { rec: 78, recYds: 1060, recTD: 8, targets: 119, games: 17 }, "Ascending second-year breakout with WR1 upside."),
  wr("Theo Bryant", "GB", 21, 196.0, { rec: 74, recYds: 980, recTD: 6, targets: 112, games: 16 }, "Reliable chain-mover in a high-powered passing attack."),
  wr("Silas Monroe", "NYJ", 25, 180.3, { rec: 70, recYds: 910, recTD: 5, targets: 108, games: 16 }, "Possession receiver who quietly leads the team in targets."),
  wr("Reggie Daniels", "BAL", 29, 166.8, { rec: 62, recYds: 880, recTD: 7, targets: 94, games: 15 }, "Red-zone threat with leaping ability and strong-side size."),
  wr("Cole Ferguson", "PIT", 32, 156.1, { rec: 65, recYds: 820, recTD: 4, targets: 99, games: 17 }, "Steady WR3 with a clear path to volume after offseason moves."),
  wr("Brayden Knox", "ARI", 36, 144.7, { rec: 58, recYds: 760, recTD: 6, targets: 88, games: 16 }, "Deep-ball specialist — feast-or-famine but a weekly ceiling play."),
  wr("Tariq Sloan", "CLE", 39, 134.9, { rec: 54, recYds: 700, recTD: 4, targets: 82, games: 15 }, "Gadget weapon with rushing usage that pads the box score."),
  wr("Emmett Drake", "NO", 44, 120.5, { rec: 49, recYds: 640, recTD: 5, targets: 76, games: 16 }, "Sleeper with a wide-open target tree in a revamped offense."),

  // ---- Quarterbacks ----
  qb("Grayson Hale", "BUF", 10, 244.6, { passYds: 4720, passTD: 38, ints: 9, rushYds: 480, rushTD: 6 }, "Dual-threat MVP candidate — throws darts and runs for scores."),
  qb("Beckett Lowry", "PHI", 14, 226.3, { passYds: 4510, passTD: 34, ints: 11, rushYds: 560, rushTD: 8 }, "Rushing upside elevates a strong-armed gunslinger into the elite tier."),
  qb("Adrian Cole", "CIN", 17, 210.9, { passYds: 4880, passTD: 36, ints: 12, rushYds: 180, rushTD: 2 }, "Pure pocket passer leading a pass-happy aerial show."),
  qb("Hudson Vance", "KC", 20, 199.2, { passYds: 4350, passTD: 33, ints: 8, rushYds: 320, rushTD: 4 }, "Big-game closer who delivers in the clutch with a high floor."),
  qb("Finn Adler", "DET", 24, 184.0, { passYds: 4200, passTD: 31, ints: 13, rushYds: 410, rushTD: 5 }, "Aggressive downfield thrower in a high-octane scheme."),
  qb("Wesley Pruitt", "HOU", 27, 173.5, { passYds: 4090, passTD: 29, ints: 10, rushYds: 600, rushTD: 7 }, "Young riser with legs — a true streaming-proof QB1."),
  qb("Owen Marsh", "LAR", 35, 148.2, { passYds: 3980, passTD: 27, ints: 12, rushYds: 220, rushTD: 3 }, "Steady veteran QB2 with weekly spot-start appeal."),
  qb("Ezra Blackwood", "SEA", 43, 122.8, { passYds: 3760, passTD: 25, ints: 14, rushYds: 350, rushTD: 4 }, "Late-round dart throw with a friendly early-season schedule."),

  // ---- Tight Ends ----
  te("Brock Sterling", "BAL", 22, 192.4, { rec: 78, recYds: 940, recTD: 9, targets: 108, games: 16 }, "Positional cheat code — a wide receiver in a tight end's body."),
  te("Lincoln Reyes", "DET", 26, 176.9, { rec: 72, recYds: 820, recTD: 7, targets: 99, games: 17 }, "Every-down move tight end with a rock-solid red-zone role."),
  te("Garrett Boone", "KC", 30, 162.0, { rec: 66, recYds: 740, recTD: 8, targets: 92, games: 16 }, "Security blanket who turns short throws into touchdowns."),
  te("Spencer Wade", "ATL", 38, 138.4, { rec: 58, recYds: 660, recTD: 5, targets: 84, games: 16 }, "Ascending pass-catcher in a tight end-friendly offense."),
  te("Harlan Cross", "GB", 45, 118.7, { rec: 52, recYds: 580, recTD: 6, targets: 75, games: 15 }, "Touchdown-dependent streamer with weekly upside near the goal line."),
  te("Miles Tanner", "NYG", 48, 104.3, { rec: 47, recYds: 510, recTD: 4, targets: 69, games: 16 }, "Deep-league dart with a clear path to snaps and targets."),

  // ---- Kickers ----
  k("Hugo Bennett", "SF", 31, 158.0, { fgm: 32, fga: 35, longFg: 56, xp: 44, games: 17 }, "Automatic from inside 50 with a big leg in a high-scoring offense."),
  k("Roscoe Pratt", "BAL", 40, 130.2, { fgm: 30, fga: 33, longFg: 58, xp: 41, games: 17 }, "Strong-legged kicker in a dome-friendly schedule."),
  k("Sven Lindqvist", "DET", 49, 100.1, { fgm: 28, fga: 31, longFg: 54, xp: 46, games: 16 }, "Volume-driven points in one of the league's best offenses."),

  // ---- Team Defenses ----
  def("Steel Curtain D/ST", "PIT", 34, 150.6, { sacks: 52, ints: 18, fumRec: 12, defTD: 5, ptsAllowed: 17.8 }, "Blitz-heavy unit that forces turnovers and scores on defense."),
  def("Bayou Bandits D/ST", "NO", 42, 126.4, { sacks: 46, ints: 15, fumRec: 11, defTD: 4, ptsAllowed: 19.2 }, "Ball-hawking secondary with a knack for the takeaway."),
  def("Mile High D/ST", "DEN", 46, 110.9, { sacks: 49, ints: 14, fumRec: 9, defTD: 3, ptsAllowed: 18.5 }, "Elite pass rush that lives in the backfield."),
  def("Iron Range D/ST", "MIN", 50, 98.0, { sacks: 44, ints: 13, fumRec: 10, defTD: 4, ptsAllowed: 20.1 }, "Disruptive front seven and a favorable early slate."),
];

function base(
  name: string,
  position: PlayerPosition,
  nflTeam: string,
  posIndex: number,
  adp: number,
  stats: Record<string, string | number>,
  blurb: string
): Seed {
  return {
    name,
    position,
    nflTeam,
    byeWeek: bye(posIndex),
    adp,
    projectedPoints: Math.round(adp * 0.9 * 10) / 10,
    stats,
    blurb,
  };
}

function rb(n: string, t: string, i: number, adp: number, s: Record<string, string | number>, b: string) {
  return base(n, "RB", t, i, adp, s, b);
}
function wr(n: string, t: string, i: number, adp: number, s: Record<string, string | number>, b: string) {
  return base(n, "WR", t, i, adp, s, b);
}
function qb(n: string, t: string, i: number, adp: number, s: Record<string, string | number>, b: string) {
  return base(n, "QB", t, i, adp, s, b);
}
function te(n: string, t: string, i: number, adp: number, s: Record<string, string | number>, b: string) {
  return base(n, "TE", t, i, adp, s, b);
}
function k(n: string, t: string, i: number, adp: number, s: Record<string, string | number>, b: string) {
  return base(n, "K", t, i, adp, s, b);
}
function def(n: string, t: string, i: number, adp: number, s: Record<string, string | number>, b: string) {
  return base(n, "DEF", t, i, adp, s, b);
}

// Reference NFL_TEAMS so it is part of the module surface and lint is happy.
export const VALID_NFL_TEAMS = NFL_TEAMS;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Build the final player list: overall rank by ADP (desc projected value), positionRank per position.
export function buildPlayers(): Player[] {
  const sorted = [...SEEDS].sort((a, b) => b.adp - a.adp);
  const posCounters: Record<string, number> = {};
  return sorted.map((seed, idx) => {
    posCounters[seed.position] = (posCounters[seed.position] ?? 0) + 1;
    return {
      ...seed,
      id: slugify(seed.name),
      rank: idx + 1,
      positionRank: posCounters[seed.position],
    };
  });
}

// Load the real Yahoo-sourced pool from disk if it exists; otherwise fall back
// to the built-in fake dataset. This keeps the server (and all tests) fully
// offline — the network only happens in the one-off `yahoo:sync` CLI.
function loadYahooPool(): Player[] | null {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const poolPath = join(__dirname, "..", "data", POOL_FILENAME);
  if (!existsSync(poolPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(poolPath, "utf8"));
    if (Array.isArray(parsed) && parsed.length > 0) {
      console.log(`[players] using Yahoo pool (${parsed.length} players) from ${POOL_FILENAME}`);
      return parsed as Player[];
    }
    console.warn(`[players] ${POOL_FILENAME} was empty or invalid — using built-in dataset`);
  } catch (err) {
    console.warn(`[players] failed to read ${POOL_FILENAME}, using built-in dataset:`, err);
  }
  return null;
}

// Exported as `let` so a live refresh (yahoo:sync / admin button) can swap the
// pool in place. ESM live bindings mean importers see the new array without
// re-importing. `toPublicState` reads it fresh on every broadcast.
export let PLAYERS: Player[] = loadYahooPool() ?? buildPlayers();

/** Replace the in-memory player pool (used by the Yahoo sync). */
export function setPlayers(next: Player[]): void {
  if (Array.isArray(next) && next.length > 0) PLAYERS = next;
}
