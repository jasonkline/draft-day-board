// Capture product screenshots of the running app for review.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = join(__dirname, "..", "dist", "index.js");
const OUT = join(__dirname, "..", "..", "screenshots");
const PORT = 4096;
const URL = `http://localhost:${PORT}`;

async function waitForHealth() {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`${URL}/api/health`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function run() {
  const { mkdirSync } = await import("node:fs");
  mkdirSync(OUT, { recursive: true });
  const proc = spawn("node", [SERVER], { env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
  const browser = await chromium.launch();
  try {
    await waitForHealth();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });

    // Home
    const home = await ctx.newPage();
    await home.goto(`${URL}/`);
    await home.waitForSelector(".home-grid");
    await home.screenshot({ path: join(OUT, "1-home.png") });

    // Create + setup
    await home.fill('input[placeholder="The Big Game League"]', "Sunday Funday League");
    await home.getByRole("button", { name: /Create Draft/ }).click();
    await home.waitForURL(/\/admin\//);
    const code = home.url().split("/admin/")[1];
    await home.waitForSelector("text=Commissioner Setup");
    await home.screenshot({ path: join(OUT, "2-admin-setup.png"), fullPage: true });
    await home.getByRole("button", { name: /Start Draft/ }).click();
    await home.waitForSelector("text=ON THE CLOCK");

    // Board with several picks
    const board = await ctx.newPage();
    board.setViewportSize({ width: 1600, height: 900 });
    await board.goto(`${URL}/board/${code}`);
    await board.getByRole("button", { name: /Launch Board/ }).click();
    await board.waitForSelector(".board-top");

    // make 7 picks, screenshot a reveal mid-way
    for (let i = 0; i < 7; i++) {
      await home.waitForSelector(".player-row");
      await home.locator(".player-row").first().click();
      await home.waitForSelector(".modal");
      await home.getByRole("button", { name: /Lock It In/ }).click();
      if (i === 5) {
        // capture the reveal card frame
        await board.waitForSelector(".reveal-name", { timeout: 6000 });
        await board.screenshot({ path: join(OUT, "3-board-reveal.png") });
      }
      // wait for reveal overlay to clear before the next pick
      await board.waitForSelector(".reveal-backdrop", { state: "detached", timeout: 12000 }).catch(() => {});
      await home.waitForTimeout(300);
    }
    await board.waitForSelector(".reveal-backdrop", { state: "detached", timeout: 12000 }).catch(() => {});
    await board.screenshot({ path: join(OUT, "4-board-grid.png") });

    // Play page (mobile)
    const play = await ctx.newPage();
    await play.setViewportSize({ width: 402, height: 850 });
    await play.goto(`${URL}/play/${code}`);
    await play.waitForSelector(".claim-team");
    await play.screenshot({ path: join(OUT, "5-play-claim.png"), fullPage: true });

    console.log("screenshots written to", OUT);
  } catch (e) {
    console.error("screenshot error:", e);
  } finally {
    await browser.close();
    proc.kill("SIGTERM");
  }
  process.exit(0);
}
run();
