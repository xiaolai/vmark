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
import {
  patchPersistedSettings,
  readPersistedSettingsSection,
} from "./settingsPatch.mjs";

/** Read the persisted `browser` settings section. */
export async function readBrowserSettings(client) {
  return readPersistedSettingsSection(client, "browser");
}

/**
 * Patch the `browser` settings section and notify the running app.
 *
 * Writes localStorage then dispatches the same `storage` event a second window
 * would produce, so `useSettingsSync` applies it to the live Zustand store.
 */
export async function patchBrowserSettings(client, patch) {
  // Shared writer (audit 20260831 #45) — see settingsPatch.mjs.
  await patchPersistedSettings(client, "browser", patch);
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
  // Native tabs that existed BEFORE this journey. Anything not in this set at
  // teardown was created by the journey and is ours to dispose — see the finally.
  // NOT caught. [Audit Medium] Swallowing this into `null` silently disabled
  // identity-based cleanup and then made teardown poll an unavailable command for
  // 20s — while the helper's own docs claimed a release build fails immediately.
  // Fail here, before any setting is changed or the journey body runs.
  const preexistingNativeTabs = await nativeBrowserTabIds(client);
  await patchBrowserSettings(client, {
    enabled: true,
    ...(opts?.allowLoopback === undefined ? {} : { aiAllowLoopback: opts.allowLoopback }),
    ...(opts?.aiSession === undefined ? {} : { aiSession: opts.aiSession }),
  });
  let failed = false;
  try {
    return await fn();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    // Restore the EXACT prior values — not "false". The user may legitimately have
    // had the feature on, and a journey must not turn it off behind them.
    await patchBrowserSettings(client, snapshot).catch(() => {});

    // Dispose the tabs THIS journey created, by identity, regardless of whether the
    // feature ended up on or off.
    //
    // Relying on the toggle was a real gap: when the browser was ALREADY enabled,
    // restoring the snapshot does not disable it, so nothing disposed the journey's
    // tabs and they leaked into the next one. That path is invisible on a machine
    // where the feature is off by default — which is exactly why it survived. The
    // fix is to own what we created rather than to lean on a side effect of the
    // toggle.
    if (preexistingNativeTabs) {
      const leaked = (await nativeBrowserTabIds(client).catch(() => [])).filter(
        (id) => !preexistingNativeTabs.includes(id)
      );
      for (const id of leaked) {
        await invokeBrowserCommand(client, "browser_destroy", id).catch(() => {});
      }
    }

    // Then wait for disposal to actually COMPLETE. It is asynchronous, and
    // returning early leaves the next journey computing its baseline while views
    // are still being torn down underneath it — `browser-tab-lifecycle` passed
    // alone and failed in sequence for exactly that reason. A suite that only
    // works in isolation is not a suite.
    const teardownErrors = [];
    await poll(
      () => nativeBrowserTabIds(client).then((ids) => ids.length),
      (n) => n === (preexistingNativeTabs?.length ?? 0),
      "native browser views disposed",
      { timeoutMs: 20000 },
    ).catch((e) => teardownErrors.push(String(e?.message ?? e)));

    // Surface teardown failures instead of swallowing them. A journey that leaves
    // the app dirty is not a pass — but never mask the journey's OWN error, which
    // is the more informative one, so only throw when it succeeded.
    if (teardownErrors.length && !failed) {
      throw new Error(`journey passed but teardown failed: ${teardownErrors.join("; ")}`);
    }
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
 * Tab ids holding a LIVE NATIVE webview, straight from the app's own map.
 *
 * This is the real teardown oracle. `browserSurfaceCount` below reads the React
 * surface element, which is a DOM stand-in — removing it while leaking the sibling
 * `WKWebView` looks identical, and an audit correctly flagged the DOM check as a
 * false oracle for B11. `browser_debug_native_tab_ids` is a debug-only Tauri
 * command that enumerates the native map itself, so "the native view is gone" is
 * observable rather than inferred.
 *
 * Throws against a release build, where the command is compiled out — better than
 * silently degrading to the weaker check.
 */
export async function nativeBrowserTabIds(client) {
  const raw = await evalJs(
    client,
    `(async () => {
       try {
         const ids = await window.__TAURI__.core.invoke('browser_debug_native_tab_ids');
         return JSON.stringify(ids);
       } catch (e) { return "ERR " + (e && e.message ? e.message : String(e)); }
     })()`
  );
  if (typeof raw === "string" && raw.startsWith("ERR ")) {
    throw new Error(
      `browser_debug_native_tab_ids unavailable (${raw}) — this needs a DEBUG build; ` +
        "a release build compiles the probe out."
    );
  }
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * Is a native browser view attached to this window?
 *
 * DOM proxy — prefer `nativeBrowserTabIds` for teardown assertions. Kept for
 * "has the surface appeared yet" waits, where the DOM element is the thing being
 * waited on.
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

/**
 * Create a HUMAN browser tab through the app's own command dispatch (WI-4.0).
 *
 * This goes through `executeCommand("browser.newTab")` — the exact function the
 * native menu route calls (`menuListener.ts`) — so a journey exercises the real
 * path rather than a shortcut past it.
 *
 * It needs the DEV-only `__VMARK_DEBUG__.runCommand` seam because nothing else
 * reaches the app: the debug bridge exposes only execute_js, a Tauri event
 * emitted inside the webview never arrives at the app's own listeners (confirmed
 * with a non-browser control event), and synthetic key events never reach the
 * keybinding layer. Against a non-DEV build the seam is absent and this throws
 * rather than silently doing nothing.
 */
export async function openBrowserTabViaCommand(client) {
  const result = await evalJs(
    client,
    `(async () => {
       const run = window.__VMARK_DEBUG__ && window.__VMARK_DEBUG__.runCommand;
       if (typeof run !== "function") return "NO_SEAM";
       try { await run("browser.newTab"); return "OK"; }
       catch (e) { return "ERR " + (e && e.message ? e.message : String(e)); }
     })()`
  );
  if (result === "NO_SEAM") {
    throw new Error(
      "__VMARK_DEBUG__.runCommand is absent — the app is not a DEV build, so UI-lane " +
        "journeys cannot create a browser tab. Run `pnpm tauri:dev`."
    );
  }
  if (result !== "OK") throw new Error(`browser.newTab failed: ${result}`);
}

/** Browser tabs as the app itself models them (kind === "browser"). */
export async function browserTabIds(client) {
  const raw = await evalJs(
    client,
    `(() => {
       const els = [...document.querySelectorAll('[data-tab-id]')];
       return JSON.stringify(els.map((e) => e.getAttribute('data-tab-id')));
     })()`
  );
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * Does the tab's native webview occlude a point in the window? (B14 oracle)
 *
 * Asks the app's debug `hitTest:` probe. This is deliberately NOT a read-back of
 * the flag `browser_freeze` sets — `setHidden(true)` then `isHidden() === true`
 * is a tautology and would be an assertion that cannot fail. `hitTest:` walks the
 * real AppKit hierarchy and skips hidden views, which is the same visibility rule
 * the compositor applies, so it answers through an independent path.
 *
 * Coordinates are FRACTIONS of the content view, so the caller needs no knowledge
 * of window size or backing scale.
 */
export async function nativeOccludesPoint(client, tabId, fx = 0.5, fy = 0.55) {
  const raw = await evalJs(
    client,
    `(async () => {
       try {
         const el = document.querySelector('.browser-surface, [data-browser-surface]')
                 || document.documentElement;
         const r = el.getBoundingClientRect();
         // AppKit content-view coordinates are bottom-left origin; the DOM is
         // top-left, so flip Y against the window's inner height.
         const px = r.left + r.width * ${fx};
         const domY = r.top + r.height * ${fy};
         const py = window.innerHeight - domY;
         const res = await window.__TAURI__.core.invoke('browser_debug_hit_test', {
           tabId: ${JSON.stringify(tabId)},
           windowLabel: 'main',
           x: px, y: py,
         });
         return JSON.stringify(res);
       } catch (e) { return "ERR " + (e && e.message ? e.message : String(e)); }
     })()`
  );
  if (typeof raw === "string" && raw.startsWith("ERR ")) {
    throw new Error(`browser_debug_hit_test unavailable (${raw}) — needs a DEBUG build`);
  }
  return JSON.parse(raw);
}

/**
 * How many native `WKWebView`s are ATTACHED to the window hierarchy.
 *
 * The real teardown oracle. `nativeBrowserTabIds` reads the bookkeeping map, which
 * teardown empties BEFORE calling `removeFromSuperview()` — so deleting that call
 * leaves the map clean while the view stays attached and displayed. An audit caught
 * B11 asserting the map and therefore being blind to exactly the leak the lifecycle
 * module's own doc warns about.
 */
export async function attachedWebviewCount(client, windowLabel = "main") {
  const raw = await evalJs(
    client,
    `(async () => {
       try {
         return await window.__TAURI__.core.invoke('browser_debug_attached_webviews', {
           windowLabel: ${JSON.stringify(windowLabel)},
         });
       } catch (e) { return "ERR " + (e && e.message ? e.message : String(e)); }
     })()`
  );
  if (typeof raw === "string") {
    throw new Error(`browser_debug_attached_webviews unavailable (${raw}) — needs a DEBUG build`);
  }
  return raw;
}

/** Invoke a Tauri browser command for a tab id. */
export async function invokeBrowserCommand(client, command, tabId) {
  const r = await evalJs(
    client,
    `(async () => {
       try {
         await window.__TAURI__.core.invoke(${JSON.stringify(command)}, { tabId: ${JSON.stringify(tabId)} });
         return "OK";
       } catch (e) { return "ERR " + (e && e.message ? e.message : String(e)); }
     })()`
  );
  if (r !== "OK") throw new Error(`${command} failed: ${r}`);
}
