import type { DraftStyle, SlotRef } from "../../shared/types.js";

/**
 * Pure draft-logic helpers. No I/O, no mutation of inputs — easy to unit test.
 */

/** Total number of picks in the draft. */
export function totalPicks(numTeams: number, rounds: number): number {
  return numTeams * rounds;
}

/**
 * Returns the team id that is on the clock for a given 1-based overall pick,
 * following the configured draft style.
 *
 * - linear: every round uses the same order.
 * - snake: odd rounds use the order, even rounds reverse it.
 */
export function teamIdForOverall(
  overall: number,
  draftOrder: string[],
  style: DraftStyle
): string {
  const n = draftOrder.length;
  if (n === 0) throw new Error("draftOrder is empty");
  const zero = overall - 1;
  const round = Math.floor(zero / n); // 0-based round
  const idxInRound = zero % n;
  if (style === "snake" && round % 2 === 1) {
    return draftOrder[n - 1 - idxInRound];
  }
  return draftOrder[idxInRound];
}

/** Resolve the round / pick-in-round for a 1-based overall pick. */
export function slotForOverall(overall: number, numTeams: number): {
  round: number;
  pickInRound: number;
} {
  const zero = overall - 1;
  return {
    round: Math.floor(zero / numTeams) + 1,
    pickInRound: (zero % numTeams) + 1,
  };
}

/**
 * Build the full ordered list of slots for the whole draft. Useful for
 * rendering the board grid and for validation/tests.
 */
export function buildSlots(
  draftOrder: string[],
  style: DraftStyle,
  rounds: number
): SlotRef[] {
  const numTeams = draftOrder.length;
  const total = totalPicks(numTeams, rounds);
  const slots: SlotRef[] = [];
  for (let overall = 1; overall <= total; overall++) {
    const { round, pickInRound } = slotForOverall(overall, numTeams);
    slots.push({
      overall,
      round,
      pickInRound,
      teamId: teamIdForOverall(overall, draftOrder, style),
    });
  }
  return slots;
}

/**
 * The "natural" snake ordering of teams within a single round (for display).
 * Round is 1-based.
 */
export function orderForRound(
  draftOrder: string[],
  style: DraftStyle,
  round: number
): string[] {
  if (style === "snake" && round % 2 === 0) {
    return [...draftOrder].reverse();
  }
  return [...draftOrder];
}
