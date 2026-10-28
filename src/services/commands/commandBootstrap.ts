/**
 * Command bootstrap steps — the three lifecycle pieces `useCommandBootstrap`
 * runs once per window: the DEV debug handles, the window-lifetime services,
 * and the cancellable menu mount whose completeness feeds the window-ready
 * handshake.
 *
 * Key decisions:
 *   - Each step owns one resource and hands back its own disposer, so the
 *     hook's effect is only their order and their teardown.
 *   - The runtime services start synchronously; if they throw, the step runs
 *     the caller's rollback (the editor command batch) before rethrowing,
 *     because the effect that would have cleaned up never returns.
 *   - The menu mount is cancellable at any point: the disposer aborts the
 *     pass, which tears down listeners even while the mount is in flight, and
 *     a cancelled pass never signals readiness.
 *   - Readiness is a verdict, not a "done": a failed Pandoc expansion or a
 *     binding that could not listen signals `false`, while the bindings that
 *     did mount keep working.
 *
 * @coordinates-with hooks/useCommandBootstrap.ts — the order and the teardown
 * @coordinates-with services/commands/menuListener.ts — the mount itself
 * @coordinates-with services/commands/menuCommandsReady.ts — the readiness barrier
 * @module services/commands/commandBootstrap
 */

import type { UnlistenFn } from "@tauri-apps/api/event";
import { menuError, appError } from "@/utils/debug";
import { mountMenuCommands, type MenuCommandBinding } from "./menuListener";
import { registerPandocFormatCommands } from "./exportCommands";
import { executeCommand } from "./CommandBus";
import { signalMenuCommandsMounted } from "./menuCommandsReady";
import { startRuntimeServices } from "@/services/runtimeWiring";
import { closeBrowserTabById } from "@/services/browser/browserTabLifecycle";
import { useRecentWorkspacesStore } from "@/stores/recentsStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { publishDebugHandle } from "@/utils/devDebugHandle";

/**
 * DEV-only harness seams. The E2E journeys have no other way to invoke a
 * command: the debug bridge offers only execute_js, a Tauri event emitted
 * inside the webview never reaches the app's own listeners (verified with a
 * non-browser control event), and synthetic key events do not reach the
 * keybinding layer. Publishing `executeCommand` — the SAME function the menu
 * route calls (menuListener.ts) — means a journey exercises the real dispatch
 * path rather than a test-only shortcut past it.
 *
 * Compiled out of production: `publishDebugHandle` is DEV-gated, so this
 * cannot become a way for page script in the app webview to run commands.
 * Nothing to dispose: a handle is a DEV global, and publishing it again on a
 * StrictMode replay overwrites it with the same function.
 */
export function publishCommandDebugHandles(): void {
  publishDebugHandle(
    "runCommand",
    (commandId: string, payload?: unknown, windowLabel?: string) =>
      executeCommand(commandId, payload, { windowLabel: windowLabel ?? "main" }),
  );
  // For teardown: the harness closes the tabs it created through the app's own
  // lifecycle instead of tearing the native view out from under it.
  publishDebugHandle("closeBrowserTab", closeBrowserTabById);
  // For hygiene: a journey that opened a temporary workspace in a second window
  // removes it from the persisted recents through the store's own action, so a
  // run leaves no dead entry behind in the dev profile's menu.
  publishDebugHandle("forgetRecentWorkspace", (path: string) =>
    useRecentWorkspacesStore.getState().removeWorkspace(path),
  );
  // For the features hidden behind Developer Mode (#1425): the Knowledge Base's
  // menu item, palette command and shortcut are all absent until it is on, so a
  // journey that exercises the panel turns it on the way the user would —
  // through the store's own action, which pushes the native menu item back too.
  // Returns the PREVIOUS value: the setting persists into the dev profile, so a
  // journey has to put back what it found rather than assume the default.
  publishDebugHandle("setDeveloperMode", (on: boolean) => {
    const previous = useSettingsStore.getState().advanced.developerMode;
    useSettingsStore.getState().updateAdvancedSetting("developerMode", on);
    return previous;
  });
}

/**
 * Start the window-lifetime services (grant/policy mirrors, tab events and
 * lifecycle, recorder, coherence, workspace sync, menu mirror, per-tab state
 * cleanup) and return their one disposer. They start synchronously with the
 * window's first effects, which is what lets every later tab removal — a
 * session restore included — rely on the cleanup instead of freeing a tab's
 * state itself. On failure `rollback` runs before the error propagates; the
 * services themselves roll back inside `startRuntimeServices`.
 */
export function startRuntimeServicesOrRollback(rollback: () => void): () => void {
  try {
    return startRuntimeServices();
  } catch (error) {
    rollback();
    throw error;
  }
}

/** The static bindings plus one per Pandoc format; `expanded` is false when the expansion failed. */
function withPandocBindings(staticBindings: readonly MenuCommandBinding[]): {
  bindings: MenuCommandBinding[];
  expanded: boolean;
} {
  const bindings = [...staticBindings];
  try {
    for (const fmt of registerPandocFormatCommands()) {
      bindings.push({ menuEvent: `menu:export-pandoc-${fmt}`, commandId: `export.pandoc-${fmt}` });
    }
    return { bindings, expanded: true };
  } catch (err) {
    // Part of the readiness VERDICT, not just a log line: a failed expansion
    // means every Pandoc export item in the native menu routes nowhere.
    menuError("Failed to expand Pandoc menu bindings:", err);
    return { bindings, expanded: false };
  }
}

/**
 * Mount the menu→command bridge for `staticBindings` and the Pandoc formats,
 * then signal its completeness to the window-ready handshake. The Pandoc
 * expansion runs synchronously, so nothing is awaited before the listeners
 * are requested. Returns the disposer: it aborts a mount still in flight and
 * removes the listeners of one that finished.
 */
export function mountMenuBridge(staticBindings: readonly MenuCommandBinding[]): () => void {
  let unlisten: UnlistenFn | null = null;
  const pass = new AbortController();
  const { bindings, expanded } = withPandocBindings(staticBindings);

  // A failure here is critical — every native menu item, accelerator and
  // palette entry stops routing — so it is caught and reported, never left as
  // an unhandled rejection. The mount is best-effort and REPORTS completeness:
  // a partial mount is kept (every item that bound still works) and the
  // incompleteness is logged and signalled, never hidden. The abort signal
  // reaches into the mount, so a cancelled pass does not keep ITS listeners
  // live alongside the replay pass (which double-dispatched every menu event).
  void (async () => {
    try {
      const { off, failed } = await mountMenuCommands(bindings, { signal: pass.signal });
      if (pass.signal.aborted) {
        off(); // already torn down by the abort; idempotent
        return;
      }
      unlisten = off;
      if (failed.length > 0) menuError(`${failed.length} menu binding(s) could not mount:`, failed);
      // Only from a pass that is still LIVE: a StrictMode-cancelled first pass
      // must not signal after removing its listener and before the replay mounts.
      signalMenuCommandsMounted(expanded && failed.length === 0);
    } catch (err) {
      // Only the duplicate-binding preflight rejects: the static binding list
      // is malformed, nothing mounted, so nothing routes.
      menuError("Failed to mount menu commands:", err);
      if (!pass.signal.aborted) signalMenuCommandsMounted(false);
    }
  })().catch((err: unknown) => appError("Command bootstrap failed:", err));

  return () => {
    pass.abort();
    unlisten?.();
  };
}
