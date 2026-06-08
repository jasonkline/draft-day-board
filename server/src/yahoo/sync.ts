// Player-pool sync CLI: `npm run yahoo:sync`.
//
// Fetches every fantasy-eligible NFL player from Yahoo and writes them to
// server/data/players-yahoo.json. The running server picks this file up at
// startup (see players.ts) and serves it instead of the built-in fake dataset.

import { syncPlayerPool } from "./sync-core.js";

async function main() {
  console.log("\nFetching all fantasy-eligible NFL players from Yahoo...\n");
  const { players, path } = await syncPlayerPool({
    onProgress: (msg) => console.log("  " + msg),
  });

  const byPos = players.reduce<Record<string, number>>((acc, p) => {
    acc[p.position] = (acc[p.position] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`\n✅ Wrote ${players.length} players to ${path}`);
  console.log("   By position: " + JSON.stringify(byPos));
  console.log("   Restart the server (or it'll be used on next boot) to serve real data.\n");
  console.log("   Top 5:");
  for (const p of players.slice(0, 5)) {
    console.log(
      `   ${String(p.rank).padStart(3)}. ${p.name} (${p.position}, ${p.nflTeam}) ADP ${p.adp}`
    );
  }
  console.log("");
}

main().catch((err) => {
  console.error("\n❌ Sync failed:\n", err.message ?? err);
  process.exit(1);
});
