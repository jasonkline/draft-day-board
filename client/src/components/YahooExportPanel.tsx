import { useMemo, useState } from "react";
import type { SessionState } from "@shared/types";

/**
 * Commissioner panel (shown when the draft is complete) for pushing the finished
 * draft back into a Yahoo league. The actual write happens in a Tampermonkey
 * userscript that runs on Yahoo's offline "Submit Draft Results" page — there is
 * no Yahoo API for writing draft results, so the userscript drives that form.
 * This panel hands the commissioner the importer + a one-time "connection code"
 * (server origin + draft code + admin token) the importer needs to fetch results.
 */
export function YahooExportPanel({
  state,
  code,
  adminToken,
}: {
  state: SessionState;
  code: string;
  adminToken: string;
}) {
  const [copied, setCopied] = useState(false);

  const { mapped, missing } = useMemo(() => {
    const hasKey = new Map(state.players.map((p) => [p.id, !!p.yahooPlayerKey]));
    let mapped = 0;
    let missing = 0;
    for (const pick of state.picks) {
      if (hasKey.get(pick.playerId)) mapped++;
      else missing++;
    }
    return { mapped, missing };
  }, [state.players, state.picks]);

  const origin = window.location.origin;
  const userscriptUrl = `${origin}/yahoo-import.user.js`;
  // The importer runs on yahoo.com (a different origin) so it can't read our
  // localStorage — it gets everything it needs from this opaque code instead.
  const connectionCode = useMemo(
    () => btoa(JSON.stringify({ o: origin, c: code, t: adminToken })),
    [origin, code, adminToken],
  );

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(connectionCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked; the code is shown for manual copy */
    }
  }

  const noneMapped = mapped === 0;

  return (
    <details className="card extras-card yx-panel">
      <summary className="extras-summary">
        <span>🟣 Push results to Yahoo</span>
        <small>Fill your Yahoo league's rosters from this draft</small>
      </summary>
      <div className="extras-body">
        {noneMapped ? (
          <p className="hint yx-warn">
            None of these picks carry a Yahoo player ID, so they can't be pushed
            automatically. This feature works on a league you{" "}
            <strong>imported from Yahoo</strong> (which pulls Yahoo's player pool).
          </p>
        ) : (
          missing > 0 && (
            <p className="hint yx-warn">
              ⚠️ {missing} of {mapped + missing} picks have no Yahoo ID and will be
              skipped — enter those few by hand in Yahoo.
            </p>
          )
        )}

        <ol className="yx-steps">
          <li>
            One-time: install the{" "}
            <a href={userscriptUrl} target="_blank" rel="noopener noreferrer">
              Draft Day → Yahoo importer
            </a>{" "}
            (needs the free{" "}
            <a
              href="https://www.tampermonkey.net"
              target="_blank"
              rel="noopener noreferrer"
            >
              Tampermonkey
            </a>{" "}
            browser extension).
          </li>
          <li>
            In Yahoo, go to <strong>Commissioner → Draft &amp; Keepers →
            Submit Draft Results</strong>, choose <strong>Standard</strong>, then{" "}
            <strong>Continue</strong> to the “Enter Draft Results” grid.
          </li>
          <li>
            A <strong>Draft Day Board</strong> panel appears (top-right). Paste the
            connection code below, then click <strong>Import picks</strong>.
          </li>
          <li>
            Review the filled rosters, then click Yahoo's{" "}
            <strong>Save &amp; Begin Season</strong> to finalize.
          </li>
        </ol>

        <div className="yx-codebox">
          <label>Connection code</label>
          <div className="yx-coperow">
            <input
              className="yx-code"
              readOnly
              value={connectionCode}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button className="btn btn-small" onClick={copyCode}>
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <small className="hint">
            Includes your commissioner token — only paste it into the importer on
            your own computer.
          </small>
        </div>
      </div>
    </details>
  );
}
