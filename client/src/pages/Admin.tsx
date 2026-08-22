import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type {
  DraftConfig,
  HeckleKind,
  Player,
  SessionState,
} from "@shared/types";
import { emit } from "../lib/socket";
import { getAdminToken } from "../lib/storage";
import { useSessionState, useReveal, useCountdown } from "../lib/useDraft";
import { ShareLinks } from "../components/ShareLinks";
import { YahooExportPanel } from "../components/YahooExportPanel";
import { PlayerPool } from "../components/PlayerPool";
import { ConfirmPickModal } from "../components/ConfirmPickModal";
import { TeamAvatar } from "../components/TeamAvatar";
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

  // Ding on the commissioner device too, for ambience (respecting the toggles).
  const chimeOn = !!state?.config.sounds && !!state?.config.announcementSound;
  useReveal(useCallback(() => {
    if (chimeOn) playDing();
  }, [chimeOn]));

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
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState("");

  async function refreshPlayers() {
    setRefreshing(true);
    setRefreshMsg("");
    const ack = await emit("admin:refreshPlayers", { code, adminToken });
    setRefreshing(false);
    setRefreshMsg(
      ack.ok
        ? `✅ Updated — ${ack.count} players loaded.`
        : `⚠️ ${ack.error || "Refresh failed"}`
    );
  }

  const patchConfig = (patch: Partial<DraftConfig>) =>
    emit("admin:updateConfig", { code, adminToken, config: patch });

  const renameTeam = (id: string, name: string) =>
    emit("admin:updateTeams", { code, adminToken, teams: [{ id, name }] });

  // ---- Paste-in team names (bulk rename, one per line) ----
  const [pasteText, setPasteText] = useState("");
  const [pasteMsg, setPasteMsg] = useState("");

  async function applyPastedNames() {
    const names = pasteText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (names.length === 0) {
      setPasteMsg("Paste one team name per line first.");
      return;
    }
    const updates = state.draftOrder
      .slice(0, names.length)
      .map((id, i) => ({ id, name: names[i].slice(0, 40) }));
    const ack = await emit("admin:updateTeams", { code, adminToken, teams: updates });
    if (!ack.ok) {
      setPasteMsg(`⚠️ ${ack.error || "Rename failed"}`);
      return;
    }
    const extra = names.length - updates.length;
    setPasteMsg(
      `✅ Renamed ${updates.length} team${updates.length === 1 ? "" : "s"}.` +
        (extra > 0
          ? ` ${extra} extra line${extra === 1 ? "" : "s"} ignored — this draft has ${state.teams.length} teams.`
          : "")
    );
    setPasteText("");
  }

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
                  <TeamAvatar team={team} className="order-emoji" />
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
          <details className="paste-names">
            <summary>📋 Paste team names</summary>
            <p className="hint">
              One name per line, applied top-to-bottom to the order above.
            </p>
            <textarea
              className="paste-names-input"
              rows={Math.min(10, state.teams.length)}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={"The Gridiron Gang\nBye Week Believers\n…"}
            />
            <button className="btn btn-small" onClick={applyPastedNames}>
              Apply names
            </button>
            {pasteMsg && <p className="hint">{pasteMsg}</p>}
          </details>
        </section>

        <section className="card">
          <h2>Share</h2>
          <ShareLinks code={code} />
          <p className="hint" style={{ marginTop: "0.6rem" }}>
            <a href={`/api/backup/${code}?token=${encodeURIComponent(adminToken)}`} download>
              💾 Download backup
            </a>{" "}
            — a file that can restore this whole draft (keep it private, it
            holds the control links).
          </p>
        </section>

        <section className="card">
          <h2>Player Data</h2>
          <p className="hint">
            {state.players.length} players loaded. Pull the latest Yahoo
            rankings &amp; ADP before you draft (uses Yahoo's public data — no
            account needed).
          </p>
          <button className="btn btn-small" onClick={refreshPlayers} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "↻ Refresh player data"}
          </button>
          {refreshMsg && <p className="hint">{refreshMsg}</p>}
        </section>

        <details className="card extras-card">
          <summary className="extras-summary">
            <span>✨ Additional options</span>
            <small>Sounds, reveal timing &amp; board display</small>
          </summary>
          <div className="extras-body">
            <div className="extras-group">
              <h3>
                Show &amp; sound <span className="tag-live">changeable anytime</span>
              </h3>
              <ShowControls cfg={cfg} patch={(p) => void patchConfig(p)} />
            </div>
            <div className="divider" />
            <div className="extras-group">
              <h3>
                NSFW <span className="tag-nsfw">18+</span>{" "}
                <span className="tag-live">changeable anytime</span>
              </h3>
              <NsfwControls cfg={cfg} patch={(p) => void patchConfig(p)} />
            </div>
            <div className="divider" />
            <div className="extras-group">
              <h3>
                Board display <span className="tag-lock">locks at start</span>
              </h3>
              <Switch
                label="Position-run banner"
                hint="“🔥 QB RUN” when a position goes hot"
                checked={cfg.showPositionRuns}
                onChange={(v) => void patchConfig({ showPositionRuns: v })}
              />
              <Switch
                label="Value badges"
                hint="STEAL / REACH tags on the last-pick card"
                checked={cfg.showValueBadges}
                onChange={(v) => void patchConfig({ showValueBadges: v })}
              />
              <Switch
                label="On-deck indicator"
                hint="Show which team is up next"
                checked={cfg.showOnDeck}
                onChange={(v) => void patchConfig({ showOnDeck: v })}
              />
            </div>
          </div>
        </details>
      </div>

      <div className="admin-startbar">
        {err && <span className="toast-error">{err}</span>}
        <Link className="btn btn-ghost" to={`/board/${code}`} target="_blank" rel="noopener noreferrer">
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

