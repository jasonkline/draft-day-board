import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { DraftConfig, Player, SessionState } from "@shared/types";
import { emit } from "../lib/socket";
import { getAdminToken } from "../lib/storage";
import { useSessionState, useReveal, useCountdown } from "../lib/useDraft";
import { ShareLinks } from "../components/ShareLinks";
import { PlayerPool } from "../components/PlayerPool";
import { ConfirmPickModal } from "../components/ConfirmPickModal";
import { playDing, unlockAudio } from "../lib/sound";
import { teamById } from "../lib/util";

export function Admin() {
  const { code = "" } = useParams();
  const upper = code.toUpperCase();
  const adminToken = getAdminToken(upper);
  const { state, setState, connected } = useSessionState();
  const [error, setError] = useState("");

  useEffect(() => {
    if (!adminToken) {
      setError("This device isn't the commissioner for this draft.");
      return;
    }
    let cancelled = false;
    async function join() {
      const ack = await emit("session:adminJoin", { code: upper, adminToken: adminToken! });
      if (cancelled) return;
      if (ack.ok && ack.state) setState(ack.state);
      else setError(ack.error || "Could not join as commissioner");
    }
    void join();
    return () => {
      cancelled = true;
    };
  }, [upper, adminToken, connected, setState]);

  // Ding on the commissioner device too, for ambience.
  useReveal(useCallback(() => playDing(), []));

  if (!adminToken) {
    return (
      <div className="admin admin-error">
        <h1>Not the commissioner</h1>
        <p>{error}</p>
        <p>
          If you're a player, <Link to={`/play/${upper}`}>join &amp; pick here</Link>.
        </p>
        <p>
          Want the big screen? <Link to={`/board/${upper}`}>Open the board</Link>.
        </p>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="admin admin-loading">
        <div className="logo-spin">🏈</div>
        <p>{error || "Loading commissioner console…"}</p>
      </div>
    );
  }

  return state.status === "setup" ? (
    <SetupView state={state} code={upper} adminToken={adminToken} />
  ) : (
    <DraftView state={state} code={upper} adminToken={adminToken} />
  );
}

/* ----------------------- SETUP ----------------------- */

