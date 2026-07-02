/**
 * VMark app-level helpers for the E2E journey suite.
 *
 * Everything here drives the LIVE app through mechanisms the app itself
 * exposes, discovered and verified against the running debug build:
 *
 *  - DOM observation: the tab bar renders `[role="tab"][data-tab-id]` with
 *    `.tab-title`, `aria-selected`, and `.tab-dirty-dot` (src/components/Tabs/Tab.tsx).
 *  - Menu commands: `window.__TAURI__.event.emit("menu:<id>", "<windowLabel>")`.
 *    Frontend listeners (useUnifiedMenuCommands, services/commands/menuListener)
 *    filter on payload === windowLabel, and broadcast emit() reaches
 *    window-scoped listeners (verified live).
 *  - App automation surface: `emit("mcp-bridge:request", {id, type, args_json})`
 *    drives the app's own v2 MCP tool handlers (src/hooks/mcpBridge/v2/) —
 *    workspace.new / workspace.close / workspace.switch_tab. Responses go to
 *    Rust (`__TAURI_INTERNALS__.invoke` is non-writable, so they cannot be
 *    intercepted); all effects are asserted via the DOM instead.
 *  - Typing: `document.execCommand("insertText")` on the focused ProseMirror
 *    contenteditable — the same beforeinput/input path a real keystroke takes.
 *
 * SAFETY MODEL (see e2e/README.md):
 *  - Never type into or clear a pre-existing tab. All edits happen in tabs the
 *    journey created itself (tracked by data-tab-id).
 *  - `workspace.close` takes an explicit tabId — it cannot close the wrong tab.
 *  - `force: true` (discard dirty) is only ever used on journey-created tabs.
 *  - No native dialogs are ever triggered (they would block the app).
 */

import { evalJs } from "./bridge.mjs";

const DEFAULT_TIMEOUT_MS = 15000;

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

/**
 * Poll `fn` until `predicate(value)` is true. Throws with the last observed
 * value on timeout. This is the ONLY wait primitive journeys should use —
 * no bare sleeps.
 */