/* ----------------------- ADDITIONAL OPTIONS ----------------------- */

function Switch({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className={`switch-row ${disabled ? "switch-disabled" : ""}`}>
      <span className="switch-text">
        <span className="switch-label">{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      <button
        type="button"
        className={`chip ${checked ? "chip-on" : ""}`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        {checked ? "On" : "Off"}
      </button>
    </div>
  );
}

/** A compact "label … [– N s +]" duration row, styled like the switch rows. */
function DurationRow({
  label,
  hint,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className={`switch-row ${disabled ? "switch-disabled" : ""}`}>
      <span className="switch-text">
        <span className="switch-label">{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      <div className="stepper-ctl dur-ctl">
        <button
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={disabled || value <= min}
        >
          –
        </button>
        <span className="stepper-val">{value}s</span>
        <button
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={disabled || value >= max}
        >
          +
        </button>
      </div>
    </div>
  );
}

/**
 * The live-editable show controls. The reveal has two beats — the "pick is in"
 * announcement and the player-card reveal — each with an independent visual
 * toggle, sound toggle, and hold duration. A master switch mutes both sounds.
 */
function ShowControls({
  cfg,
  patch,
}: {
  cfg: DraftConfig;
  patch: (p: Partial<DraftConfig>) => void;
}) {
  const soundsOff = !cfg.sounds;
  return (
    <>
      <Switch
        label="Sounds"
        hint="Master switch — mutes both cues, leaves the visuals alone"
        checked={cfg.sounds}
        onChange={(v) => patch({ sounds: v })}
      />

      <div className="beat-label">📣 “Pick is in” announcement</div>
      <Switch
        label="Show announcement"
        hint="The “THE PICK IS IN” suspense screen"
        checked={cfg.announcementVisual}
        onChange={(v) => patch({ announcementVisual: v })}
      />
      <Switch
        label="Play chime"
        hint="Ding the moment each pick lands"
        checked={cfg.announcementSound}
        disabled={soundsOff}
        onChange={(v) => patch({ announcementSound: v })}
      />
      <DurationRow
        label="Announcement time"
        hint="How long the suspense screen holds"
        value={cfg.announcementSeconds}
        min={1}
        max={30}
        disabled={!cfg.announcementVisual}
        onChange={(v) => patch({ announcementSeconds: v })}
      />

      <div className="beat-label">🎉 Player reveal</div>
      <Switch
        label="Show reveal card"
        hint="The dramatic full-screen player card"
        checked={cfg.revealVisual}
        onChange={(v) => patch({ revealVisual: v })}
      />
      <Switch
        label="Play fanfare"
        hint="Triumphant flourish on the reveal"
        checked={cfg.revealSound}
        disabled={soundsOff}
        onChange={(v) => patch({ revealSound: v })}
      />
      <DurationRow
        label="Reveal time"
        hint="How long the player card holds"
        value={cfg.revealSeconds}
        min={3}
        max={60}
        disabled={!cfg.revealVisual}
        onChange={(v) => patch({ revealSeconds: v })}
      />
    </>
  );
}

/** NSFW rated-R extras. Off by default; each feature gated by the master. */
function NsfwControls({
  cfg,
  patch,
}: {
  cfg: DraftConfig;
  patch: (p: Partial<DraftConfig>) => void;
}) {
  return (
    <>
      <Switch
        label="🔞 NSFW features"
        hint="Rated-R extras for adult leagues. Off by default."
        checked={cfg.nsfw}
        onChange={(v) => patch({ nsfw: v })}
      />
      <Switch
        label="“Hurry the f#@% up” button"
        hint="Off-clock players get a heckle button — animation + audio on the board"
        checked={cfg.hurryUpButton}
        disabled={!cfg.nsfw}
        onChange={(v) => patch({ hurryUpButton: v })}
      />
      <Switch
        label="“Bruh… you stupid” button"
        hint="A second heckle button — “bruhh” then “you stupid” over its own animation"
        checked={cfg.bruhButton}
        disabled={!cfg.nsfw}
        onChange={(v) => patch({ bruhButton: v })}
      />
    </>
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
  const [heckleCooldown, setHeckleCooldown] = useState(false);
  const secondsLeft = useCountdown(state.pickDeadline);

  const onClockTeam = teamById(state, state.onClockTeamId);
  const isComplete = state.status === "complete";
  const selfMode = state.config.mode === "self";
  // NSFW: the commissioner can always blast a heckle on the big screen while
  // the draft is live (the server gates the cooldown + per-kind toggle).
  const canHeckle =
    state.config.nsfw &&
    state.status === "drafting" &&
    (state.config.hurryUpButton || state.config.bruhButton);

  async function heckle(kind: HeckleKind) {
    setHeckleCooldown(true);
    await emit("fan:heckle", { code, kind });
    setTimeout(() => setHeckleCooldown(false), 2600);
  }

  const patchConfig = (patch: Partial<DraftConfig>) =>
    emit("admin:updateConfig", { code, adminToken, config: patch });

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
        <>
          <div className="complete-banner">🎉 Draft complete! {state.totalPicks} picks made.</div>
          <div className="export-links">
            <a className="btn btn-small" href={`/api/export/${code}?format=csv`} download>
              📄 Download results (CSV)
            </a>
            <a className="btn btn-small" href={`/api/export/${code}?format=json`} download>
              🗂 Download results (JSON)
            </a>
          </div>
          <YahooExportPanel state={state} code={code} adminToken={adminToken} />
        </>
      ) : (
        <div
          className="onclock-strip"
          style={{ borderColor: onClockTeam?.avatarColor }}
        >
          <div>
            <span className="strip-label">ON THE CLOCK</span>
            <span className="strip-team" style={{ color: onClockTeam?.avatarColor }}>
              {onClockTeam && <TeamAvatar team={onClockTeam} />} {onClockTeam?.name}
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
        <Link className="btn btn-ghost" to={`/board/${code}`} target="_blank" rel="noopener noreferrer">
          📺 Board
        </Link>
        <button
          className="btn btn-small"
          onClick={undo}
          disabled={state.picks.length === 0}
        >
          ↩︎ Undo last pick
        </button>
        <a
          className="btn btn-small"
          href={`/api/backup/${code}?token=${encodeURIComponent(adminToken)}`}
          download
        >
          💾 Backup
        </a>
      </div>

      {canHeckle && (
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

      <details className="card extras-card extras-live">
        <summary className="extras-summary">
          <span>🔊 Sound, reveal &amp; NSFW</span>
          <small>Adjust live — takes effect on the next pick</small>
        </summary>
        <div className="extras-body">
          <ShowControls cfg={state.config} patch={(p) => void patchConfig(p)} />
          <div className="divider" />
          <div className="extras-group">
            <h3>
              NSFW <span className="tag-nsfw">18+</span>
            </h3>
            <NsfwControls cfg={state.config} patch={(p) => void patchConfig(p)} />
          </div>
        </div>
      </details>

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
