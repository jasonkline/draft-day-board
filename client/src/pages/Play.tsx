import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { HeckleKind, Player, SessionState } from "@shared/types";
import { emit } from "../lib/socket";
import { getTeamCreds, saveTeamCreds } from "../lib/storage";
import { useSessionState, useReveal, useCountdown } from "../lib/useDraft";
import { PlayerPool } from "../components/PlayerPool";
import { ConfirmPickModal } from "../components/ConfirmPickModal";
import { TeamAvatar } from "../components/TeamAvatar";
import { playDing, unlockAudio } from "../lib/sound";
import { POSITION_COLORS, playerById, teamById } from "../lib/util";

export function Play() {
  const { code = "" } = useParams();
  const upper = code.toUpperCase();
  const { state, setState, connected } = useSessionState();
  const [creds, setCreds] = useState(() => getTeamCreds(upper));
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function go() {
      const ack = await emit("session:watch", { code: upper });
      if (cancelled) return;
      if (!ack.ok || !ack.state) {
        setError(ack.error || "Session not found");
        return;
      }
      setState(ack.state);
      // Re-establish our claim on reconnect/refresh.
      const stored = getTeamCreds(upper);
      if (stored) {
        const claim = await emit("session:claimTeam", {
          code: upper,
          teamId: stored.teamId,
          teamToken: stored.teamToken,
        });
        if (!cancelled && claim.ok && claim.teamId && claim.teamToken) {
          saveTeamCreds(upper, claim.teamId, claim.teamToken);
          setCreds({ teamId: claim.teamId, teamToken: claim.teamToken });
        }
      }
    }
    void go();
    return () => {
      cancelled = true;
    };
  }, [upper, connected, setState]);

  // Vibrate + ding when a pick comes in.
  useReveal(
    useCallback((e) => {
      playDing();
      if (navigator.vibrate) navigator.vibrate(120);
      // mark e as used
      void e;
    }, [])
  );

  if (!state) {
    return (
      <div className="play play-loading">
        <div className="logo-spin">🏈</div>
        <p>{error || "Joining draft…"}</p>
        <p className="hint">Code {upper}</p>
      </div>
    );
  }

  if (!creds) {
    return (
      <ClaimView
        state={state}
        code={upper}
        onClaimed={(teamId, teamToken) => {
          saveTeamCreds(upper, teamId, teamToken);
          setCreds({ teamId, teamToken });
        }}
      />
    );
  }

  return <PlayerView state={state} code={upper} creds={creds} />;
}

/* ----------------------- CLAIM A TEAM ----------------------- */

