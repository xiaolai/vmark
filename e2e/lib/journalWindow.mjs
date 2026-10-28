/**
 * A secondary document window for the agent-journal page journeys: open it
 * on a fixture file, drive the app's own MCP bridge INSIDE it, watch the IPC
 * its page makes, reload it, read the journal, and close it.
 *
 * Why a secondary window: the runner stamps the main webview, and reloading
 * main would fail every later journey. A document window opened by
 * `open_workspace_in_new_window` can be reloaded freely and closed after.
 *
 * Why the bridge is driven from inside the window: the MCP sidecar routes a
 * tab-only request to the FOCUSED document window, and a headless run cannot
 * promise native focus. A request emitted with `emitTo(<own label>)` reaches
 * exactly that window's bridge listener (the listener is window-scoped), and
 * runs the same handler an AI client's request does.
 *
 * Why `fetch`: tauri's `__TAURI_INTERNALS__.invoke` cannot be patched, but
 * its IPC transport calls the global `fetch` with `ipc://localhost/<command>`
 * per call. The probe wraps `fetch` to count calls by command, keep each
 * `mcp_bridge_respond` reply by request id (the bridge's answer goes to Rust,
 * not to the caller), and optionally HOLD a command: its fetch returns a
 * promise that never settles, so the call never reaches Rust and never falls
 * back to `postMessage`. The wrapper never rejects — a rejected IPC fetch
 * switches the page to the `postMessage` transport for good.
 *
 * Every eval stays short (the bridge's script timeout is a few seconds):
 * page-side promises run through `settle`, and waits are polled from Node.
 */

import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { evalJs, listWindows } from "./bridge.mjs";
import { makeAppTempDir } from "./fixtures.mjs";
import { DRIVABLE_SNIPPET, drivableGap } from "./readiness.mjs";
import { BOUND_INVOKE_SNIPPET } from "./journalCall.mjs";

/** Run `script` in `label`'s webview; its evaluated value. */
export async function inWindow(client, label, script, timeoutMs = 15000) {
  const r = await client.send("execute_js", { windowLabel: label, script }, timeoutMs);
  if (r?.success !== true) throw new Error(`execute_js in ${label} failed: ${r?.error ?? JSON.stringify(r)}`);
  return r.data;
}

export async function pollUntil(what, predicate, timeoutMs = 30_000, stepMs = 200) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

let settleSeq = 0;

/**
 * Evaluate the promise expression `expr` in `label`'s page without awaiting
 * it inside the eval (an eval that waits past the bridge's script timeout
 * fails even when the work succeeds): start it, then poll for its outcome.
 * Its resolved value, which must be JSON; a rejection throws.
 */
export async function settle(client, label, expr, what, timeoutMs = 30_000) {
  const key = JSON.stringify(`__vmarkE2ESettle${++settleSeq}`);
  await inWindow(
    client,
    label,
    `(() => {
       window[${key}] = null;
       Promise.resolve()
         .then(() => ${expr})
         .then(
           (v) => { window[${key}] = { ok: true, v: v ?? null }; },
           (e) => { window[${key}] = { ok: false, e: e && e.message ? e.message : JSON.stringify(e) }; },
         );
       return true;
     })()`,
    5000,
  );
  let outcome = null;
  await pollUntil(what, async () => {
    outcome = await inWindow(client, label, `window[${key}]`, 5000);
    return outcome !== null;
  }, timeoutMs);
  await inWindow(client, label, `(() => { delete window[${key}]; return true; })()`, 5000).catch(() => {});
  if (!outcome.ok) throw new Error(`${what} failed: ${outcome.e}`);
  return outcome.v;
}

/** Wait until `label`'s listeners are registered. An eval that fails mid-navigation counts as not ready. */
export async function waitDrivable(client, label, timeoutMs = 60_000) {
  let gap = "never probed";
  await pollUntil(
    `${label} to be drivable (${gap})`,
    async () => {
      try {
        gap = drivableGap(await inWindow(client, label, DRIVABLE_SNIPPET, 5000));
      } catch (e) {
        gap = e instanceof Error ? e.message : String(e);
      }
      return gap === null;
    },
    timeoutMs,
    250,
  );
}

/** The window's one document tab id. */
export async function fileTab(client, label) {
  let ids = [];
  await pollUntil(`${label} to show exactly one document tab`, async () => {
    ids = await inWindow(client, label, `[...document.querySelectorAll("[data-tab-id]")].map((e) => e.getAttribute("data-tab-id"))`, 5000);
    return Array.isArray(ids) && ids.length === 1;
  });
  return ids[0];
}

