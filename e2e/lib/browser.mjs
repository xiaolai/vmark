/**
 * Embedded-browser E2E helpers: feature gate, tab lifecycle, and state restoration.
 *
 * THE FEATURE IS OFF BY DEFAULT and these journeys must turn it on. That makes
 * state restoration a correctness requirement, not politeness: a journey that
 * leaves `browser.enabled` true has silently changed the user's configuration, and
 * a journey that leaves an AI tab open poisons the next journey's `session.get_state`.
 * `withBrowserEnabled()` therefore takes a full snapshot and restores it in a
 * `finally`, including on failure.
 *
 * HOW THE SETTING IS CHANGED: by writing `vmark-settings` and dispatching a
 * `storage` event. That is not a hack — it is the app's OWN cross-window settings
 * mechanism (`useSettingsSync.ts:128` listens for exactly this), so the running
 * store rehydrates through a supported path rather than needing a reload. A reload
 * would be far more disruptive and would race the journey's own tabs.
 *
 * @coordinates-with src/hooks/useSettingsSync.ts — the storage-event listener
 * @coordinates-with src/services/commands/browserCommands.ts — `browser.newTab`
 */

import { evalJs } from "./bridge.mjs";
import { poll } from "./vmark.mjs";

const SETTINGS_KEY = "vmark-settings";

/** Read the persisted `browser` settings section. */
export async function readBrowserSettings(client) {
  const raw = await evalJs(
    client,
    `(() => { try { return JSON.stringify(JSON.parse(localStorage.getItem(${JSON.stringify(SETTINGS_KEY)}) || "{}")?.state?.browser ?? null); } catch { return "null"; } })()`
  );
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Patch the `browser` settings section and notify the running app.
 *
 * Writes localStorage then dispatches the same `storage` event a second window
 * would produce, so `useSettingsSync` applies it to the live Zustand store.
 */
export async function patchBrowserSettings(client, patch) {
  const ok = await evalJs(
    client,
    `(() => {
       try {
         const key = ${JSON.stringify(SETTINGS_KEY)};
         const oldValue = localStorage.getItem(key);
         const parsed = JSON.parse(oldValue || "{}");
         parsed.state = parsed.state || {};
         parsed.state.browser = { ...(parsed.state.browser || {}), ...${JSON.stringify(patch)} };
         const newValue = JSON.stringify(parsed);
         localStorage.setItem(key, newValue);
         // The app's own cross-window sync path (useSettingsSync.ts).
         window.dispatchEvent(new StorageEvent("storage", { key, oldValue, newValue, storageArea: localStorage }));
         return true;
       } catch (e) { return "ERR " + (e && e.message); }
     })()`
  );
  if (ok !== true) throw new Error(`failed to patch browser settings: ${ok}`);
}

/**
 * Run `fn` with the embedded browser enabled, restoring EVERY setting touched.
 *
 * @param {object} client   Tauri bridge client
 * @param {object} opts     `{ allowLoopback }` — fixture journeys serve from
 *                          127.0.0.1, which the AI navigation policy refuses unless
 *                          loopback is explicitly opted in. The SSRF journey
 *                          deliberately runs with it OFF.
 */
export async function withBrowserEnabled(client, opts, fn) {
  const before = (await readBrowserSettings(client)) ?? {};
  const snapshot = {
    enabled: before.enabled ?? false,
    aiSession: before.aiSession ?? "sandbox",
    aiAllowLoopback: before.aiAllowLoopback ?? false,
  };
  await patchBrowserSettings(client, {
    enabled: true,
    ...(opts?.allowLoopback === undefined ? {} : { aiAllowLoopback: opts.allowLoopback }),
    ...(opts?.aiSession === undefined ? {} : { aiSession: opts.aiSession }),
  });
  try {
    return await fn();
  } finally {
    // Restore the EXACT prior values — not "false". The user may legitimately have
    // had the feature on, and a journey must not turn it off behind them.
    await patchBrowserSettings(client, snapshot).catch(() => {});
  }
}

/** Browser tabs currently open, from the app's own tab store view in the DOM. */
export async function listBrowserTabs(client) {
  const raw = await evalJs(
    client,
    `(() => {
       const els = Array.from(document.querySelectorAll('[data-tab-id]'));
       return JSON.stringify(els.map((el) => ({
         id: el.getAttribute('data-tab-id'),
         kind: el.getAttribute('data-tab-kind') || null,
         title: (el.textContent || '').trim().slice(0, 60),
       })));
     })()`
  );
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * Is a native browser view attached to this window?
 *
 * The native `WKWebView` is a SIBLING of the Tauri webview, so it never appears in
 * a DOM snapshot — which is exactly why "the DOM tab is gone" proves nothing about
 * teardown. The browser surface element is the DOM stand-in the app positions the
 * native view against; its presence/absence is the closest in-webview proxy, and
 * journeys that need real proof pair it with a native screenshot.
 */
export async function browserSurfaceCount(client) {
  return evalJs(
    client,
    `document.querySelectorAll('.browser-surface, [data-browser-surface]').length`
  );
}

/** Wait until the browser tab count reaches `expected`, or throw. */
export async function waitForBrowserTabs(client, expected, timeoutMs = 8000) {
  await poll(
    async () => (await listBrowserTabs(client)).filter((t) => t.kind === "browser").length,
    (n) => n === expected,
    `browser tab count = ${expected}`,
    { timeoutMs }
  );
}
