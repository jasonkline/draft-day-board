import { useEffect, useState } from "react";
import type { PickRevealEvent } from "@shared/types";
import { POSITION_COLORS, formatStatKey } from "../lib/util";
import { playFanfare } from "../lib/sound";

interface Props {
  reveal: PickRevealEvent;
  onDone: () => void;
}

type Phase = "incoming" | "reveal";

export function RevealOverlay({ reveal, onDone }: Props) {
  const [phase, setPhase] = useState<Phase>("incoming");

  useEffect(() => {
    setPhase("incoming");
    const t1 = setTimeout(() => {
      setPhase("reveal");
      playFanfare();
    }, 10000);
    const t2 = setTimeout(onDone, 20000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [reveal, onDone]);

  const { player, team, pick } = reveal;

  return (
    <div className="reveal-backdrop">
      {phase === "incoming" ? (
        <div className="reveal-incoming">
          <div className="reveal-ding">🔔</div>
          <div className="reveal-incoming-text">THE PICK IS IN</div>
          <div className="reveal-incoming-sub">
            Pick #{pick.overall} · Round {pick.round}
          </div>
        </div>
      ) : (
        <div className="reveal-card-wrap">
          <div className="reveal-withpick" style={{ color: team.avatarColor }}>
            {team.emoji} {team.name} select
          </div>
          <div
            className="reveal-card"
            style={{ "--accent": POSITION_COLORS[player.position] } as React.CSSProperties}
          >
            <div className="reveal-overall">PICK&nbsp;{pick.overall}</div>
            {player.headshotUrl && (
              <img
                className="reveal-headshot"
                src={player.headshotUrl}
                alt={player.name}
                // Drop the image (not the layout) if it fails to load.
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            )}
            <div
              className="reveal-pos"
              style={{ background: POSITION_COLORS[player.position] }}
            >
              {player.position}
            </div>
            <h1 className="reveal-name">{player.name}</h1>
            <div className="reveal-meta">
              {player.nflTeam} · #{player.positionRank} {player.position} · Bye{" "}
              {player.byeWeek}
            </div>
            <p className="reveal-blurb">{player.blurb}</p>
            <div className="reveal-stats">
              {Object.entries(player.stats)
                .slice(0, 5)
                .map(([k, v]) => (
                  <div key={k} className="reveal-stat">
                    <span className="rstat-val">{v}</span>
                    <span className="rstat-key">{formatStatKey(k)}</span>
                  </div>
                ))}
            </div>
          </div>
          {reveal.isLastPick && (
            <div className="reveal-complete">🎉 THAT'S A WRAP — DRAFT COMPLETE 🎉</div>
          )}
        </div>
      )}
    </div>
  );
}
