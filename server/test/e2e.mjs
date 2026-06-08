// End-to-end integration test driven over real Socket.IO against the built server.
// Spawns the production server, simulates a commissioner, a TV board, and
// self-pick participants running a full snake draft to completion.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { io } from "socket.io-client";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = join(__dirname, "..", "dist", "index.js");
const PORT = 4099;
const URL = `http://localhost:${PORT}`;

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
}

function connect() {
  return io(URL, { transports: ["websocket"], forceNew: true });
}

function emit(sock, event, payload) {
  return new Promise((resolve) => sock.emit(event, payload, resolve));
}

async function waitForHealth(retries = 40) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${URL}/api/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("server did not become healthy");
}

async function run() {
  console.log("\n[e2e] booting server…");
  const proc = spawn("node", [SERVER], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stderr.on("data", (d) => process.stderr.write(`[srv] ${d}`));

  try {
    await waitForHealth();
    console.log("[e2e] server healthy\n");

    // ---- Commissioner creates a 4-team draft ----
    const admin = connect();
    const created = await emit(admin, "session:create", {
      config: {
        leagueName: "E2E League",
        draftStyle: "snake",
        mode: "self",
        rounds: 2,
        secondsPerPick: 0,
      },
      teamNames: ["Sharks", "Bears", "Wolves", "Eagles"],
    });
    assert(created.ok && created.state, "session created");
    const code = created.state.code;
    const adminToken = created.adminToken;
    assert(/^[A-Z2-9]{5}$/.test(code), `session code format (${code})`);
    assert(typeof adminToken === "string" && adminToken.length === 24, "admin token issued");
    assert(created.state.teams.length === 4, "4 teams created");
    assert(
      !JSON.stringify(created.state).includes(adminToken),
      "admin token not leaked in public state"
    );

    // ---- TV board watches and collects reveal events ----
    const board = connect();
    const reveals = [];
    let lastBoardState = null;
    board.on("pick:reveal", (e) => reveals.push(e));
    board.on("state:update", (s) => (lastBoardState = s));
    const watched = await emit(board, "session:watch", { code });
    assert(watched.ok, "board joined as watcher");
    assert(
      !JSON.stringify(watched.state.teams).includes(adminToken),
      "no secret tokens sent to board"
    );

    // ---- Participants claim all 4 teams (self-pick) ----
    const tokens = {}; // teamId -> teamToken
    for (const t of created.state.teams) {
      const sock = connect();
      const claim = await emit(sock, "session:claimTeam", { code, teamId: t.id });
      assert(claim.ok && claim.teamToken, `claimed ${t.name}`);
      tokens[t.id] = claim.teamToken;
    }

    // double-claim should fail
    const dupSock = connect();
    const dup = await emit(dupSock, "session:claimTeam", {
      code,
      teamId: created.state.teams[0].id,
    });
    assert(!dup.ok, "double-claim rejected");

    // ---- Cannot pick before draft starts ----
    const early = await emit(admin, "pick:make", {
      code,
      playerId: watched.state.players[0].id,
      adminToken,
    });
    assert(!early.ok, "pick rejected before draft starts");

    // ---- Start the draft ----
    const started = await emit(admin, "admin:startDraft", { code, adminToken });
    assert(started.ok && started.state.status === "drafting", "draft started");

    // ---- Wrong team's token cannot pick ----
    let state = started.state;
    const onClock0 = state.onClockTeamId;
    const wrongTeam = state.teams.find((t) => t.id !== onClock0);
    const wrongPick = await emit(admin, "pick:make", {
      code,
      playerId: state.players[0].id,
      teamToken: tokens[wrongTeam.id],
    });
    assert(!wrongPick.ok, "pick from wrong team token rejected");

    // ---- Run the full draft with each on-clock team picking the top available ----
    admin.on("state:update", (s) => (state = s));
    const draftedOrder = [];
    let guard = 0;
    while (state.status === "drafting" && guard++ < 50) {
      const onClock = state.onClockTeamId;
      const drafted = new Set(state.picks.map((p) => p.playerId));
      const nextPlayer = state.players.find((p) => !drafted.has(p.id));
      const ack = await emit(admin, "pick:make", {
        code,
        playerId: nextPlayer.id,
        teamToken: tokens[onClock],
      });
      assert(ack.ok, `pick #${state.picks.length} by ${onClock} -> ${nextPlayer.name}`);
      draftedOrder.push({ overall: state.picks.length, teamId: onClock });
      await new Promise((r) => setTimeout(r, 30));
    }

    assert(state.status === "complete", "draft reached completion");
    assert(state.picks.length === 8, "8 total picks made (4 teams x 2 rounds)");

    // snake fairness: round-1 first picker is round-2 last picker
    const firstTeam = state.draftOrder[0];
    const firstPicks = state.picks
      .filter((p) => p.teamId === firstTeam)
      .map((p) => p.overall)
      .sort((a, b) => a - b);
    assert(
      firstPicks[0] === 1 && firstPicks[1] === 8,
      `snake order correct for first team (${firstPicks.join(",")})`
    );

    // ---- Reveal events delivered to the board ----
    await new Promise((r) => setTimeout(r, 100));
    assert(reveals.length === 8, `board received 8 reveal events (got ${reveals.length})`);
    assert(reveals[0].isFirstOverall === true, "first reveal flagged isFirstOverall");
    assert(
      reveals[reveals.length - 1].isLastPick === true,
      "last reveal flagged isLastPick"
    );
    assert(
      reveals.every((r) => r.player && r.team && !("token" in r.team)),
      "reveals include player + public team (no token)"
    );
    assert(lastBoardState && lastBoardState.status === "complete", "board state is complete");

    // ---- No duplicate players drafted ----
    const ids = state.picks.map((p) => p.playerId);
    assert(new Set(ids).size === ids.length, "no player drafted twice");

    // ---- Commissioner undo returns last pick to the pool ----
    const undo = await emit(admin, "admin:undoPick", { code, adminToken });
    assert(undo.ok && undo.state.status === "drafting", "undo reopens the draft");
    assert(undo.state.picks.length === 7, "undo removed the last pick");

    console.log(`\n[e2e] ${failures === 0 ? "ALL PASSED ✅" : failures + " FAILED ❌"}`);
  } catch (err) {
    console.error("[e2e] error:", err);
    failures++;
  } finally {
    proc.kill("SIGTERM");
  }

  process.exit(failures === 0 ? 0 : 1);
}

run();
