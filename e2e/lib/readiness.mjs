/**
 * What "the app is drivable" MEANS — one definition, two consumers.
 *
 * This is the third layer of the same defect, and the first two are already
 * recorded in `e2e/wait-ready.mjs`'s header:
 *
 * | Probe | Succeeds when | Actually proves |
 * |---|---|---|
 * | `/dev/tcp` connect | the bridge binds its listener | the process reached Tauri setup |
 * | `list_windows` | the window object exists | the window was created |
 * | `execute_js "1+1"` | the webview has a JS context | `index.html` parsed |
 *
 * None of those is what a journey needs. Run 32701401717 (2026-08-24) is the
 * bill for the third one: `wait-ready` reported the app drivable at 07:30:35,
 * the app logged `Window 'main' is ready` at 07:30:41, and the first journey —
 * `multi-doc-save-integrity` — spent its whole 8s budget watching an EMPTY tab
 * bar and failed with `last observed: []`. The seven journeys after it passed,
 * because by then the app had finished booting. A first-in-line journey was
 * failing for being first in line.
 *
 * `1+1` evaluates as soon as the document has any JS context at all. Under
 * Vite dev that is the moment `index.html` parses — before the module graph
 * loads, before React mounts, before the stores hydrate, and before the tab bar
 * renders a single tab. It is the same shape of proxy as the open port, one
 * layer further in.
 *
 * The property every journey actually needs is that THE FRONTEND'S LISTENERS
 * ARE REGISTERED. A journey's first act is an event — `mcp-bridge:request` or
 * `menu:<id>` — and an event delivered before its listener exists is not
 * queued, retried or reported: it is dropped, and the journey then waits out
 * its budget for an effect that was never going to happen.
 *
 * The app already computes that moment exactly, because Rust needs it for the
 * same reason (`contexts/useWindowReady.ts` — menu events must not arrive
 * before `useFileOperations` is listening). So this asks the app instead of
 * inferring: `READY_ATTRIBUTE` is set once the handshake completes.
 *
 * WHAT THIS DELIBERATELY DOES NOT CHECK: an open document. An editor surface
 * and a non-empty tab bar describe a RESTORED SESSION, not a running app —
 * VMark's first launch shows a welcome screen with no tabs and no editor, which
 * is precisely the state a fresh CI runner boots into. An earlier version of
 * this module required both, which would have hung every CI run for the full
 * budget and then failed on a perfectly healthy app. Requiring more than the
 * property is its own bug; it just fails in the safe direction, which is how it
 * survives review.
 *
 * @coordinates-with src/contexts/useWindowReady.ts — publishes the attribute
 * @module e2e/lib/readiness
 */

/**
 * The attribute `useWindowReady` sets once the handshake completes. Kept in
 * step with the app by `src/test/windowReadyContract.test.ts`, which fails if
 * either side renames it — a silent rename here would restore the old
 * always-false behaviour, i.e. a permanent hang.
 */
export const READY_ATTRIBUTE = "data-vmark-window-ready";

/**
 * The probe, as a self-contained expression evaluated inside the document
 * webview by `execute_js`.
 *
 * `appShell` is reported alongside the attribute so a stuck run can say WHICH
 * stage it is stuck at: no shell means React has not mounted, a shell without
 * the attribute means it mounted and the handshake has not landed. It is
 * DIAGNOSTIC ONLY — the attribute is what gates.
 *
 * That distinction is the whole point of this module and was violated by its
 * first version, which gated on `.app-shell` too (audit finding #3). A CSS
 * class is a proxy: rename it in a refactor and readiness becomes permanently
 * unreachable, against an app that is running perfectly. The attribute cannot
 * be true before the shell exists — `WindowProvider` renders `null` until it
 * is ready — so gating on both bought nothing and risked exactly the
 * false-negative hang this file exists to prevent.
 */
export const DRIVABLE_SNIPPET = `(() => ({
  tauriEmit: typeof window?.__TAURI__?.event?.emit === 'function',
  tauriInvoke: typeof window?.__TAURI__?.core?.invoke === 'function',
  appShell: !!document.querySelector('.app-shell'),
  windowReady: document.documentElement.getAttribute('${READY_ATTRIBUTE}') === 'true',
}))()`;

/**
 * Judge one {@link DRIVABLE_SNIPPET} snapshot.
 *
 * @param {unknown} snapshot the probe's evaluated value
 * @returns {string | null} `null` when the app is drivable, else why it is not
 *
 * Conditions are reported in BOOT ORDER, earliest-missing first, so a stuck run
 * names the stage it is stuck at rather than the last check that happened to
 * fail. A malformed snapshot is a failure, never a pass: `execute_js` can
 * resolve with `undefined` for an expression that threw inside the webview, and
 * treating that as ready would restore exactly the bug this module exists to
 * close.
 */
export function drivableGap(snapshot) {
  if (snapshot === null || typeof snapshot !== "object") {
    return `probe returned ${JSON.stringify(snapshot) ?? "undefined"}, not a snapshot object`;
  }
  if (snapshot.tauriInvoke !== true) return "window.__TAURI__.core.invoke is not callable yet";
  if (snapshot.tauriEmit !== true) return "window.__TAURI__.event.emit is not callable yet";
  if (snapshot.windowReady !== true) {
    // `appShell` only sharpens the message; it never decides the verdict.
    return snapshot.appShell === true
      ? "the window has not completed its ready handshake — its event listeners are not registered"
      : "React has not mounted the app shell yet";
  }
  return null;
}
