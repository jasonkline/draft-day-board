import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { PickRevealEvent } from "@shared/types";
import { emit } from "../lib/socket";
import { useSessionState, useReveal, useCountdown } from "../lib/useDraft";
import { DraftGrid } from "../components/DraftGrid";
import { RevealOverlay } from "../components/RevealOverlay";
import { playDing, unlockAudio } from "../lib/sound";
import {
  POSITION_COLORS,
  absUrl,
  formatStatKey,
  playerById,
  teamById,
} from "../lib/util";

export function Board() {
  const { code = "" } = useParams();
  const { state, setState, connected } = useSessionState();
  const [queue, setQueue] = useState<PickRevealEvent[]>([]);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState("");

  // Join the session as a passive watcher (and re-join on reconnect).
  useEffect(() => {
    let cancelled = false;
    async function watch() {
      const ack = await emit("session:watch", { code: code.toUpperCase() });
      if (cancelled) return;
      if (ack.ok && ack.state) setState(ack.state);
      else setError(ack.error || "Session not found");
    }
    void watch();
    return () => {
      cancelled = true;
    };
  }, [code, connected, setState]);

  const onReveal = useCallback((e: PickRevealEvent) => {
    playDing();
    setQueue((q) => [...q, e]);
  }, []);
  useReveal(onReveal);

  const current = queue[0] ?? null;
  const handleDone = useCallback(() => setQueue((q) => q.slice(1)), []);

  const deadline = state?.pickDeadline ?? null;
  const secondsLeft = useCountdown(deadline);

  if (!state) {
    return (
      <div className="board board-loading">
        <div className="logo-spin">🏈</div>
        <p>{error || "Connecting to draft…"}</p>
        <p className="hint">Code: {code.toUpperCase()}</p>
      </div>
    );
  }

  if (!armed) {
    return (
      <div className="board board-arm" onClick={() => {}}>
        <div className="arm-card">
          <div className="home-logo">📺</div>
          <h1>{state.config.leagueName}</h1>
          <p>Big-screen draft board · Code {state.code}</p>
          <button
            className="btn btn-primary btn-big"
            onClick={() => {
              unlockAudio();
              setArmed(true);
              const el = document.documentElement;
              if (el.requestFullscreen) void el.requestFullscreen().catch(() => {});
            }}
          >
            Launch Board (enable sound) 🔊
          </button>
          <p className="hint">Tap once to enable the draft chimes &amp; fullscreen.</p>
        </div>
      </div>
    );
  }

  const onClockTeam = teamById(state, state.onClockTeamId);
  const lastPick = state.picks[state.picks.length - 1];
  const lastPlayer = playerById(state, lastPick?.playerId);
  const lastTeam = teamById(state, lastPick?.teamId);

  return (
    <div className="board">
      <header className="board-top">
        <div className="board-title">
          <span className="board-logo">🏈</span>
          <div>
            <h1>{state.config.leagueName}</h1>
            <span className="board-style">
              {state.config.draftStyle === "snake" ? "Snake" : "Linear"} ·{" "}
              {state.config.rounds} rounds ·{" "}
              {state.config.mode === "self" ? "Self-Pick" : "Commissioner"}
            </span>
          </div>
        </div>
        <div className="board-status">
          {state.status === "setup" && <span className="pill">Waiting to start…</span>}
          {state.status === "drafting" && (
            <span className="pill pill-live">● LIVE</span>
          )}
          {state.status === "complete" && (
            <span className="pill pill-done">DRAFT COMPLETE</span>
          )}
          <div className="board-code">
            JOIN AT <strong>{absUrl("/")}</strong> · CODE{" "}
            <strong className="codebig">{state.code}</strong>
          </div>
        </div>
      </header>

      <div className="board-body">
        <main className="board-grid-area">
          <DraftGrid
            state={state}
            hidePickOverall={current?.pick.overall ?? null}
          />
        </main>

        <aside className="board-side">
          {state.status === "drafting" && onClockTeam && (
            <div
              className="onclock-card"
              style={{ borderColor: onClockTeam.avatarColor }}
            >
              <div className="onclock-label">ON THE CLOCK</div>
              <div
                className="onclock-team"
                style={{ color: onClockTeam.avatarColor }}
              >
                {onClockTeam.emoji} {onClockTeam.name}
              </div>
              <div className="onclock-pick">
                Pick #{state.currentOverall} · Round{" "}
                {Math.ceil((state.currentOverall || 1) / state.teams.length)}
              </div>
              {secondsLeft != null && (
                <div
                  className={`onclock-timer ${secondsLeft <= 10 ? "timer-warn" : ""}`}
                >
                  {Math.floor(secondsLeft / 60)}:
                  {String(secondsLeft % 60).padStart(2, "0")}
                </div>
              )}
            </div>
          )}

          {lastPlayer && lastTeam && (
            <div className="lastpick-card">
              <div className="lastpick-label">LAST PICK</div>
              <div className="lastpick-overall">
                #{lastPick.overall} · {lastTeam.emoji} {lastTeam.name}
              </div>
              <div className="lastpick-name">{lastPlayer.name}</div>
              <div
                className="lastpick-pos"
                style={{ background: POSITION_COLORS[lastPlayer.position] }}
              >
                {lastPlayer.position} · {lastPlayer.nflTeam}
              </div>
              <div className="lastpick-stats">
                {Object.entries(lastPlayer.stats)
                  .slice(0, 4)
                  .map(([k, v]) => (
                    <div key={k} className="lp-stat">
                      <span className="lp-val">{v}</span>
                      <span className="lp-key">{formatStatKey(k)}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {state.status === "setup" && (
            <div className="waiting-card">
              <h3>{state.teams.length} teams ready</h3>
              <ul className="waiting-teams">
                {state.draftOrder.map((id, i) => {
                  const t = teamById(state, id);
                  return (
                    <li key={id}>
                      <span className="wt-num">{i + 1}</span>
                      <span style={{ color: t?.avatarColor }}>
                        {t?.emoji} {t?.name}
                      </span>
                      {t?.claimed && <span className="wt-claimed">✓</span>}
                    </li>
                  );
                })}
              </ul>
              <p className="hint">Waiting for the commissioner to start the draft…</p>
            </div>
          )}
        </aside>
      </div>

      {current && (
        <RevealOverlay key={current.pick.overall} reveal={current} onDone={handleDone} />
      )}
    </div>
  );
}
