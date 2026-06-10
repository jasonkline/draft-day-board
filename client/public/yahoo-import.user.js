// ==UserScript==
// @name         Draft Day Board → Yahoo importer
// @namespace    https://github.com/draft-day-board
// @version      1.0.0
// @description  Push a finished Draft Day Board draft into Yahoo's offline "Submit Draft Results" form. There is no Yahoo API for writing draft results, so this drives the form directly — running in your own logged-in browser.
// @author       Draft Day Board
// @match        https://football.fantasysports.yahoo.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @connect      *
// @run-at       document-idle
// @noframes
// ==/UserScript==

/*
 * How it works (all validated against the live form):
 *  - Yahoo's "Enter Draft Results" form (#ysf-customdraftresults-form) shows ONE
 *    team at a time. Its picks are plain hidden inputs: picks[0..N][pid] = the
 *    numeric Yahoo player id. Yahoo serializes the SAVE from those hidden inputs
 *    (not the visual grid), so we just set them directly.
 *  - The team dropdown (select[name=newtid]) switches teams via an AJAX submit;
 *    completion is signalled by input[name=tid] changing to the new team.
 *  - "Save Progress" is an AJAX save that keeps our JS context alive (no reload).
 *  - So per team: switch → set hidden pids → Save Progress. Always save before
 *    switching (switching with unsaved direct edits can wedge Yahoo's JS).
 *
 * It fetches the finished draft (picks keyed to Yahoo ids) from the Draft Day
 * server using a "connection code" the commissioner copies from the admin page.
 */

