// Headless browser smoke test: drives the real UI end to end and asserts the
// dramatic reveal renders on the board with no console/page errors.
//
// Requires: built client (client/dist) + built server (server/dist) + chromium.
//   npm run build && npx playwright install chromium && node server/test/browser-smoke.mjs

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = join(__dirname, "..", "dist", "index.js");
const PORT = 4097;
const URL = `http://localhost:${PORT}`;

let failures = 0;
const errors = [];
function assert(cond, msg) {
  console.log(`  ${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) failures++;
}

async function waitForHealth(retries = 40) {
  for (let i = 0; i < retries; i++) {
    try {
      if ((await fetch(`${URL}/api/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("server not healthy");
}

function track(page, label) {
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`[${label}] ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`[${label}] pageerror: ${e.message}`));
}

async function run() {
  console.log("\n[browser] booting server…");
  const proc = spawn("node", [SERVER], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "ignore", "pipe"],
  });
  proc.stderr.on("data", (d) => process.stderr.write(`[srv] ${d}`));

  const browser = await chromium.launch();
  try {
    await waitForHealth();
    const ctx = await browser.newContext();

    // ---- Commissioner: create a draft from the Home page ----
    const admin = await ctx.newPage();
    track(admin, "admin");
    await admin.goto(`${URL}/`);
    await admin.fill('input[placeholder="The Big Game League"]', "Smoke League");
    await admin.getByRole("button", { name: /Create Draft/ }).click();
    await admin.waitForURL(/\/admin\//, { timeout: 8000 });
    const code = admin.url().split("/admin/")[1];
    assert(/^[A-Z2-9]{5}$/.test(code), `created draft, code ${code}`);

    // Setup screen renders, then start the draft (commissioner mode default).
    await admin.waitForSelector("text=Commissioner Setup", { timeout: 5000 });
    await admin.getByRole("button", { name: /Start Draft/ }).click();
    await admin.waitForSelector("text=ON THE CLOCK", { timeout: 6000 });
    assert(true, "draft started, commissioner control renders");

    // ---- Board: open + arm ----
    const board = await ctx.newPage();
    track(board, "board");
    await board.goto(`${URL}/board/${code}`);
    await board.getByRole("button", { name: /Launch Board/ }).click();
    await board.waitForSelector(".board-top", { timeout: 5000 });
    assert(true, "board launched");

    // ---- Participant: open join page (renders claim grid) ----
    const play = await ctx.newPage();
    track(play, "play");
    await play.goto(`${URL}/play/${code}`);
    await play.waitForSelector(".claim-team", { timeout: 5000 });
    const teamCount = await play.locator(".claim-team").count();
    assert(teamCount >= 2, `play page shows ${teamCount} claimable teams`);

    // ---- Commissioner makes the first pick ----
    await admin.waitForSelector(".player-row", { timeout: 5000 });
    const pickedName = (
      await admin.locator(".player-row .player-name-text").first().innerText()
    ).trim();
    await admin.locator(".player-row").first().click();
    await admin.waitForSelector(".modal", { timeout: 4000 });
    await admin.getByRole("button", { name: /Lock It In/ }).click();
    assert(true, `committed pick: ${pickedName}`);

    // ---- Board: dramatic reveal sequence ----
    await board.waitForSelector(".reveal-incoming-text", { timeout: 5000 });
    assert(true, '"THE PICK IS IN" overlay shown');
    // The announcement beat holds for announcementSeconds (default 6s) before
    // the card appears — give the reveal comfortably more than that.
    await board.waitForSelector(".reveal-name", { timeout: 12000 });
    const revealName = (await board.locator(".reveal-name").innerText()).trim();
    assert(
      revealName.includes(pickedName) || pickedName.includes(revealName),
      `reveal shows picked player (${revealName})`
    );

    // ---- After reveal, pick lands in the grid ----
    await board.waitForSelector(".cell-filled", { timeout: 12000 });
    const cellText = (await board.locator(".cell-filled").first().innerText()).trim();
    // Board cells render surname-first ("Robinson Bijan"), so match by parts.
    assert(
      pickedName.split(/\s+/).every((part) => cellText.includes(part)),
      `pick appears on board grid (${cellText.replace(/\n/g, " ")})`
    );

    assert(errors.length === 0, `no console/page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
    console.log(`\n[browser] ${failures === 0 ? "ALL PASSED ✅" : failures + " FAILED ❌"}`);
  } catch (err) {
    console.error("[browser] error:", err);
    if (errors.length) console.error("console errors:", errors);
    failures++;
  } finally {
    await browser.close();
    proc.kill("SIGTERM");
  }
  process.exit(failures === 0 ? 0 : 1);
}

run();
