/**
 * DEV-only `window.__VMARK_DEBUG__` publication.
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
 * A few older handles live as their own top-level globals rather than inside
 * `__VMARK_DEBUG__` (E2E journeys and DevTools recipes read them by those
 * names). `publishDevGlobal` gives them the same DEV gate, and the closed
 * `DevGlobalName` union is the inventory of every such name.
 *
 * @coordinates-with src/stores/editorStore.ts — publishes `editorView`
 * @coordinates-with src/services/commands/commandBootstrap.ts — publishes `runCommand`
 * @coordinates-with src/stores/mcpStore.ts — publishes `__mcpStore`
 * @coordinates-with src/stores/contentServerStore.ts — publishes `__contentServerStore`
 * @coordinates-with src/components/Terminal/terminalInputTrace.ts — publishes `__vmarkInputTrace`
 * @coordinates-with e2e/lib/browser.mjs — reads `__VMARK_DEBUG__`
 * @module utils/devDebugHandle
 */

/** The shape the harness sees. Deliberately loose: it is a debug surface, not an API. */
type DebugHandles = Record<string, unknown>;

declare global {
  interface Window {
    /** DEV-only debug handles; see `publishDebugHandle`. */
    __VMARK_DEBUG__?: DebugHandles;
  }
}

/** Every top-level DEV global the app publishes outside `__VMARK_DEBUG__`. */
export type DevGlobalName = "__mcpStore" | "__contentServerStore" | "__vmarkInputTrace";

function handles(): DebugHandles | undefined {
  if (typeof window === "undefined") return undefined;
  return window.__VMARK_DEBUG__;
}

/**
 * Publish (or replace) one debug handle, preserving every other key.
 *
 * No-op outside DEV and outside a browser context.
 */
export function publishDebugHandle(key: string, value: unknown): void {
  if (!import.meta.env?.DEV || typeof window === "undefined") return;
  window.__VMARK_DEBUG__ = { ...(window.__VMARK_DEBUG__ ?? {}), [key]: value };
}

/**
 * Publish one top-level DEV global (`window[name] = value`), replacing any
 * previous value under that name. Each name has exactly one publisher.
 *
 * No-op outside DEV and outside a browser context.
 */
export function publishDevGlobal(name: DevGlobalName, value: unknown): void {
  if (!import.meta.env?.DEV || typeof window === "undefined") return;
  Reflect.set(window, name, value);
}

/** Read a published handle. Returns `undefined` when absent or outside DEV. */
export function readDebugHandle(key: string): unknown {
  return handles()?.[key];
}