/** Install the IPC probe in the current page (a reload removes it). `hold`: commands whose IPC never settles. */
export async function installProbe(client, label, { hold = [] } = {}) {
  const r = await inWindow(
    client,
    label,
    `(() => {
       if (window.__vmarkE2E) return "ALREADY";
       const state = { ipc: {}, replies: {}, hold: new Set(${JSON.stringify(hold)}) };
       const original = window.fetch.bind(window);
       window.fetch = (input, init) => {
         const url = typeof input === "string" ? input : input && input.url;
         const m = typeof url === "string" ? /^ipc:\\/\\/localhost\\/([^?#]+)/.exec(url) : null;
         if (m) {
           const cmd = decodeURIComponent(m[1]);
           state.ipc[cmd] = (state.ipc[cmd] || 0) + 1;
           if (cmd === "mcp_bridge_respond" && init && typeof init.body === "string") {
             try { const b = JSON.parse(init.body); const p = b.payload ?? b; if (p && p.id) state.replies[p.id] = p; } catch {}
           }
           if (state.hold.has(cmd)) return new Promise(() => {});
         }
         return original(input, init);
       };
       window.__vmarkE2E = state;
       return "OK";
     })()`,
    5000,
  );
  if (r !== "OK") throw new Error(`the IPC probe in ${label} answered ${JSON.stringify(r)}`);
}

/** A copy of the probe's per-command IPC counts. */
export async function ipcCounts(client, label) {
  const counts = await inWindow(client, label, `(window.__vmarkE2E ? { ...window.__vmarkE2E.ipc } : null)`, 5000);
  if (!counts || typeof counts !== "object") throw new Error(`no IPC probe in ${label}`);
  return counts;
}

let requestSeq = 0;

/** Fire one bridge request at `label` from inside it; its request id. The reply is collected by the probe. */
export async function fireRequest(client, label, type, args) {
  const id = `e2e-journal-${Date.now()}-${++requestSeq}`;
  const payload = {
    id,
    type,
    args_json: JSON.stringify(args ?? {}),
    attribution: { principal: { kind: "anonymous" }, connectionId: randomUUID(), sessionLabel: null, displayName: "e2e-journey" },
  };
  await settle(
    client,
    label,
    `window.__TAURI__.event.emitTo(${JSON.stringify(label)}, "mcp-bridge:request", ${JSON.stringify(payload)})`,
    `emitting ${type} to ${label}`,
  );
  return id;
}

/** The probe's reply for `id`, waiting up to `timeoutMs`. */
export async function replyTo(client, label, id, timeoutMs = 30_000) {
  let reply = null;
  await pollUntil(`the reply to ${id} in ${label}`, async () => {
    reply = await inWindow(client, label, `(window.__vmarkE2E && window.__vmarkE2E.replies[${JSON.stringify(id)}]) || null`, 5000);
    return reply !== null;
  }, timeoutMs);
  return reply;
}

/** One request, answered: its `data`. A refusal throws with the bridge's error. */
export async function bridgeOk(client, label, type, args, timeoutMs) {
  const reply = await replyTo(client, label, await fireRequest(client, label, type, args), timeoutMs);
  if (reply.success !== true) throw new Error(`${type} in ${label} was refused: ${String(reply.error).slice(0, 300)}`);
  return reply.data;
}

/** Read `tabId`, then write `content` at the revision it returned; the write's reply data. */
export async function writeDocument(client, label, tabId, content) {
  const read = await bridgeOk(client, label, "vmark.document.read", { tabId });
  return bridgeOk(client, label, "vmark.document.write", { tabId, content, expected_revision: read.revision });
}

/**
 * Reload `label` with `reloadScript` and wait until the NEW page is drivable.
 * A marker on the old page proves the page was replaced, not just still ready.
 */
export async function reloadWindow(client, label, reloadScript) {
  await inWindow(client, label, `(() => { window.__vmarkE2EOldPage = true; return true; })()`, 5000);
  await inWindow(client, label, reloadScript, 5000);
  await pollUntil(`${label} to leave its old page`, async () => {
    try {
      return (await inWindow(client, label, `window.__vmarkE2EOldPage === true`, 5000)) !== true;
    } catch {
      return false;
    }
  });
  await waitDrivable(client, label);
}

