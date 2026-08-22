import { describe, it, expect } from "vitest";
import { SessionStore, type InternalSession } from "../src/store.js";
import { teamIdForOverall } from "../src/draft.js";

function draftedSession(store: SessionStore) {
  const s = store.create("Backup League", ["Ice", "Quarter", "MVP", "Peak"]);
  store.updateConfig(s, { rounds: 2, secondsPerPick: 0 });
  store.startDraft(s);
  const players = store.playersFor(s);
  for (let overall = 1; overall <= 5; overall++) {
    const teamId = teamIdForOverall(overall, s.draftOrder, s.config.draftStyle);
    store.applyPick(s, players[overall - 1].id, teamId);
  }
  return s;
}

/** Deep-clone through JSON, matching what a backup download/upload does. */
function roundTrip(s: InternalSession): InternalSession {
  return JSON.parse(JSON.stringify(s)) as InternalSession;
}

describe("SessionStore.restore", () => {
  it("round-trips a mid-draft session to an equivalent public state", () => {
    const store = new SessionStore();
    const original = draftedSession(store);
    const before = store.toPublicState(original);

    const fresh = new SessionStore();
    const restored = fresh.restore(roundTrip(original));
    const after = fresh.toPublicState(restored);

    expect(restored.adminToken).toBe(original.adminToken);
    expect(restored.teams.map((t) => t.token)).toEqual(
      original.teams.map((t) => t.token)
    );
    expect(after.status).toBe("drafting");
    expect(after.picks.map((p) => p.playerId)).toEqual(
      before.picks.map((p) => p.playerId)
    );
    expect(after.picks.map((p) => p.teamId)).toEqual(
      before.picks.map((p) => p.teamId)
    );
    expect(after.draftOrder).toEqual(before.draftOrder);
    expect(after.currentOverall).toBe(before.currentOverall);
    expect(after.onClockTeamId).toBe(before.onClockTeamId);

    // The draft keeps working after restore.
    const next = fresh.playersFor(restored).find(
      (p) => !restored.picks.some((pk) => pk.playerId === p.id)
    )!;
    const teamId = teamIdForOverall(6, restored.draftOrder, restored.config.draftStyle);
    expect(() => fresh.applyPick(restored, next.id, teamId)).not.toThrow();
  });

  it("marks a fully-picked backup complete and an untouched one setup", () => {
    const store = new SessionStore();
    const s = store.create("Done", ["A", "B"]);
    store.updateConfig(s, { rounds: 1 });
    store.startDraft(s);
    const players = store.playersFor(s);
    store.applyPick(s, players[0].id, teamIdForOverall(1, s.draftOrder, "snake"));
    store.applyPick(s, players[1].id, teamIdForOverall(2, s.draftOrder, "snake"));
    expect(s.status).toBe("complete");

    const fresh = new SessionStore();
    expect(fresh.restore(roundTrip(s)).status).toBe("complete");

    const setup = store.create("Untouched", ["A", "B"]);
    expect(fresh.restore(roundTrip(setup)).status).toBe("setup");
  });

  it("restores the session-scoped player pool when present", () => {
    const store = new SessionStore();
    const s = store.create("Pooled", ["A", "B"]);
    const custom = store.playersFor(s).slice(0, 5);
    const raw = roundTrip(s);
    raw.players = custom;

    const fresh = new SessionStore();
    const restored = fresh.restore(raw);
    expect(fresh.playersFor(restored)).toHaveLength(5);
    // Cleanup the sidecar the file backend wrote for this test session.
    fresh.clearSessionPlayers(restored);
  });

  it("rejects invalid backups", () => {
    const store = new SessionStore();
    const good = roundTrip(draftedSession(store));

    const fresh = new SessionStore();
    expect(() => fresh.restore({ ...good, code: "bad!" })).toThrow(/session code/i);
    expect(() => fresh.restore({ ...good, adminToken: "short" })).toThrow(/admin token/i);
    expect(() => fresh.restore({ ...good, teams: [] as never })).toThrow(/team list/i);
    const dupPick = roundTrip(good);
    dupPick.picks[1].playerId = dupPick.picks[0].playerId;
    expect(() => fresh.restore(dupPick)).toThrow(/pick 2/i);
  });

  it("re-derives pick slots so a tampered backup cannot desync the board", () => {
    const store = new SessionStore();
    const raw = roundTrip(draftedSession(store));
    raw.picks[0].teamId = "team-999"; // nonsense attribution
    raw.picks[0].round = 42;

    const fresh = new SessionStore();
    const restored = fresh.restore(raw);
    expect(restored.picks[0].teamId).toBe(
      teamIdForOverall(1, restored.draftOrder, restored.config.draftStyle)
    );
    expect(restored.picks[0].round).toBe(1);
  });
});
