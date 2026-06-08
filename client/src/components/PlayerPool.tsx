import { useMemo, useState } from "react";
import type { Player, PlayerPosition, SessionState } from "@shared/types";
import {
  POSITION_COLORS,
  POSITION_ORDER,
  availablePlayers,
} from "../lib/util";

interface Props {
  state: SessionState;
  onSelect: (player: Player) => void;
  disabled?: boolean;
  disabledReason?: string;
}

export function PlayerPool({ state, onSelect, disabled, disabledReason }: Props) {
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<PlayerPosition | "ALL">("ALL");

  const players = useMemo(() => availablePlayers(state), [state]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return players.filter((p) => {
      if (pos !== "ALL" && p.position !== pos) return false;
      if (q && !p.name.toLowerCase().includes(q) && !p.nflTeam.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [players, query, pos]);

  return (
    <div className="pool">
      <div className="pool-controls">
        <input
          className="pool-search"
          placeholder="Search players…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="pos-filters">
          <button
            className={`chip ${pos === "ALL" ? "chip-on" : ""}`}
            onClick={() => setPos("ALL")}
          >
            ALL
          </button>
          {POSITION_ORDER.map((p) => (
            <button
              key={p}
              className={`chip ${pos === p ? "chip-on" : ""}`}
              style={pos === p ? { background: POSITION_COLORS[p] } : undefined}
              onClick={() => setPos(p)}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {disabled && disabledReason && (
        <div className="pool-locked">{disabledReason}</div>
      )}

      <div className="pool-list">
        {filtered.length === 0 && <div className="pool-empty">No players match.</div>}
        {filtered.map((p) => (
          <button
            key={p.id}
            className="player-row"
            disabled={disabled}
            onClick={() => onSelect(p)}
          >
            <span className="player-rank">{p.rank}</span>
            <span
              className="player-pos"
              style={{ background: POSITION_COLORS[p.position] }}
            >
              {p.position}
            </span>
            <span className="player-name">
              {p.name}
              <span className="player-team">
                {p.nflTeam} · BYE {p.byeWeek}
              </span>
            </span>
            <span className="player-proj">{p.projectedPoints.toFixed(1)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
