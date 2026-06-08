// One-time authorization CLI: `npm run yahoo:auth`.
//
// Prints the Yahoo consent URL, waits for you to paste back the `?code=...`
// value from the redirect, exchanges it for tokens, and saves the long-lived
// refresh token into .env. After this you never need to log in again.

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { readYahooConfig, writeEnvVar } from "./env.js";
import { buildAuthUrl, exchangeCodeForTokens } from "./oauth.js";

/** Pull the `code` out of whatever the user pastes (full URL or bare code). */
function extractCode(input: string): string {
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    const code = url.searchParams.get("code");
    if (code) return code;
  } catch {
    // Not a URL — treat as a bare code.
  }
  return trimmed;
}

async function main() {
  const cfg = readYahooConfig();
  const authUrl = buildAuthUrl(cfg);

  console.log("\n=== Yahoo Fantasy authorization ===\n");
  console.log("1. Open this URL in your browser and approve access:\n");
  console.log("   " + authUrl + "\n");
  console.log(
    `2. Yahoo will redirect to ${cfg.redirectUri}?code=...\n` +
      "   That page won't load (it's https on your http dev server) — that's fine.\n" +
      "   Copy the FULL URL from the address bar (or just the code= value).\n"
  );

  const rl = createInterface({ input: stdin, output: stdout });
  const pasted = await rl.question("3. Paste the redirect URL (or code) here: ");
  rl.close();

  const code = extractCode(pasted);
  if (!code) {
    console.error("\nNo authorization code found in what you pasted. Aborting.");
    process.exit(1);
  }

  console.log("\nExchanging code for tokens...");
  const tokens = await exchangeCodeForTokens(cfg, code);
  const envPath = writeEnvVar("YAHOO_REFRESH_TOKEN", tokens.refresh_token);

  console.log(`\n✅ Saved YAHOO_REFRESH_TOKEN to ${envPath}`);
  console.log("   You're authorized. Next: `npm run yahoo:sync` to pull players.\n");
}

main().catch((err) => {
  console.error("\n❌ Authorization failed:\n", err.message ?? err);
  process.exit(1);
});
