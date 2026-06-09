import { useEffect, useState } from "react";
import type { PickRevealEvent } from "@shared/types";
import { POSITION_COLORS, formatStatKey } from "../lib/util";
import { TeamAvatar } from "./TeamAvatar";
import { playFanfare } from "../lib/sound";

interface Props {
  reveal: PickRevealEvent;
  /** Show the "THE PICK IS IN" suspense screen, and for how long (seconds). */
  announcementVisual: boolean;
  announcementSeconds: number;
  /** Show the dramatic player-card reveal, and for how long (seconds). */
  revealVisual: boolean;
  revealSeconds: number;
  /** Whether the reveal fanfare should play (master + fanfare toggles). */
  fanfare: boolean;
  onDone: () => void;
}

type Phase = "incoming" | "reveal" | "hidden";

export function RevealOverlay({
  reveal,
  announcementVisual,
  announcementSeconds,
  revealVisual,
  revealSeconds,
  fanfare,
  onDone,
}: Props) {
  const announceMs = announcementVisual ? announcementSeconds * 1000 : 0;
  const revealMs = revealVisual ? revealSeconds * 1000 : 0;
  const [phase, setPhase] = useState<Phase>(
    announceMs > 0 ? "incoming" : revealVisual ? "reveal" : "hidden"
  );

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    // The announcement beat (if shown) leads; otherwise we go straight to the
    // payoff. The fanfare fires when the card would appear, regardless of
    // whether the card itself is shown — sound and visual toggle separately.
    if (announceMs > 0) setPhase("incoming");
    timers.push(
      setTimeout(() => {
        setPhase(revealVisual ? "reveal" : "hidden");
        if (fanfare) playFanfare();
      }, announceMs)
    );
    timers.push(setTimeout(onDone, announceMs + revealMs));
    return () => timers.forEach(clearTimeout);
  }, [reveal, onDone, announceMs, revealMs, revealVisual, fanfare]);

  const { player, team, pick } = reveal;

  // No visual beat enabled — the overlay is just a sound/timing controller.
  if (phase === "hidden") return null;

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
            <TeamAvatar team={team} /> {team.name} select
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
