import { describe, it, expect } from "vitest";
import { SessionStore } from "../src/store.js";
import { PLAYERS } from "../src/players.js";

function freshSession() {
  const store = new SessionStore();
  const s = store.create("Test League", ["Alpha", "Bravo", "Charlie", "Delta"]);
  return { store, s };
}

describe("players dataset", () => {
  it("has ~50 players with unique ids and ranks", () => {
    expect(PLAYERS.length).toBeGreaterThanOrEqual(48);
    const ids = new Set(PLAYERS.map((p) => p.id));
    expect(ids.size).toBe(PLAYERS.length);
    const ranks = PLAYERS.map((p) => p.rank).sort((a, b) => a - b);
    expect(ranks[0]).toBe(1);
    expect(ranks[ranks.length - 1]).toBe(PLAYERS.length);
  });

  it("covers all fantasy positions", () => {
    const positions = new Set(PLAYERS.map((p) => p.position));
    for (const pos of ["QB", "RB", "WR", "TE", "K", "DEF"]) {
      expect(positions.has(pos as any)).toBe(true);
    }
  });
});

describe("session setup", () => {
  it("creates a session with codes and per-team secret tokens", () => {
    const { s } = freshSession();
    expect(s.code).toMatch(/^[A-Z2-9]{5}$/);
    expect(s.adminToken).toHaveLength(24);
    expect(s.teams).toHaveLength(4);
    for (const t of s.teams) expect(t.token).toHaveLength(24);
    // tokens are unique
    const tokens = new Set(s.teams.map((t) => t.token));
    expect(tokens.size).toBe(4);
  });

  it("strips secret tokens from public state", () => {
    const { store, s } = freshSession();
    const pub = store.toPublicState(s);
    expect(JSON.stringify(pub)).not.toContain(s.adminToken);
    for (const t of s.teams) {
      expect(JSON.stringify(pub)).not.toContain(t.token);
    }
  });

  it("locks setup once drafting starts", () => {
    const { store, s } = freshSession();
    store.startDraft(s);
    expect(() => store.updateConfig(s, { rounds: 10 })).toThrow();
    expect(() => store.setOrder(s, [...s.draftOrder].reverse())).toThrow();
  });

  it("defaults the presentation options on", () => {
    const { s } = freshSession();
    expect(s.config.sounds).toBe(true);
    expect(s.config.announcementVisual).toBe(true);
    expect(s.config.announcementSound).toBe(true);
    expect(s.config.announcementSeconds).toBe(6);
    expect(s.config.revealVisual).toBe(true);
    expect(s.config.revealSound).toBe(true);
    expect(s.config.revealSeconds).toBe(10);
    expect(s.config.showPositionRuns).toBe(true);
    expect(s.config.showValueBadges).toBe(true);
    expect(s.config.showOnDeck).toBe(true);
    // NSFW is opt-in: master off, but its features pre-enabled for when it flips on.
    expect(s.config.nsfw).toBe(false);
    expect(s.config.hurryUpButton).toBe(true);
  });

  it("allows live sound/reveal edits after the draft starts, but locks board display", () => {
    const { store, s } = freshSession();
    store.startDraft(s);
    // Sound, reveal visuals & timing are the "can get annoying" knobs — live.
    store.updateConfig(s, {
      sounds: false,
      revealVisual: false,
      announcementSeconds: 3,
    });
    expect(s.config.sounds).toBe(false);
    expect(s.config.revealVisual).toBe(false);
    expect(s.config.announcementSeconds).toBe(3);
    // Board-display toggles lock with the rest of the rules.
    expect(() => store.updateConfig(s, { showValueBadges: false })).toThrow(
      /draft has started/i
    );
  });

  it("clamps reveal beat durations to sane ranges", () => {
    const { store, s } = freshSession();
    store.updateConfig(s, { announcementSeconds: 999, revealSeconds: 0 });
    expect(s.config.announcementSeconds).toBe(30);
    expect(s.config.revealSeconds).toBe(3);
  });
});

describe("team claiming (capability security)", () => {
  it("prevents a second person from claiming a taken team", () => {
    const { store, s } = freshSession();
    store.claimTeam(s, "team-1");
    expect(() => store.claimTeam(s, "team-1")).toThrow(/taken/i);
  });

  it("allows reclaim with the correct token (reconnect)", () => {
    const { store, s } = freshSession();
    const token = s.teams[0].token;
    store.claimTeam(s, "team-1");
    expect(() => store.claimTeam(s, "team-1", token)).not.toThrow();
  });
});

describe("pick authorization & flow", () => {
  it("commissioner can make any pick on the clock", () => {
    const { store, s } = freshSession();
    store.updateConfig(s, { mode: "commissioner", rounds: 2 });
    store.startDraft(s);
    const onClock = store.authorizeActor(s, 1, { adminToken: s.adminToken });
    expect(onClock).toBe(s.draftOrder[0]);
    const pick = store.applyPick(s, PLAYERS[0].id, onClock);
    expect(pick.overall).toBe(1);
    expect(pick.teamId).toBe(s.draftOrder[0]);
  });

  it("self mode: only the on-clock team's token can pick", () => {
    const { store, s } = freshSession();
    store.updateConfig(s, { mode: "self", draftStyle: "snake", rounds: 2 });
    store.startDraft(s);
    const firstTeam = s.teams.find((t) => t.id === s.draftOrder[0])!;
    const secondTeam = s.teams.find((t) => t.id === s.draftOrder[1])!;
    // wrong team cannot pick
    expect(() =>
      store.authorizeActor(s, 1, { teamToken: secondTeam.token })
    ).toThrow(/your turn/i);
    // right team can
    const onClock = store.authorizeActor(s, 1, { teamToken: firstTeam.token });
    expect(onClock).toBe(firstTeam.id);
  });

  it("rejects drafting an already-drafted player", () => {
    const { store, s } = freshSession();
    store.updateConfig(s, { rounds: 2, draftStyle: "snake" });
    store.startDraft(s);
    store.applyPick(s, PLAYERS[0].id, s.draftOrder[0]);
    // next on clock is draftOrder[1]
    expect(() => store.applyPick(s, PLAYERS[0].id, s.draftOrder[1])).toThrow(
      /already drafted/i
    );
  });

  it("rejects a pick from a team not on the clock", () => {
    const { store, s } = freshSession();
    store.updateConfig(s, { rounds: 2 });
    store.startDraft(s);
    expect(() => store.applyPick(s, PLAYERS[0].id, s.draftOrder[1])).toThrow(
      /turn/i
    );
  });

  it("runs a full snake draft to completion and undoes", () => {
    const { store, s } = freshSession();
    store.updateConfig(s, { rounds: 2, draftStyle: "snake" });
    store.startDraft(s);
    const total = s.teams.length * s.config.rounds; // 8
    let pi = 0;
    while (s.status === "drafting") {
      const overall = s.picks.length + 1;
      const onClock = store.authorizeActor(s, overall, {
        adminToken: s.adminToken,
      });
      store.applyPick(s, PLAYERS[pi++].id, onClock);
    }
    expect(s.picks).toHaveLength(total);
    expect(s.status).toBe("complete");
    // snake fairness: team that picked 1st picks last in round 2
    const firstTeam = s.draftOrder[0];
    const firstTeamPicks = s.picks
      .filter((p) => p.teamId === firstTeam)
      .map((p) => p.overall);
    expect(firstTeamPicks).toEqual([1, 8]);

    // undo brings us back to drafting
    store.undoLastPick(s);
    expect(s.status).toBe("drafting");
    expect(s.picks).toHaveLength(total - 1);
  });
});
