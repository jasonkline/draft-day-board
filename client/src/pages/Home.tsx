import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { emit } from "../lib/socket";
import { saveAdminToken } from "../lib/storage";
import { unlockAudio } from "../lib/sound";

const DEFAULT_TEAMS = 10;

export function Home() {
  const navigate = useNavigate();
  const [leagueName, setLeagueName] = useState("");
  const [numTeams, setNumTeams] = useState(DEFAULT_TEAMS);
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function createDraft() {
    unlockAudio();
    setBusy(true);
    setError("");
    const teamNames = Array.from(
      { length: numTeams },
      (_, i) => `Team ${i + 1}`
    );
    const ack = await emit("session:create", {
      config: {
        leagueName: leagueName.trim() || "Fantasy Draft",
        draftStyle: "snake",
        mode: "commissioner",
        rounds: 15,
        secondsPerPick: 90,
      },
      teamNames,
    });
    setBusy(false);
    if (!ack.ok || !ack.state || !ack.adminToken) {
      setError(ack.error || "Could not create draft");
      return;
    }
    saveAdminToken(ack.state.code, ack.adminToken);
    navigate(`/admin/${ack.state.code}`);
  }

  function goJoin() {
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4) {
      setError("Enter a valid 5-character draft code");
      return;
    }
    unlockAudio();
    navigate(`/play/${code}`);
  }

  return (
    <div className="home">
      <div className="home-hero">
        <div className="home-logo">🏈</div>
        <h1>Draft Day Board</h1>
        <p className="home-sub">
          Run your in-person fantasy football draft like the real thing — big-screen
          board, dramatic pick reveals, and phone-based picking.
        </p>
      </div>

      <div className="home-grid">
        <section className="card">
          <h2>Start a new draft</h2>
          <label className="field">
            <span>League name</span>
            <input
              value={leagueName}
              onChange={(e) => setLeagueName(e.target.value)}
              placeholder="The Big Game League"
              maxLength={60}
            />
          </label>
          <label className="field">
            <span>Number of teams: {numTeams}</span>
            <input
              type="range"
              min={2}
              max={16}
              value={numTeams}
              onChange={(e) => setNumTeams(Number(e.target.value))}
            />
          </label>
          <button className="btn btn-primary" onClick={createDraft} disabled={busy}>
            {busy ? "Creating…" : "Create Draft →"}
          </button>
          <p className="hint">
            You'll become the commissioner and set up teams, order &amp; rules next.
          </p>
        </section>

        <section className="card">
          <h2>Join a draft</h2>
          <label className="field">
            <span>Draft code</span>
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="ABCDE"
              maxLength={5}
              className="code-input"
            />
          </label>
          <button className="btn" onClick={goJoin}>
            Join &amp; Pick →
          </button>
          <p className="hint">Joining as a player? Grab your team and draft from your phone.</p>

          <div className="divider" />
          <h2>Open the TV board</h2>
          <button
            className="btn btn-ghost"
            onClick={() => {
              const code = joinCode.trim().toUpperCase();
              if (code.length < 4) {
                setError("Enter the draft code above first");
                return;
              }
              unlockAudio();
              navigate(`/board/${code}`);
            }}
          >
            📺 Launch Board
          </button>
          <p className="hint">Cast this to the big screen for everyone to watch.</p>
        </section>
      </div>

      {error && <div className="toast-error">{error}</div>}
      <footer className="home-foot">No accounts. No passwords. Just draft.</footer>
    </div>
  );
}
