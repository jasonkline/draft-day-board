import { useMemo, useState } from "react";
import type { Player, PlayerPosition, SessionState } from "@shared/types";
import {
  POSITION_COLORS,
  POSITION_ORDER,
  availablePlayers,
  teamLogoUrl,
} from "../lib/util";

interface Props {
  state: SessionState;
  onSelect: (player: Player) => void;
  disabled?: boolean;
  disabledReason?: string;
}

type SortKey = "rank" | "name" | "nflTeam" | "adp" | "projectedPoints" | "byeWeek";
type SortDir = "asc" | "desc";

interface Column {
  key: SortKey;
  label: string;
  className: string;
  numeric?: boolean;
}

// Column definitions; order here drives both the header and each row's grid.
const COLUMNS: Column[] = [
  { key: "rank", label: "#", className: "col-rank", numeric: true },
  { key: "name", label: "Player", className: "col-name" },
  { key: "nflTeam", label: "Team", className: "col-team" },
  { key: "adp", label: "ADP", className: "col-adp", numeric: true },
  { key: "projectedPoints", label: "Proj", className: "col-proj", numeric: true },
  { key: "byeWeek", label: "Bye", className: "col-bye", numeric: true },
];

// Whether the default direction for a freshly-clicked column is ascending.
// Rank/ADP/Bye read best low-to-high; points and names read better the other way.
const ASC_FIRST: Record<SortKey, boolean> = {
  rank: true,
  name: true,
  nflTeam: true,
  adp: true,
  projectedPoints: false,
  byeWeek: true,
};

export function PlayerPool({ state, onSelect, disabled, disabledReason }: Props) {
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<PlayerPosition | "ALL">("ALL");
  const [team, setTeam] = useState<string>("ALL");
  const [byeWeeks, setByeWeeks] = useState<Set<number>>(new Set());
  const [byeMode, setByeMode] = useState<"include" | "exclude">("include");
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const players = useMemo(() => availablePlayers(state), [state]);

  // Distinct teams / byes for the dropdowns, drawn from the live pool.
  const teamOptions = useMemo(
    () => [...new Set(players.map((p) => p.nflTeam))].sort(),
    [players]
  );
  const byeOptions = useMemo(
    () => [...new Set(players.map((p) => p.byeWeek))].sort((a, b) => a - b),
    [players]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = players.filter((p) => {
      if (pos !== "ALL" && p.position !== pos) return false;
      if (team !== "ALL" && p.nflTeam !== team) return false;
      if (byeWeeks.size > 0) {
        const matches = byeWeeks.has(p.byeWeek);
        if (byeMode === "include" ? !matches : matches) return false;
      }
      if (q && !p.name.toLowerCase().includes(q) && !p.nflTeam.toLowerCase().includes(q))
        return false;
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      // Stable tiebreak on rank so equal values keep a sensible order.
      return cmp !== 0 ? cmp * dir : a.rank - b.rank;
    });
    return rows;
  }, [players, query, pos, team, byeWeeks, byeMode, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(ASC_FIRST[key] ? "asc" : "desc");
    }
  }

  function toggleBye(week: number) {
    setByeWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(week)) next.delete(week);
      else next.add(week);
      return next;
    });
  }

  const hasFilters =
    pos !== "ALL" || team !== "ALL" || byeWeeks.size > 0 || query !== "";

  const byeSummary =
    byeWeeks.size === 0
      ? "All byes"
      : `${byeMode === "include" ? "Only" : "Not"} ${[...byeWeeks]
          .sort((a, b) => a - b)
          .join(", ")}`;

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
        <div className="pool-selects">
          <label className="pool-select">
            <span>Team</span>
            <select value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="ALL">All teams</option>
              {teamOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <div className="pool-select">
            <span>Bye</span>
            <details className="bye-dd">
              <summary className={byeWeeks.size > 0 ? "is-active" : ""}>
                {byeSummary}
              </summary>
              <div className="bye-panel">
                <div className="bye-mode">
                  <button
                    className={`chip ${byeMode === "include" ? "chip-on" : ""}`}
                    onClick={() => setByeMode("include")}
                  >
                    Include
                  </button>
                  <button
                    className={`chip ${byeMode === "exclude" ? "chip-on" : ""}`}
                    onClick={() => setByeMode("exclude")}
                  >
                    Exclude
                  </button>
                </div>
                <div className="bye-weeks">
                  {byeOptions.map((b) => (
                    <label key={b} className="bye-check">
                      <input
                        type="checkbox"
                        checked={byeWeeks.has(b)}
                        onChange={() => toggleBye(b)}
                      />
                      Week {b}
                    </label>
                  ))}
                </div>
                {byeWeeks.size > 0 && (
                  <button
                    className="pool-clear bye-reset"
                    onClick={() => setByeWeeks(new Set())}
                  >
                    Reset byes
                  </button>
                )}
              </div>
            </details>
          </div>
          {hasFilters && (
            <button
              className="pool-clear"
              onClick={() => {
                setQuery("");
                setPos("ALL");
                setTeam("ALL");
                setByeWeeks(new Set());
              }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {disabled && disabledReason && (
        <div className="pool-locked">{disabledReason}</div>
      )}

      {/* Header + list share one horizontal scroller so the columns stay
          aligned when the table is wider than a phone screen. */}
      <div className="pool-tablewrap">
        <div className="pool-header" role="row">
        {COLUMNS.map((c) => {
          const active = sortKey === c.key;
          return (
            <button
              key={c.key}
              className={`pool-th ${c.className} ${c.numeric ? "is-num" : ""} ${
                active ? "is-sorted" : ""
              }`}
              onClick={() => toggleSort(c.key)}
            >
              {c.label}
              <span className="sort-caret">
                {active ? (sortDir === "asc" ? "▲" : "▼") : ""}
              </span>
            </button>
          );
        })}
      </div>

      <div className="pool-list">
        {filtered.length === 0 && <div className="pool-empty">No players match.</div>}
        {filtered.map((p) => {
          const logo = teamLogoUrl(p.nflTeam);
          return (
            <button
              key={p.id}
              className="player-row"
              disabled={disabled}
              onClick={() => onSelect(p)}
            >
              <span className="col-rank player-rank">{p.rank}</span>
              <span className="col-name player-name">
                <span
                  className="player-pos"
                  style={{ background: POSITION_COLORS[p.position] }}
                >
                  {p.position}
                </span>
                <span className="player-name-text">{p.name}</span>
              </span>
              <span className="col-team player-teamcell">
                {logo && (
                  <img
                    className="team-logo"
                    src={logo}
                    alt=""
                    loading="lazy"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                )}
                <span className="team-abbr">{p.nflTeam}</span>
              </span>
              <span className="col-adp player-num">{p.adp.toFixed(1)}</span>
              <span className="col-proj player-num player-proj">
                {p.projectedPoints.toFixed(1)}
              </span>
              <span className="col-bye player-num">{p.byeWeek}</span>
            </button>
          );
        })}
        </div>
      </div>
    </div>
  );
}