function SetupView({
  state,
  code,
  adminToken,
}: {
  state: SessionState;
  code: string;
  adminToken: string;
}) {
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState("");

  const patchConfig = (patch: Partial<DraftConfig>) =>
    emit("admin:updateConfig", { code, adminToken, config: patch });

  const renameTeam = (id: string, name: string) =>
    emit("admin:updateTeams", { code, adminToken, teams: [{ id, name }] });

  const setOrder = (order: string[]) =>
    emit("admin:setOrder", { code, adminToken, order });

  async function start() {
    unlockAudio();
    setStarting(true);
    setErr("");
    const ack = await emit("admin:startDraft", { code, adminToken });
    setStarting(false);
    if (!ack.ok) setErr(ack.error || "Could not start");
  }

  const cfg = state.config;

  function move(i: number, dir: -1 | 1) {
    const order = [...state.draftOrder];
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    void setOrder(order);
  }
  function randomize() {
    const order = [...state.draftOrder];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    void setOrder(order);
  }

  return (
    <div className="admin">
      <header className="admin-head">
        <h1>⚙️ Commissioner Setup</h1>
        <span className="admin-code">CODE {code}</span>
      </header>

      <div className="admin-cols">
        <section className="card">
          <h2>Rules</h2>
          <label className="field">
            <span>League name</span>
            <input
              defaultValue={cfg.leagueName}
              key={cfg.leagueName}
              onBlur={(e) => patchConfig({ leagueName: e.target.value })}
              maxLength={60}
            />
          </label>

          <div className="field">
            <span>Draft mode</span>
            <div className="toggle-row">
              <button
                className={`toggle ${cfg.mode === "commissioner" ? "toggle-on" : ""}`}
                onClick={() => patchConfig({ mode: "commissioner" })}
              >
                🎙️ Commissioner
                <small>One person makes every pick</small>
              </button>
              <button
                className={`toggle ${cfg.mode === "self" ? "toggle-on" : ""}`}
                onClick={() => patchConfig({ mode: "self" })}
              >
                📱 Self-Pick
                <small>Each player picks on their phone</small>
              </button>
            </div>
          </div>

          <div className="field">
            <span>Draft style</span>
            <div className="toggle-row">
              <button
                className={`toggle ${cfg.draftStyle === "snake" ? "toggle-on" : ""}`}
                onClick={() => patchConfig({ draftStyle: "snake" })}
              >
                🐍 Snake
                <small>Order reverses each round</small>
              </button>
              <button
                className={`toggle ${cfg.draftStyle === "linear" ? "toggle-on" : ""}`}
                onClick={() => patchConfig({ draftStyle: "linear" })}
              >
                ➡️ Linear
                <small>Same order every round</small>
              </button>
            </div>
          </div>

          <div className="stepper-row">
            <Stepper
              label="Rounds"
              value={cfg.rounds}
              min={1}
              max={30}
              onChange={(v) => patchConfig({ rounds: v })}
            />
            <Stepper
              label="Sec / pick (0 = off)"
              value={cfg.secondsPerPick}
              min={0}
              max={300}
              step={15}
              onChange={(v) => patchConfig({ secondsPerPick: v })}
            />
          </div>
        </section>

        <section className="card">
          <h2>Teams &amp; Order</h2>
          <p className="hint">
            Tap a name to rename. Reorder for the draft sequence, or randomize it.
          </p>
          <button className="btn btn-small" onClick={randomize}>
            🎲 Randomize order
          </button>
          <ol className="order-list">
            {state.draftOrder.map((id, i) => {
              const team = teamById(state, id)!;
              return (
                <li key={id} className="order-item">
                  <span className="order-num" style={{ background: team.avatarColor }}>
                    {i + 1}
                  </span>
                  <span className="order-emoji">{team.emoji}</span>
                  <input
                    className="order-name"
                    defaultValue={team.name}
                    key={team.name}
                    onBlur={(e) => renameTeam(id, e.target.value)}
                    maxLength={40}
                  />
                  <span className="order-moves">
                    <button onClick={() => move(i, -1)} disabled={i === 0}>
                      ▲
                    </button>
                    <button
                      onClick={() => move(i, 1)}
                      disabled={i === state.draftOrder.length - 1}
                    >
                      ▼
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="card">
          <h2>Share</h2>
          <ShareLinks code={code} />
        </section>
      </div>

      <div className="admin-startbar">
        {err && <span className="toast-error">{err}</span>}
        <Link className="btn btn-ghost" to={`/board/${code}`} target="_blank">
          📺 Open Board
        </Link>
        <button
          className="btn btn-primary btn-big"
          onClick={start}
          disabled={starting || state.teams.length < 2}
        >
          {starting ? "Starting…" : "🏈 Start Draft"}
        </button>
      </div>
    </div>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="stepper">
      <span className="stepper-label">{label}</span>
      <div className="stepper-ctl">
        <button
          onClick={() => onChange(Math.max(min, value - step))}
          disabled={value <= min}
        >
          –
        </button>
        <span className="stepper-val">{value}</span>
        <button
          onClick={() => onChange(Math.min(max, value + step))}
          disabled={value >= max}
        >
          +
        </button>
      </div>
    </div>
  );
}

/* ----------------------- DRAFT CONTROL ----------------------- */

function DraftView({
  state,
  code,
  adminToken,
}: {
  state: SessionState;
  code: string;
  adminToken: string;
}) {
  const [selected, setSelected] = useState<Player | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const secondsLeft = useCountdown(state.pickDeadline);

  const onClockTeam = teamById(state, state.onClockTeamId);
  const isComplete = state.status === "complete";
  const selfMode = state.config.mode === "self";

  async function confirmPick() {
    if (!selected) return;
    setBusy(true);
    setErr("");
    const ack = await emit("pick:make", {
      code,
      playerId: selected.id,
      adminToken,
    });
    setBusy(false);
    if (!ack.ok) {
      setErr(ack.error || "Pick failed");
      return;
    }
    setSelected(null);
  }

  async function undo() {
    if (!confirm("Undo the last pick? It will return to the pool.")) return;
    const ack = await emit("admin:undoPick", { code, adminToken });
    if (!ack.ok) setErr(ack.error || "Undo failed");
  }

  return (
    <div className="admin admin-draft">
      <header className="admin-head">
        <h1>🎙️ Commissioner Control</h1>
        <span className="admin-code">CODE {code}</span>
      </header>

      {isComplete ? (
        <div className="complete-banner">🎉 Draft complete! {state.totalPicks} picks made.</div>
      ) : (
        <div
          className="onclock-strip"
          style={{ borderColor: onClockTeam?.avatarColor }}
        >
          <div>
            <span className="strip-label">ON THE CLOCK</span>
            <span className="strip-team" style={{ color: onClockTeam?.avatarColor }}>
              {onClockTeam?.emoji} {onClockTeam?.name}
            </span>
          </div>
          <div className="strip-right">
            <span>Pick #{state.currentOverall}</span>
            {secondsLeft != null && (
              <span className={secondsLeft <= 10 ? "timer-warn" : ""}>
                {Math.floor(secondsLeft / 60)}:
                {String(secondsLeft % 60).padStart(2, "0")}
              </span>
            )}
          </div>
        </div>
      )}

      {selfMode && !isComplete && (
        <p className="mode-note">
          Self-pick mode: players draft from their phones. You can still pick here
          to keep things moving.
        </p>
      )}

      <div className="admin-draft-actions">
        <Link className="btn btn-ghost" to={`/board/${code}`} target="_blank">
          📺 Board
        </Link>
        <button
          className="btn btn-small"
          onClick={undo}
          disabled={state.picks.length === 0}
        >
          ↩︎ Undo last pick
        </button>
      </div>

      {err && <div className="toast-error">{err}</div>}

      {!isComplete && (
        <PlayerPool
          state={state}
          onSelect={(p) => {
            setErr("");
            setSelected(p);
          }}
        />
      )}

      {selected && onClockTeam && (
        <ConfirmPickModal
          player={selected}
          team={onClockTeam}
          busy={busy}
          error={err}
          onConfirm={confirmPick}
          onCancel={() => setSelected(null)}
        />
      )}
    </div>
  );
}
