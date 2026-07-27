/**
 * DEV-only `window.__VMARK_DEBUG__` publication (WI-4.0).
 *
 * Purpose: give the E2E harness a way to reach the app that does not exist
 * otherwise. The debug automation bridge exposes only `list_windows`,
 * `execute_js` and `capture_native_screenshot`; a Tauri event emitted from inside
 * the webview never reaches the app's own `listen()` handlers (confirmed with a
 * non-browser control event), and synthetic keyboard events do not reach the
 * keybinding layer. `execute_js` is therefore the only channel, and it can only
 * call what the app has put on `window`.
 *
 * MERGE, NEVER REPLACE. There is more than one publisher (the editor view, the
 * command runner), and the original code assigned the whole object. A second
 * publisher would then erase the first — and because the editor view republishes
 * on every editor change, the erasure would be intermittent and would read as a
 * flaky harness rather than a bug here.
 *
 * DEV-GATED, deliberately. Shipping this would let any script running in the app
 * webview invoke arbitrary commands. `import.meta.env.DEV` is statically replaced
 * at build time, so the branch — and everything it reaches — is dropped from a
 * production bundle rather than merely being unused.
 *
 * @coordinates-with src/stores/editorStore.ts — publishes `editorView`
 * @coordinates-with src/hooks/useCommandBootstrap.ts — publishes `runCommand`
 * @coordinates-with e2e/lib/browser.mjs — the only consumer
 * @module utils/devDebugHandle
 */

/** The shape the harness sees. Deliberately loose: it is a debug surface, not an API. */
type DebugHandles = Record<string, unknown>;

function handles(): DebugHandles | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { __VMARK_DEBUG__?: DebugHandles }).__VMARK_DEBUG__;
}

/**
 * Publish (or replace) one debug handle, preserving every other key.
 *
 * No-op outside DEV and outside a browser context.
 */
export function publishDebugHandle(key: string, value: unknown): void {
  if (!import.meta.env.DEV || typeof window === "undefined") return;
  const target = window as unknown as { __VMARK_DEBUG__?: DebugHandles };
  target.__VMARK_DEBUG__ = { ...(target.__VMARK_DEBUG__ ?? {}), [key]: value };
}

/** Read a published handle. Returns `undefined` when absent or outside DEV. */
export function readDebugHandle(key: string): unknown {
  return handles()?.[key];
}