(function () {
  "use strict";

  const FORM_ID = "ysf-customdraftresults-form";
  const STORE_KEY = "ddb_connection_code";

  // ---- tiny helpers ----
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const form = () => document.getElementById(FORM_ID);
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  async function waitFor(test, timeoutMs = 10000, intervalMs = 150) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      try {
        if (test()) return true;
      } catch (_) {
        /* keep polling */
      }
      await sleep(intervalMs);
    }
    return false;
  }

  // ---- server ----
  function fetchExport(cfg) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url: cfg.o.replace(/\/+$/, "") + "/api/yahoo/export",
        headers: { "Content-Type": "application/json" },
        data: JSON.stringify({ code: cfg.c, adminToken: cfg.t }),
        timeout: 15000,
        onload: (r) => {
          let body;
          try {
            body = JSON.parse(r.responseText);
          } catch (_) {
            return reject(new Error("Unexpected server response (" + r.status + ")"));
          }
          if (r.status >= 400 || !body.ok) {
            return reject(new Error(body && body.error ? body.error : "Server error " + r.status));
          }
          resolve(body.export);
        },
        onerror: () =>
          reject(new Error("Couldn't reach the Draft Day server — is it running, and is the connection code from this draft?")),
        ontimeout: () => reject(new Error("The Draft Day server timed out")),
      });
    });
  }

  // ---- form driving ----
  function currentTid() {
    const f = form();
    const tid = f && f.querySelector('input[name="tid"]');
    return tid ? tid.value : null;
  }

  function yahooTeams() {
    const f = form();
    if (!f) return [];
    return [...f.querySelectorAll('select[name="newtid"] option')].map((o) => ({
      tid: o.value,
      name: o.textContent.trim(),
    }));
  }

  async function switchToTeam(tid) {
    if (currentTid() === String(tid)) return;
    const sel = form().querySelector('select[name="newtid"]');
    sel.value = String(tid);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    const ok = await waitFor(() => currentTid() === String(tid), 12000, 150);
    if (!ok) throw new Error("Timed out switching to team " + tid);
    await sleep(250); // let the grid settle
  }

  // Set this team's hidden pick inputs. picks[round-1][pid] = pid. Clears every
  // slot first so re-running is idempotent (no leftovers from a prior attempt).
  function fillTeam(team) {
    const f = form();
    const slots = f.querySelectorAll('input[name^="picks"][name$="[pid]"]');
    slots.forEach((s) => {
      s.value = "0";
    });
    let set = 0;
    for (const p of team.picks) {
      const input = f.querySelector('input[name="picks[' + (p.round - 1) + '][pid]"]');
      if (input) {
        input.value = String(p.pid);
        set++;
      }
    }
    return set;
  }

  // Yahoo can pop a native alert/confirm mid-flow (e.g. a validation alert), which
  // blocks everything until a human clicks it and would stall the unattended
  // import. Neutralize them via unsafeWindow — that reaches the page's real
  // window from our sandbox without injecting an inline <script> (Yahoo's CSP
  // blocks inline scripts, same as it blocks bookmarklets). Auto-accepting is what
  // we want — the commissioner already chose to push these results.
  function installDialogGuard() {
    try {
      const w = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
      w.alert = function () {};
      w.confirm = function () {
        return true;
      };
      w.onbeforeunload = null;
    } catch (_) {
      /* best effort — if it's blocked the worst case is a manual dialog click */
    }
  }

  async function saveProgress() {
    const save = [...document.querySelectorAll("a, button")].find((b) =>
      /save progress/i.test((b.textContent || "").trim()),
    );
    if (!save) throw new Error('Could not find the "Save Progress" button');
    save.click();
    await sleep(1600); // let the AJAX save round-trip before we move on
  }

  // Match Yahoo's team dropdown to our exported teams: by name first, then by
  // position (the league was imported in this order, so order lines up).
  function buildPlan(exp, teams) {
    const byName = new Map(exp.teams.map((t) => [norm(t.name), t]));
    const plan = {};
    let nameMatches = 0;
    teams.forEach((opt, idx) => {
      let team = byName.get(norm(opt.name));
      if (team) nameMatches++;
      else team = exp.teams.find((t) => t.order === idx + 1) || null;
      if (team) plan[opt.tid] = team;
    });
    return { plan, nameMatches };
  }

  async function run(cfg, log) {
    installDialogGuard();
    log("Fetching draft results…");
    const exp = await fetchExport(cfg);
    log('Draft "' + exp.leagueName + '": ' + exp.teams.length + " teams, " + exp.rounds + " rounds.");
    if (!exp.complete) log("⚠️ Draft isn't marked complete — pushing what's there.");
    (exp.warnings || []).forEach((w) => log("⚠️ " + w));

    if (!form()) throw new Error('Open Yahoo\'s "Enter Draft Results" grid first (Submit Draft Results → Continue).');

    const teams = yahooTeams();
    if (teams.length === 0) throw new Error("No teams found on the page");
    const { plan, nameMatches } = buildPlan(exp, teams);
    if (nameMatches < teams.length) {
      log("ℹ️ Matched " + nameMatches + "/" + teams.length + " teams by name; the rest by draft order.");
    }

    let done = 0;
    for (const opt of teams) {
      const team = plan[opt.tid];
      if (!team) {
        log("• Skipping " + opt.name + " (no match)");
        continue;
      }
      log("→ " + opt.name + ": " + team.picks.length + " picks");
      await switchToTeam(opt.tid);
      fillTeam(team);
      await saveProgress();
      done++;
    }

    log("✅ Imported " + done + " team(s). Reloading to show the filled rosters…");
    await sleep(900);
    location.reload();
  }

  // ---- UI panel (CSP-safe: createElement + CSSOM styles, no innerHTML) ----
  function styled(tag, styles, props) {
    const el = document.createElement(tag);
    if (styles) Object.assign(el.style, styles);
    if (props) Object.assign(el, props);
    return el;
  }

  function mountPanel() {
    if (document.getElementById("ddb-panel")) return;

    const panel = styled("div", {
      position: "fixed",
      top: "12px",
      right: "12px",
      zIndex: "2147483647",
      width: "300px",
      background: "#10131a",
      color: "#e8eef6",
      border: "1px solid #2b3340",
      borderRadius: "12px",
      boxShadow: "0 10px 30px rgba(0,0,0,.45)",
      font: "13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif",
      padding: "12px",
    });
    panel.id = "ddb-panel";

    const title = styled("div", { fontWeight: "800", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" });
    title.appendChild(styled("span", null, { textContent: "🏈 Draft Day → Yahoo" }));
    const close = styled("span", { cursor: "pointer", opacity: ".6", padding: "0 4px" }, { textContent: "✕", title: "Hide" });
    close.addEventListener("click", () => panel.remove());
    title.appendChild(close);
    panel.appendChild(title);

    const help = styled("div", { opacity: ".75", fontSize: "12px", marginBottom: "8px" }, {
      textContent: "Paste the connection code from the Draft Day admin page, then import.",
    });
    panel.appendChild(help);

    const input = styled("textarea", {
      width: "100%",
      boxSizing: "border-box",
      height: "44px",
      resize: "vertical",
      fontFamily: "ui-monospace,Menlo,monospace",
      fontSize: "11px",
      padding: "6px",
      borderRadius: "8px",
      border: "1px solid #2b3340",
      background: "#0a0d12",
      color: "#e8eef6",
    }, { placeholder: "connection code…", value: GM_getValue(STORE_KEY, "") });
    panel.appendChild(input);

    const btn = styled("button", {
      width: "100%",
      marginTop: "8px",
      padding: "9px",
      borderRadius: "9px",
      border: "0",
      background: "#6d28d9",
      color: "#fff",
      fontWeight: "700",
      cursor: "pointer",
    }, { textContent: "Import picks" });
    panel.appendChild(btn);

    const logBox = styled("div", {
      marginTop: "10px",
      maxHeight: "200px",
      overflowY: "auto",
      fontSize: "12px",
      whiteSpace: "pre-wrap",
      borderTop: "1px solid #2b3340",
      paddingTop: "8px",
      display: "none",
    });
    panel.appendChild(logBox);

    const log = (msg) => {
      logBox.style.display = "block";
      logBox.appendChild(styled("div", { marginBottom: "3px" }, { textContent: msg }));
      logBox.scrollTop = logBox.scrollHeight;
    };

    btn.addEventListener("click", async () => {
      let cfg;
      try {
        cfg = JSON.parse(atob(input.value.trim()));
        if (!cfg.o || !cfg.c || !cfg.t) throw new Error();
      } catch (_) {
        log("❌ That doesn't look like a valid connection code.");
        return;
      }
      GM_setValue(STORE_KEY, input.value.trim());
      btn.disabled = true;
      btn.textContent = "Importing…";
      try {
        await run(cfg, log);
      } catch (err) {
        log("❌ " + (err && err.message ? err.message : String(err)));
        btn.disabled = false;
        btn.textContent = "Import picks";
      }
    });

    document.body.appendChild(panel);
  }

  // @match is host-wide (path globs in @match are a common failure point), so
  // gate to the offline-draft results page here. The panel only makes sense there.
  function boot() {
    if (!/editdraftresults/.test(location.pathname)) return;
    mountPanel();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
