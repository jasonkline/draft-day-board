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
  POSITION_ORDER,
  absUrl,
  formatStatKey,
  pickValue,
  playerById,
  positionRun,
  teamById,
  teamIdForOverall,
  teamLogoUrl,
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
  const onDeckTeam =
    state.currentOverall != null
      ? teamById(state, teamIdForOverall(state, state.currentOverall + 1))
      : undefined;
  // Most-recent-first feed of the last few picks for the board's right rail.
  const recentPicks = state.picks
    .slice(-4)
    .reverse()
    .map((pick) => ({
      pick,
      player: playerById(state, pick.playerId),
      team: teamById(state, pick.teamId),
    }))
    .filter(
      (r): r is { pick: typeof r.pick; player: NonNullable<typeof r.player>; team: NonNullable<typeof r.team> } =>
        Boolean(r.player && r.team)
    );
  const [latest, ...earlier] = recentPicks;
  const latestLogo = latest ? teamLogoUrl(latest.player.nflTeam) : undefined;
  const latestValue = latest
    ? pickValue(latest.pick.overall, latest.player.adp, state.teams.length)
    : null;
  const run = state.status === "drafting" ? positionRun(state) : null;

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
        <div className="board-legend" aria-label="Position color key">
          {POSITION_ORDER.map((pos) => (
            <span key={pos} className="legend-item">
              <span
                className="legend-dot"
                style={{ background: POSITION_COLORS[pos] }}
              />
              {pos}
            </span>
          ))}
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
          {run && (
            <div
              className="run-banner"
              style={{
                borderColor: POSITION_COLORS[run.position],
                color: POSITION_COLORS[run.position],
              }}
            >
              🔥 {run.position} RUN
              <span className="run-sub">
                {run.count} of the last {run.of} picks
              </span>
            </div>
          )}
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
              {onDeckTeam && (
                <div className="ondeck">
                  <span className="ondeck-label">ON DECK</span>
                  <span
                    className="ondeck-team"
                    style={{ color: onDeckTeam.avatarColor }}
                  >
                    {onDeckTeam.emoji} {onDeckTeam.name}
                  </span>
                </div>
              )}
            </div>
          )}

          {latest && (
            <div className="lastpick-card">
              <div className="lastpick-label">LAST PICK</div>
              <div className="lastpick-hero">
                <div
                  className="lp-portrait"
                  style={{ borderColor: POSITION_COLORS[latest.player.position] }}
                >
                  {latest.player.headshotUrl ? (
                    <img
                      src={latest.player.headshotUrl}
                      alt={latest.player.name}
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  ) : (
                    <span
                      className="lp-portrait-fallback"
                      style={{ color: POSITION_COLORS[latest.player.position] }}
                    >
                      {latest.player.position}
                    </span>
                  )}
                  {latestLogo && (
                    <img
                      className="lp-team-logo"
                      src={latestLogo}
                      alt={latest.player.nflTeam}
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  )}
                </div>
                <div className="lp-hero-info">
                  <div className="lastpick-overall">
                    #{latest.pick.overall} · {latest.team.emoji} {latest.team.name}
                  </div>
                  <div className="lastpick-name">{latest.player.name}</div>
                  <div
                    className="lastpick-pos"
                    style={{ background: POSITION_COLORS[latest.player.position] }}
                  >
                    {latest.player.position} · {latest.player.nflTeam} · Bye{" "}
                    {latest.player.byeWeek}
                  </div>
                  {latestValue && latestValue.kind !== "fair" && (
                    <div className={`lp-value lp-value-${latestValue.kind}`}>
                      {latestValue.kind === "steal" ? "💰 STEAL" : "📈 REACH"}
                      <span className="lp-value-sub">
                        {latestValue.kind === "steal"
                          ? `fell ${latestValue.spots} past ADP`
                          : `${latestValue.spots} picks early`}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <div className="lastpick-stats">
                {Object.entries(latest.player.stats)
                  .slice(0, 4)
                  .map(([k, v]) => (
                    <div key={k} className="lp-stat">
                      <span className="lp-val">{v}</span>
                      <span className="lp-key">{formatStatKey(k)}</span>
                    </div>
                  ))}
              </div>

              {earlier.length > 0 && (
                <div className="recent-picks">
                  <div className="recent-label">EARLIER PICKS</div>
                  {earlier.map(({ pick, player, team }) => {
                    const logo = teamLogoUrl(player.nflTeam);
                    return (
                      <div key={pick.overall} className="recent-row">
                        <div
                          className="rp-thumb"
                          style={{ borderColor: POSITION_COLORS[player.position] }}
                        >
                          {player.headshotUrl ? (
                            <img
                              src={player.headshotUrl}
                              alt={player.name}
                              onError={(e) => {
                                e.currentTarget.style.display = "none";
                              }}
                            />
                          ) : logo ? (
                            <img
                              src={logo}
                              alt={player.nflTeam}
                              onError={(e) => {
                                e.currentTarget.style.display = "none";
                              }}
                            />
                          ) : (
                            <span style={{ color: POSITION_COLORS[player.position] }}>
                              {player.position}
                            </span>
                          )}
                        </div>
                        <div className="rp-info">
                          <div className="rp-name">{player.name}</div>
                          <div className="rp-sub">
                            <span
                              className="rp-pos"
                              style={{ color: POSITION_COLORS[player.position] }}
                            >
                              {player.position} · {player.nflTeam}
                            </span>
                          </div>
                        </div>
                        <div className="rp-meta">
                          <span className="rp-overall">#{pick.overall}</span>
                          <span className="rp-team" title={team.name}>
                            {team.emoji}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
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
