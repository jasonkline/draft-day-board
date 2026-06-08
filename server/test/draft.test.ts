import { describe, it, expect } from "vitest";
import {
  buildSlots,
  orderForRound,
  slotForOverall,
  teamIdForOverall,
  totalPicks,
} from "../src/draft.js";

const teams = ["A", "B", "C", "D"];

describe("totalPicks", () => {
  it("multiplies teams by rounds", () => {
    expect(totalPicks(4, 15)).toBe(60);
    expect(totalPicks(12, 16)).toBe(192);
  });
});

describe("slotForOverall", () => {
  it("maps overall picks to round + pickInRound", () => {
    expect(slotForOverall(1, 4)).toEqual({ round: 1, pickInRound: 1 });
    expect(slotForOverall(4, 4)).toEqual({ round: 1, pickInRound: 4 });
    expect(slotForOverall(5, 4)).toEqual({ round: 2, pickInRound: 1 });
    expect(slotForOverall(9, 4)).toEqual({ round: 3, pickInRound: 1 });
  });
});

describe("teamIdForOverall — linear", () => {
  it("repeats the same order every round", () => {
    expect(teamIdForOverall(1, teams, "linear")).toBe("A");
    expect(teamIdForOverall(4, teams, "linear")).toBe("D");
    expect(teamIdForOverall(5, teams, "linear")).toBe("A"); // round 2 pick 1
    expect(teamIdForOverall(8, teams, "linear")).toBe("D");
  });
});

describe("teamIdForOverall — snake", () => {
  it("reverses on even rounds", () => {
    // Round 1: A B C D
    expect(teamIdForOverall(1, teams, "snake")).toBe("A");
    expect(teamIdForOverall(4, teams, "snake")).toBe("D");
    // Round 2 reverses: D C B A
    expect(teamIdForOverall(5, teams, "snake")).toBe("D");
    expect(teamIdForOverall(6, teams, "snake")).toBe("C");
    expect(teamIdForOverall(8, teams, "snake")).toBe("A");
    // Round 3 forward again: A B C D
    expect(teamIdForOverall(9, teams, "snake")).toBe("A");
    expect(teamIdForOverall(12, teams, "snake")).toBe("D");
  });

  it("each team picks exactly once per round (snake, 3 rounds)", () => {
    const slots = buildSlots(teams, "snake", 3);
    expect(slots).toHaveLength(12);
    for (let r = 1; r <= 3; r++) {
      const inRound = slots.filter((s) => s.round === r).map((s) => s.teamId);
      expect([...inRound].sort()).toEqual([...teams].sort());
    }
  });

  it("team with first pick has the worst pick next round (snake fairness)", () => {
    // A picks 1st overall, then should pick last in round 2 (8th overall).
    const slots = buildSlots(teams, "snake", 2);
    const aPicks = slots.filter((s) => s.teamId === "A").map((s) => s.overall);
    expect(aPicks).toEqual([1, 8]);
  });
});

describe("orderForRound", () => {
  it("returns forward order for odd snake rounds and reversed for even", () => {
    expect(orderForRound(teams, "snake", 1)).toEqual(["A", "B", "C", "D"]);
    expect(orderForRound(teams, "snake", 2)).toEqual(["D", "C", "B", "A"]);
    expect(orderForRound(teams, "linear", 2)).toEqual(["A", "B", "C", "D"]);
  });
});
