import { useMemo } from "react";
import type { Pick, SessionState } from "@shared/types";
import { POSITION_COLORS, playerById } from "../lib/util";
import { TeamAvatar } from "./TeamAvatar";

interface Props {
  state: SessionState;
  compact?: boolean;
  // Hide the most recent pick so the board can dramatically reveal it.
  hidePickOverall?: number | null;
}

export function DraftGrid({ state, compact, hidePickOverall }: Props) {
  const numTeams = state.teams.length;
  const rounds = state.config.rounds;
  const order = state.draftOrder;

  const pickMap = useMemo(() => {
    const m = new Map<string, Pick>();
    for (const p of state.picks) m.set(`${p.round}:${p.teamId}`, p);
    return m;
  }, [state.picks]);

  const currentRound =
    state.currentOverall != null
      ? Math.ceil(state.currentOverall / numTeams)
      : -1;

  return (
    <div className={`grid-wrap ${compact ? "grid-compact" : ""}`}>
      <div
        className="grid"
        style={{
          gridTemplateColumns: `var(--round-col) repeat(${numTeams}, minmax(0, 1fr))`,
        }}
      >
        <div className="grid-corner">RD</div>
        {order.map((teamId) => {
          const team = state.teams.find((t) => t.id === teamId)!;
          return (
            <div
              key={teamId}
              className={`grid-head ${
                state.onClockTeamId === teamId ? "grid-head-onclock" : ""
              }`}
              style={{ borderColor: team.avatarColor }}
            >
              <TeamAvatar team={team} className="grid-head-emoji" />
              <span className="grid-head-name">{team.name}</span>
            </div>
          );
        })}

        {Array.from({ length: rounds }, (_, r) => {
          const round = r + 1;
          return (
            <FragmentRow
              key={round}
              round={round}
              order={order}
              pickMap={pickMap}
              state={state}
              isCurrentRound={round === currentRound}
              hidePickOverall={hidePickOverall ?? null}
            />
          );
        })}
      </div>
    </div>
  );
}

function FragmentRow({
  round,
  order,
  pickMap,
  state,
  isCurrentRound,
  hidePickOverall,
}: {
  round: number;
  order: string[];
  pickMap: Map<string, Pick>;
  state: SessionState;
  isCurrentRound: boolean;
  hidePickOverall: number | null;
}) {
  return (
    <>
      <div className="grid-round">{round}</div>
      {order.map((teamId) => {
        const pick = pickMap.get(`${round}:${teamId}`);
        const hidden = pick != null && pick.overall === hidePickOverall;
        const isOnClock =
          isCurrentRound &&
          state.onClockTeamId === teamId &&
          state.status === "drafting";

        if (pick && !hidden) {
          const player = playerById(state, pick.playerId);
          // Last name gets top billing; first name sits small underneath.
          const parts = (player?.name ?? "").trim().split(/\s+/);
          const firstName = parts.length > 1 ? parts[0] : "";
          const lastName = parts.length > 1 ? parts.slice(1).join(" ") : parts[0];
          return (
            <div
              key={teamId}
              className="cell cell-filled"
              style={{
                borderLeftColor: player
                  ? POSITION_COLORS[player.position]
                  : "#333",
              }}
            >
              <span className="cell-overall">{pick.overall}</span>
              <span className="cell-last">{lastName}</span>
              {firstName && <span className="cell-first">{firstName}</span>}
              <span className="cell-pos">
                {player?.position} · {player?.nflTeam}
              </span>
            </div>
          );
        }

        return (
          <div
            key={teamId}
            className={`cell ${isOnClock ? "cell-onclock" : "cell-empty"}`}
          >
            {isOnClock ? (
              <span className="cell-clock">ON THE CLOCK</span>
            ) : (
              <span className="cell-dot">•</span>
            )}
          </div>
        );
      })}
    </>
  );
}