export async function poll(fn, predicate, label, { timeoutMs = 8000, intervalMs = 150 } = {}) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (predicate(value)) return value;
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Timed out waiting for: ${label} — last observed: ${JSON.stringify(value)?.slice(0, 300)}`
      );
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// ---------------------------------------------------------------------------
// Event emission
// ---------------------------------------------------------------------------

/** Emit a Tauri event from inside the webview (broadcast). */
export function emitEvent(client, event, payload, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return evalJs(
    client,
    `window.__TAURI__.event.emit(${JSON.stringify(event)}, ${JSON.stringify(payload)}).then(() => true)`,
    timeoutMs
  );
}

/**
 * Fire a menu command exactly as the native menu would (`menu:<id>` with the
 * target window label as payload).
 */
export function emitMenu(client, menuId, windowLabel = "main") {
  return emitEvent(client, `menu:${menuId}`, windowLabel);
}

let mcpSeq = 0;
/**
 * Fire a request at the app's own v2 MCP bridge surface. Fire-and-observe:
 * the response goes to Rust, so callers must assert effects via the DOM.
 */
export function mcpFire(client, type, args) {
  const payload = {
    id: `e2e-journey-${Date.now()}-${++mcpSeq}`,
    type,
    args_json: JSON.stringify(args ?? {}),
  };
  return emitEvent(client, "mcp-bridge:request", payload);
}

// ---------------------------------------------------------------------------
// Tab-bar observation
// ---------------------------------------------------------------------------

const TABS_SNIPPET = `[...document.querySelectorAll('[role="tab"][data-tab-id]')].map((el) => ({
  id: el.getAttribute("data-tab-id"),
  title: el.querySelector(".tab-title")?.textContent ?? null,
  selected: el.getAttribute("aria-selected") === "true",
  dirty: !!el.querySelector(".tab-dirty-dot"),
}))`;

/** Snapshot the tab bar: [{id, title, selected, dirty}]. */
export function getTabs(client) {
  return evalJs(client, `(() => (${TABS_SNIPPET}))()`);
}

/** The currently selected tab (or null). */
export async function getActiveTab(client) {
  const tabs = await getTabs(client);
  return tabs.find((t) => t.selected) ?? null;
}

// ---------------------------------------------------------------------------
// Editor-instance binding (remount detection)
// ---------------------------------------------------------------------------
//
// The tab bar updates BEFORE the editor swaps to the new tab's document
// (Editor.tsx remounts the surface keyed by tabId). Acting on the editor as
// soon as the tab bar shows the new tab races the remount and can type into
// the PREVIOUS tab's document. To close that race we tag the current
// `.ProseMirror` DOM node with an expando before any action that remounts the
// editor, then wait until an UNTAGGED (fresh) instance is mounted.

/** Tag the currently mounted editor instance as stale. */
function markEditorInstanceStale(client) {
  return evalJs(
    client,
    `(() => {
       const el = document.querySelector('.ProseMirror');
       if (el) el.__e2eStaleInstance = true;
       return !!el;
     })()`
  );
}

/**
 * Wait until the visible editor is a FRESH instance (not the tagged one).
 * A CodeMirror surface (split-pane / source formats) also counts as rebound.
 */
function waitForEditorRebind(client, label) {
  return poll(
    () =>
      evalJs(
        client,
        `(() => {
           const pm = document.querySelector('.ProseMirror');
           if (pm) return pm.__e2eStaleInstance ? 'stale' : 'fresh';
           return document.querySelector('.cm-editor') ? 'fresh' : 'none';
         })()`
      ),
    (v) => v === "fresh",
    label
  );
}

// ---------------------------------------------------------------------------
// Tab lifecycle (journey-scoped scratch tabs)
// ---------------------------------------------------------------------------

/**
 * Create a fresh untitled scratch tab via the app's `vmark.workspace.new`
 * handler; wait for it to appear in the tab bar, become active, AND for the
 * editor to remount onto the new (empty) document — only then is it safe to
 * type. Returns the new tab {id, title, selected, dirty}.
 */
export async function createScratchTab(client) {
  const before = await getTabs(client);
  const beforeIds = new Set(before.map((t) => t.id));
  await markEditorInstanceStale(client);
  await mcpFire(client, "vmark.workspace.new", {});
  const after = await poll(
    () => getTabs(client),
    (tabs) => tabs.length === before.length + 1,
    "scratch tab to appear"
  );
  const scratch = after.find((t) => !beforeIds.has(t.id));
  if (!scratch) throw new Error("scratch tab not identified in tab bar");
  try {
    if (!scratch.title?.startsWith("Untitled")) {
      throw new Error(`scratch tab has unexpected title: ${scratch.title}`);
    }
    if (!scratch.selected) {
      await switchToTab(client, scratch.id);
    } else {
      await waitForEditorRebind(client, "editor to rebind to the new scratch tab");
    }
    // The scratch document must present as VERIFIABLY empty before anyone
    // types into it. Require an actual (empty) string: getEditorText returns
    // null when no WYSIWYG surface is mounted (e.g. Source mode), and null
    // must NOT pass as "empty" — the document state would be unknown.
    await poll(
      () => getEditorText(client),
      (t) => typeof t === "string" && t.trim() === "",
      "scratch tab's WYSIWYG editor to be mounted and empty"
    );
    return scratch;
  } catch (err) {
    // Atomic: never leak a half-initialized scratch tab the caller couldn't track.
    try {
      await closeTabById(client, scratch.id, { force: true });
    } catch {
      /* best effort — the journey error below is the primary signal */
    }
    throw err;
  }
}

/**
 * Activate a tab by id via `vmark.workspace.switch_tab`; wait for the tab-bar
 * marker AND the editor remount, so callers can immediately act on the
 * switched-to document.
 */
export async function switchToTab(client, tabId) {
  const tabs = await getTabs(client);
  if (tabs.find((t) => t.id === tabId)?.selected) return; // already active
  await markEditorInstanceStale(client);
  await mcpFire(client, "vmark.workspace.switch_tab", { tabId });
  await poll(
    () => getTabs(client),
    (ts) => ts.find((t) => t.id === tabId)?.selected === true,
    `tab ${tabId} to become active`
  );
  await waitForEditorRebind(client, `editor to rebind to tab ${tabId}`);
}

/**
 * Close a tab BY ID via `vmark.workspace.close` and wait for it to leave the
 * tab bar. `force: true` discards dirty content — callers must only force
 * tabs the journey itself created and filled. No dialog is ever shown.
 */
export async function closeTabById(client, tabId, { force = false } = {}) {
  const tabs = await getTabs(client);
  if (!tabs.some((t) => t.id === tabId)) return; // already gone
  await mcpFire(client, "vmark.workspace.close", { tabId, force });
  await poll(
    () => getTabs(client),
    (ts) => !ts.some((t) => t.id === tabId),
    `tab ${tabId} to close`
  );
}

/**
 * Run `fn` with automatic teardown: every tab created during the journey is
 * force-closed (by id), and the originally active tab is re-activated.
 * Finally asserts the tab bar matches the initial snapshot and throws if the
 * journey leaked state.
 */
export async function withTabRestore(client, fn) {
  const before = await getTabs(client);
  const beforeIds = new Set(before.map((t) => t.id));
  const created = [];
  const track = (tabId) => {
    if (!beforeIds.has(tabId)) created.push(tabId);
    return tabId;
  };
  const originalActive = before.find((t) => t.selected) ?? null;

  let journeyError = null;
  try {
    await fn({ before, track });
  } catch (err) {
    journeyError = err;
  }

  // Settle before closing: the WYSIWYG surface serializes editor → document
  // store on an adaptive debounce (>=100ms). Closing a tab with a pending
  // flush makes the unmount-flush write into whichever tab becomes active
  // next (the cross-tab content-bleed bug — see e2e/README.md). Give the
  // last transaction's flush time to land while its own tab is still active.
  if (created.length > 0) {
    await new Promise((r) => setTimeout(r, 400));
  }

  // Teardown — close ONLY tabs this journey created, newest first.
  for (const tabId of created.reverse()) {
    try {
      await closeTabById(client, tabId, { force: true });
    } catch (err) {
      journeyError ??= new Error(`teardown failed for tab ${tabId}: ${err.message}`);
    }
  }
  if (originalActive) {
    try {
      const now = await getTabs(client);
      if (now.some((t) => t.id === originalActive.id) && !now.find((t) => t.id === originalActive.id).selected) {
        await switchToTab(client, originalActive.id);
      }
    } catch (err) {
      journeyError ??= new Error(`failed to restore active tab: ${err.message}`);
    }
  }

  if (journeyError) throw journeyError;

  const after = await getTabs(client);
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    throw new Error(
      `journey leaked tab state.\n  before: ${JSON.stringify(before)}\n  after:  ${JSON.stringify(after)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Editor interaction
// ---------------------------------------------------------------------------

/** Text content of the visible WYSIWYG editor. */
export function getEditorText(client) {
  return evalJs(client, `document.querySelector('.ProseMirror')?.textContent ?? null`);
}

/**
 * Type text into the ACTIVE editor at the end of the document via
 * execCommand("insertText") — real beforeinput/input events.
 *
 * - `mustBeEmpty`: refuse to type unless the document is empty (the safety
 *   check that proves we are in a fresh scratch tab).
 * - `waitForDirty` (default true): after typing, wait until the ACTIVE tab
 *   shows the dirty dot. The WYSIWYG surface syncs editor → documentStore on
 *   a debounce, and that flush targets the tab that is active AT FLUSH TIME —
 *   creating/switching tabs before the flush lands moves the typed content
 *   into the WRONG tab's document (observed live; reported as an app bug).
 *   Waiting for the dirty dot proves the sync landed before we move on.
 */
export async function typeInActiveEditor(
  client,
  text,
  { mustBeEmpty = false, waitForDirty = true } = {}
) {
  const result = await evalJs(
    client,
    `(() => {
       const el = document.querySelector('.ProseMirror');
       if (!el) return { ok: false, reason: 'no .ProseMirror editor' };
       if (el.__e2eStaleInstance) {
         return { ok: false, reason: 'editor instance is stale (pre-switch tab still mounted)' };
       }
       const pre = (el.textContent || '').trim();
       if (${JSON.stringify(mustBeEmpty)} && pre !== '') {
         return { ok: false, reason: 'editor not empty: ' + pre.slice(0, 60) };
       }
       el.focus();
       const sel = window.getSelection();
       if (!sel) return { ok: false, reason: 'window.getSelection() returned null' };
       sel.selectAllChildren(el);
       sel.collapseToEnd();
       document.execCommand('insertText', false, ${JSON.stringify(text)});
       return { ok: true, text: el.textContent || '' };
     })()`
  );
  if (!result?.ok) throw new Error(`typeInActiveEditor failed: ${result?.reason}`);
  if (waitForDirty) {
    await poll(
      () => getActiveTab(client),
      (tab) => tab?.dirty === true,
      "typed content to sync into the active tab's document (dirty dot)"
    );
  }
  return result.text;
}

/** Select the first occurrence of `needle` in the active WYSIWYG editor. */
export async function selectTextInEditor(client, needle) {
  const ok = await evalJs(
    client,
    `(() => {
       const el = document.querySelector('.ProseMirror');
       if (!el) return false;
       el.focus();
       const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
       let node;
       while ((node = walker.nextNode())) {
         const i = node.data.indexOf(${JSON.stringify(needle)});
         if (i >= 0) {
           const r = document.createRange();
           r.setStart(node, i);
           r.setEnd(node, i + ${JSON.stringify(needle)}.length);
           const sel = window.getSelection();
           sel.removeAllRanges();
           sel.addRange(r);
           return true;
         }
       }
       return false;
     })()`
  );
  if (!ok) throw new Error(`selectTextInEditor: "${needle}" not found in editor`);
}

/** Which editor surface is visible: "wysiwyg" | "source" | "none". */
export function getEditorMode(client) {
  return evalJs(
    client,
    `(() => {
       const cm = !!document.querySelector('.cm-editor');
       const pm = !!document.querySelector('.ProseMirror');
       return cm ? 'source' : pm ? 'wysiwyg' : 'none';
     })()`
  );
}

/** Ensure the window is in WYSIWYG mode (used in teardown after mode tests). */
export async function ensureWysiwygMode(client, windowLabel = "main") {
  const mode = await getEditorMode(client);
  if (mode === "wysiwyg") return;
  if (mode !== "source") {
    // "none" means NO editor surface is mounted at all — toggling source-mode
    // from that state would flip an unrelated setting and mask the real
    // failure (a missing editor). Fail loudly instead.
    throw new Error(`ensureWysiwygMode: no editor surface to restore from (mode: ${mode})`);
  }
  await emitMenu(client, "source-mode", windowLabel);
  await poll(() => getEditorMode(client), (m) => m === "wysiwyg", "WYSIWYG mode restored");
}

// ---------------------------------------------------------------------------
// Persisted-state helpers (localStorage inside the webview)
// ---------------------------------------------------------------------------

/** Raw localStorage value (string | null). */
export function readLocalStorage(client, key) {
  return evalJs(client, `localStorage.getItem(${JSON.stringify(key)})`);
}

/** Restore a localStorage key to a previously captured raw value. */
export function restoreLocalStorage(client, key, rawValue) {
  if (rawValue === null) {
    return evalJs(client, `(localStorage.removeItem(${JSON.stringify(key)}), true)`);
  }
  return evalJs(
    client,
    `(localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(rawValue)}), true)`
  );
}

/**
 * The persisted workspace root of the main window (null = no workspace).
 * Used as a safety gate by disk journeys: opening a file from outside an
 * open workspace would spawn a new window (finderOpenBranch "newWindow").
 */
export async function getPersistedWorkspaceRoot(client, windowLabel = "main") {
  return evalJs(
    client,
    `(() => {
       try {
         const raw = localStorage.getItem('vmark-workspace:' + ${JSON.stringify(windowLabel)});
         return raw ? (JSON.parse(raw)?.state?.rootPath ?? null) : null;
       } catch { return null; }
     })()`
  );
}
