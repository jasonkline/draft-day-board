import type { Player, PublicTeam } from "@shared/types";
import { POSITION_COLORS, formatStatKey } from "../lib/util";
import { TeamAvatar } from "./TeamAvatar";

interface Props {
  player: Player;
  team?: PublicTeam;
  busy?: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmPickModal({
  player,
  team,
  busy,
  error,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-eyebrow">Confirm your pick</div>
        <div
          className="modal-portrait"
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
          ) : (
            <span
              className="modal-portrait-fallback"
              style={{ color: POSITION_COLORS[player.position] }}
            >
              {player.position}
            </span>
          )}
        </div>
        <div
          className="modal-pos"
          style={{ background: POSITION_COLORS[player.position] }}
        >
          {player.position}
        </div>
        <h2 className="modal-name">{player.name}</h2>
        <div className="modal-meta">
          {player.nflTeam} · Bye {player.byeWeek} · #{player.positionRank}{" "}
          {player.position} · ADP {player.adp.toFixed(0)}
        </div>
        <p className="modal-blurb">{player.blurb}</p>

        <div className="modal-stats">
          {Object.entries(player.stats)
            .slice(0, 5)
            .map(([k, v]) => (
              <div key={k} className="modal-stat">
                <span className="stat-val">{v}</span>
                <span className="stat-key">{formatStatKey(k)}</span>
              </div>
            ))}
        </div>

        {team && (
          <div className="modal-team">
            Drafting for{" "}
            <strong style={{ color: team.avatarColor }}>
              <TeamAvatar team={team} /> {team.name}
            </strong>
          </div>
        )}

        {error && <div className="modal-error">{error}</div>}

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={onConfirm} disabled={busy}>
            {busy ? "Locking in…" : "Lock It In 🔒"}
          </button>
        </div>
        <p className="modal-warn">
          This can't be undone (except by the commissioner). Make it count!
        </p>
      </div>
    </div>
  );
}