/** The journal's record of `filePath`, read over IPC from the main window (never reloaded). */
export async function journalOf(client, filePath) {
  const payload = JSON.stringify({ docKey: `path:${filePath}` });
  const r = await settle(
    client,
    "main",
    `(async () => {${BOUND_INVOKE_SNIPPET}
       const h = await boundInvoke("agent_journal_history", { payload: ${JSON.stringify(payload)} });
       const u = await boundInvoke("agent_journal_uncommitted", { payload: ${JSON.stringify(payload)} });
       return { rows: h.rows, uncommitted: u };
     })()`,
    `reading the journal of ${filePath}`,
  );
  if (!Array.isArray(r?.rows) || !Array.isArray(r?.uncommitted)) throw new Error(`malformed journal reply for ${filePath}`);
  return {
    writes: r.rows.filter((row) => row.kind === "controlled" && row.tool === "document.write"),
    uncommitted: r.uncommitted,
  };
}

/** Discard an uncommitted entry the journey created, so the dev journal does not keep it. */
export async function discardUncommitted(client, filePath, txn) {
  const payload = JSON.stringify({ docKey: `path:${filePath}`, txn });
  await settle(
    client,
    "main",
    `(async () => {${BOUND_INVOKE_SNIPPET}
       return boundInvoke("agent_journal_discard", { payload: ${JSON.stringify(payload)} });
     })()`,
    `discarding ${txn}`,
  );
}

/**
 * Open a document window on a fresh fixture file under $HOME, drivable, with
 * its tab found and one warm-up read answered (an idle background webview
 * can be throttled for seconds; the warm-up absorbs that before any step that
 * runs under a deadline). Always pair with `closeJournalWindow` in a finally.
 */
export async function openJournalWindow(client, ctx, text = "# journal\n\nstart\n") {
  const fixture = await makeAppTempDir();
  const filePath = join(fixture.dir, `journal-${fixture.stamp}.md`);
  await writeFile(filePath, text, "utf8");
  const before = new Set((await listWindows(client)).map((w) => w.label));
  let label;
  try {
    label = await settle(
      client,
      "main",
      `window.__TAURI__.core.invoke("open_workspace_in_new_window", ${JSON.stringify({ workspaceRoot: fixture.dir, filePath })})`,
      "open_workspace_in_new_window",
      60_000,
    );
    if (typeof label !== "string") throw new Error(`open_workspace_in_new_window answered ${JSON.stringify(label)}`);
  } catch (e) {
    await fixture.cleanup();
    throw e;
  }
  const win = { label, filePath, workspace: fixture.dir, cleanup: fixture.cleanup };
  try {
    await pollUntil(`${label} to be listed`, async () =>
      (await listWindows(client)).some((w) => w.label === label && !before.has(w.label)),
    );
    await waitDrivable(client, label);
    win.tabId = await fileTab(client, label);
    await installProbe(client, label);
    await bridgeOk(client, label, "vmark.document.read", { tabId: win.tabId }, 60_000);
    ctx.log(`journal window ${label} on ${filePath}`);
    return win;
  } catch (e) {
    await closeJournalWindow(client, win).catch(() => {});
    throw e;
  }
}

/** Close the window from within (the only way the app allows), forget its recent workspace, remove the fixture. */
export async function closeJournalWindow(client, win) {
  try {
    await client.send(
      "execute_js",
      { windowLabel: win.label, script: `(() => { void window.__TAURI__.core.invoke("close_window"); return true; })()` },
      15000,
    );
    await pollUntil(`${win.label} to close`, async () => !(await listWindows(client)).some((w) => w.label === win.label));
  } finally {
    await evalJs(
      client,
      `(() => { const f = window.__VMARK_DEBUG__ && window.__VMARK_DEBUG__.forgetRecentWorkspace;
         if (typeof f === "function") f(${JSON.stringify(win.workspace)}); return "OK"; })()`,
    ).catch(() => {});
    await win.cleanup();
  }
}

/** From now on, hold every IPC call of `command` in `label`'s current page. */
export async function holdCommand(client, label, command) {
  const r = await inWindow(client, label, `(window.__vmarkE2E ? (window.__vmarkE2E.hold.add(${JSON.stringify(command)}), "OK") : "NO PROBE")`, 5000);
  if (r !== "OK") throw new Error(`could not hold ${command} in ${label}: ${r}`);
}
