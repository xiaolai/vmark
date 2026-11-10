/**
 * Warm the editor surface before the first journey.
 *
 * Readiness (`readiness.mjs`) deliberately stops at "the window completed its
 * ready handshake": a fresh profile boots into a welcome screen with no editor.
 * But `tauri dev` serves modules on demand, and the markdown editor surface is a
 * lazy chunk, so the FIRST tab any journey opens makes the dev server transform
 * the whole editor graph (~2,300 modules) cold. That outlasts the 8 s `poll`
 * every journey uses — the journey then reported "editor to rebind … last
 * observed: none" against an editor that was merely still loading (issue 1659).
 * A warm Vite cache passes, which is why only CI's fresh runner showed it.
 *
 * The cold-compile cost is a startup cost, not a behaviour under test, so it is
 * paid here, once, under its own budget, and a failure to load the surface is
 * reported as exactly that. The journeys' own budgets stay as tight as they
 * were: they now measure the app, not the dev server.
 *
 * `EDITOR_SURFACE_MODULE` is the module the markdown adapter's
 * `wysiwygComponent` thunk imports; `warmup.test.mjs` pins the two together.
 * The import is the page's own, so the module is fetched, compiled and
 * evaluated once and the app's later `import()` reuses it.
 *
 * @coordinates-with src/lib/formats/adapters/markdown.tsx — owns the thunk this mirrors
 * @coordinates-with e2e/run-journeys.mjs — calls this once before the first journey
 * @module e2e/lib/warmup
 */

/** The page-relative URL of the markdown WYSIWYG surface module. */
export const EDITOR_SURFACE_MODULE = "/src/lib/formats/adapters/markdownSurface.tsx";

/** A cold dev server on a small CI runner; generous because it is paid once. */
export const WARMUP_TIMEOUT_MS = 120_000;

/** How often the page's import is checked. */
const POLL_MS = 500;

/**
 * Per-call bridge wait. The bridge plugin answers an `execute_js` within 5 s or
 * reports "Script execution timeout" whatever the client waits, so a cold
 * import cannot ride one call: it is started in the page, and polled here.
 */
const CALL_TIMEOUT_MS = 8_000;

const STATE_KEY = "__vmarkE2eEditorWarmup";

const START_SCRIPT = `(() => {
  const w = window;
  if (!w.${STATE_KEY}) {
    w.${STATE_KEY} = { state: "loading" };
    import(${JSON.stringify(EDITOR_SURFACE_MODULE)}).then(
      () => { w.${STATE_KEY} = { state: "ready" }; },
      (e) => { w.${STATE_KEY} = { state: "failed", error: String((e && e.message) || e) }; },
    );
  }
  return w.${STATE_KEY};
})()`;

const POLL_SCRIPT = `(() => window.${STATE_KEY} ?? { state: "missing" })()`;

async function call(client, script) {
  const reply = await client.send("execute_js", { script }, CALL_TIMEOUT_MS);
  if (reply.success !== true) {
    throw new Error(`could not warm the editor surface: ${reply.error ?? JSON.stringify(reply)}`);
  }
  return reply.data;
}

/**
 * Load the editor surface in the document webview and wait for it to evaluate.
 *
 * @param {{ send: (command: string, args: object, timeoutMs: number) => Promise<{success: boolean, data?: any, error?: string}> }} client
 * @param {{ timeoutMs?: number, pollMs?: number }} [opts]
 * @returns {Promise<void>} resolves once the surface module has loaded
 * @throws when the page cannot load the module, the page reloads under the
 *   import, or the budget is spent
 */
export async function warmEditorSurface(client, { timeoutMs = WARMUP_TIMEOUT_MS, pollMs = POLL_MS } = {}) {
  const deadline = Date.now() + timeoutMs;
  let status = await call(client, START_SCRIPT);
  for (;;) {
    if (status?.state === "ready") return;
    if (status?.state === "failed") {
      throw new Error(`could not warm the editor surface: ${status.error}`);
    }
    // "missing" after a start means the page reloaded and lost the import.
    if (status?.state !== "loading") {
      throw new Error(`could not warm the editor surface: page state ${JSON.stringify(status)}`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`could not warm the editor surface within ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, pollMs));
    status = await call(client, POLL_SCRIPT);
  }
}