function ClaimView({
  state,
  code,
  onClaimed,
}: {
  state: SessionState;
  code: string;
  onClaimed: (teamId: string, token: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  async function claim(teamId: string) {
    unlockAudio();
    setBusy(teamId);
    setErr("");
    const ack = await emit("session:claimTeam", { code, teamId });
    setBusy(null);
    if (ack.ok && ack.teamId && ack.teamToken) {
      onClaimed(ack.teamId, ack.teamToken);
    } else {
      setErr(ack.error || "Could not claim team");
    }
  }

  return (
    <div className="play claim">
      <header className="play-head">
        <h1>{state.config.leagueName}</h1>
        <p>Pick your team to join the draft</p>
      </header>
      {err && <div className="toast-error">{err}</div>}
      <div className="claim-grid">
        {state.teams.map((t) => (
          <button
            key={t.id}
            className={`claim-team ${t.claimed ? "claim-taken" : ""}`}
            style={{ borderColor: t.avatarColor }}
            disabled={t.claimed || busy != null}
            onClick={() => claim(t.id)}
          >
            <TeamAvatar team={t} className="claim-emoji" />
            <span className="claim-name">{t.name}</span>
            {t.claimed ? (
              <span className="claim-status">Taken</span>
            ) : (
              <span className="claim-status claim-open">
                {busy === t.id ? "Joining…" : "Tap to join"}
              </span>
            )}
          </button>
        ))}
      </div>
      <p className="hint">
        On the big screen instead? <Link to={`/board/${code}`}>Open the board</Link>.
      </p>
    </div>
  );
}

/* ----------------------- PLAYER DRAFT VIEW ----------------------- */

function PlayerView({
  state,
  code,
  creds,
}: {
  state: SessionState;
  code: string;
  creds: { teamId: string; teamToken: string };
}) {
  const [selected, setSelected] = useState<Player | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [heckleCooldown, setHeckleCooldown] = useState(false);
  const secondsLeft = useCountdown(state.pickDeadline);

  const myTeam = teamById(state, creds.teamId);
  const onClockTeam = teamById(state, state.onClockTeamId);
  const isMyTurn =
    state.status === "drafting" && state.onClockTeamId === creds.teamId;
  const selfMode = state.config.mode === "self";
  const canPick = isMyTurn && selfMode;
  // NSFW: off-clock players get heckle buttons that take over the board.
  const offClock = state.config.nsfw && state.status === "drafting" && !isMyTurn;

  async function heckle(kind: HeckleKind) {
    // One shared cooldown — the server gates all heckles per session anyway.
    setHeckleCooldown(true);
    if (navigator.vibrate) navigator.vibrate([60, 40, 90]);
    await emit("fan:heckle", { code, kind, teamToken: creds.teamToken });
    setTimeout(() => setHeckleCooldown(false), 2600);
  }

  const myRoster = useMemo(
    () =>
      state.picks
        .filter((p) => p.teamId === creds.teamId)
        .map((p) => ({ pick: p, player: playerById(state, p.playerId) })),
    [state.picks, state.players, creds.teamId]
  );

  async function confirmPick() {
    if (!selected) return;
    setBusy(true);
    setErr("");
    const ack = await emit("pick:make", {
      code,
      playerId: selected.id,
      teamToken: creds.teamToken,
    });
    setBusy(false);
    if (!ack.ok) {
      setErr(ack.error || "Pick failed");
      return;
    }
    setSelected(null);
  }

  return (
    <div className="play">
      <header
        className="play-head play-head-team"
        style={{ borderColor: myTeam?.avatarColor }}
      >
        <div>
          <span className="play-you" style={{ color: myTeam?.avatarColor }}>
            {myTeam && <TeamAvatar team={myTeam} />} {myTeam?.name}
          </span>
          <span className="play-league">{state.config.leagueName}</span>
        </div>
        <Link className="btn btn-small btn-ghost" to={`/board/${code}`} target="_blank" rel="noopener noreferrer">
          📺
        </Link>
      </header>

      {state.status === "setup" && (
        <div className="play-status">
          ⏳ Waiting for the commissioner to start the draft…
        </div>
      )}

      {state.status === "complete" && (
        <div className="play-status play-done">
          🎉 Draft complete! Check your roster below.
          <div className="export-links">
            <a className="btn btn-small" href={`/api/export/${state.code}?format=csv`} download>
              📄 Results CSV
            </a>
            <a className="btn btn-small" href={`/api/export/${state.code}?format=json`} download>
              🗂 Results JSON
            </a>
          </div>
        </div>
      )}

      {state.status === "drafting" && (
        <div
          className={`turn-banner ${isMyTurn ? "turn-mine" : ""}`}
          style={!isMyTurn ? { borderColor: onClockTeam?.avatarColor } : undefined}
        >
          {isMyTurn ? (
            <>
              <span className="turn-big">🟢 YOU'RE ON THE CLOCK</span>
              {!selfMode && (
                <span className="turn-sub">
                  The commissioner is entering picks for everyone.
                </span>
              )}
            </>
          ) : (
            <>
              <span className="turn-sub">On the clock</span>
              <span className="turn-big" style={{ color: onClockTeam?.avatarColor }}>
                {onClockTeam && <TeamAvatar team={onClockTeam} />} {onClockTeam?.name}
              </span>
            </>
          )}
          {secondsLeft != null && (
            <span className={`turn-timer ${secondsLeft <= 10 ? "timer-warn" : ""}`}>
              {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
            </span>
          )}
        </div>
      )}

      {offClock && (state.config.hurryUpButton || state.config.bruhButton) && (
        <div className="heckle-bar">
          {state.config.hurryUpButton && (
            <button
              className="htfu-btn"
              onClick={() => heckle("hurryUp")}
              disabled={heckleCooldown}
            >
              😤 HURRY THE F#@% UP
              <small>
                {heckleCooldown ? "…take a breath…" : "Blast it on the big screen"}
              </small>
            </button>
          )}
          {state.config.bruhButton && (
            <button
              className="htfu-btn htfu-btn-bruh"
              onClick={() => heckle("bruh")}
              disabled={heckleCooldown}
            >
              🤦 BRUH… YOU STUPID
              <small>
                {heckleCooldown ? "…take a breath…" : "Blast it on the big screen"}
              </small>
            </button>
          )}
        </div>
      )}

      {err && <div className="toast-error">{err}</div>}

      {canPick && (
        <PlayerPool
          state={state}
          onSelect={(p) => {
            setErr("");
            setSelected(p);
          }}
        />
      )}

      {state.status === "drafting" && !canPick && !isMyTurn && selfMode && (
        <PlayerPool
          state={state}
          disabled
          disabledReason="Browse the board — you can pick when you're on the clock."
          onSelect={() => {}}
        />
      )}

      <section className="roster">
        <h3>
          Your roster ({myRoster.length}/{state.config.rounds})
        </h3>
        {myRoster.length === 0 && <p className="hint">No picks yet.</p>}
        <ul className="roster-list">
          {myRoster.map(({ pick, player }) => (
            <li key={pick.overall} className="roster-row">
              <span
                className="roster-pos"
                style={{
                  background: player ? POSITION_COLORS[player.position] : "#444",
                }}
              >
                {player?.position}
              </span>
              <span className="roster-name">{player?.name}</span>
              <span className="roster-meta">
                R{pick.round} · #{pick.overall}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {selected && myTeam && (
        <ConfirmPickModal
          player={selected}
          team={myTeam}
          busy={busy}
          error={err}
          onConfirm={confirmPick}
          onCancel={() => setSelected(null)}
        />
      )}
    </div>
  );
}
