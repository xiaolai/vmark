/**
 * terminalSessionStoreSync
 *
 * Purpose: Subscribes a set of live xterm sessions to the Zustand stores
 * (effective theme — settings.appearance + systemAppearanceStore —,
 * workspace.rootPath, settings.terminal) and
 * keeps each session in sync as those stores change. Extracted from
 * useTerminalSessions to keep that hook as an orchestrator.
 *
 * Behavior preserved verbatim from the original inline implementation:
 *   - Theme or monoFont changes update each session's term.options.theme and/or
 *     fontFamily, resolving the mono stack straight from the monoFont setting
 *     (not the --font-mono CSS var, which useTheme writes only in a later
 *     effect, so it would lag a monoFont-only change) (G6/WI-4.1). A monoFont
 *     change also re-fits and resizes the PTY, since cell width changes.
 *     The stack is MEASURED before it is applied: on WebKitGTK under a CJK
 *     locale the cascade stops at an unmatched family rather than falling
 *     through to the generic, so what CSS resolves is not always monospace
 *     (#1334). A proportional font here inflates every terminal cell.
 *   - Workspace-root changes inject a `cd` command into every alive PTY whose
 *     current cwd differs from the new root — the live OSC 7 cwd when known,
 *     else the spawn-time cwd (WI-2.2); PTY-less or exited sessions are skipped.
 *   - Terminal-setting changes update fontSize/lineHeight/cursorStyle/
 *     cursorBlink/macOptionIsMeta/screenReaderMode/scrollback/
 *     minimumContrastRatio on each xterm; a font change also re-fits the addon
 *     AND resizes the PTY (see fitAndResizePty — the two are one operation).
 *
 * @coordinates-with useTerminalSessions.ts — sole caller
 * @module components/Terminal/terminalSessionStoreSync
 */
import { useEffect } from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import { useSystemAppearanceStore } from "@/stores/systemAppearanceStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { getActiveWorkspaceScope } from "@/services/workspaces/activeWorkspaceScope";
import { buildXtermThemeForId, drawBoldTextInBrightColorsForId } from "@/theme";
import { useTabStore } from "@/stores/tabStore";
import { getRuntimePlatform } from "@/utils/platform";
import { verifiedMonoStack } from "@/services/fonts/verifiedMonoStack";
import { fitAndResizePty } from "./fitAndResizePty";
// Re-exported so existing importers (and tests) keep one obvious home for it.
export type { SyncableSessionEntry } from "./terminalSessionTypes";
import type { SyncableSessionEntry } from "./terminalSessionTypes";
import { currentTerminalThemeId } from "./terminalThemeId";
import { useTerminalSettingsSync } from "./terminalSettingsSync";


/** Build a `cd` command string for the given path (POSIX-quoted). */
export function buildCdCommand(path: string): string {
  const sanitized = path.replace(/[\n\r]/g, "");
  const escaped = sanitized.replace(/'/g, "'\\''");
  // Ctrl+U clears any partial input before the cd.
  return `\x15cd '${escaped}'\n`;
}

/**
 * Apply a session's deferred workspace `cd` if one is pending and the shell is
 * no longer busy. Shared by the live workspace-root sync (skip path) and the
 * OSC-133 idle flush. No-op when there is no pending root, the PTY is gone, or
 * the shell is still running a foreground command. Returns true if a `cd` was
 * written.
 */
export function flushPendingRoot(entry: SyncableSessionEntry): boolean {
  const pending = entry.pendingRoot;
  if (!pending) return false;
  if (!entry.pty || entry.shellExited) {
    entry.pendingRoot = null;
    return false;
  }
  if (entry.instance.isShellBusy()) return false;
  const currentCwd = entry.instance.getCwd() ?? entry.spawnedCwd;
  entry.pendingRoot = null;
  if (currentCwd === pending) return false;
  entry.pty.write(buildCdCommand(pending));
  entry.spawnedCwd = pending;
  return true;
}

/**
 * Hook that wires the three store→session sync effects. Subscriptions are
 * established on mount and torn down on unmount.
 */
export function useUIStoreSync(
  sessionsRef: React.RefObject<Map<string, SyncableSessionEntry>>,
): void {
  // Theme + mono-font sync. The theme compared is the EFFECTIVE theme id
  // (manual pick, or the paired light/dark theme while follow-system is on),
  // so it must also react to OS flips via systemAppearanceStore (#1125).
  useEffect(() => {
    // The terminal collapses to a NEUTRAL palette while a browser tab is
    // focused, because the shell around it already does (see
    // theme/terminalThemeForBrowser.ts). xterm paints a canvas from this JS
    // object, so the CSS neutral cannot reach it — without this the chrome went
    // neutral and the terminal stayed the tinted theme colour.
    let prevTheme = currentTerminalThemeId();
    let prevMono = useSettingsStore.getState().appearance.monoFont;
    const sync = () => {
      const themeId = currentTerminalThemeId();
      const monoFont = useSettingsStore.getState().appearance.monoFont;
      const themeChanged = themeId !== prevTheme;
      const monoChanged = monoFont !== prevMono;
      if (!themeChanged && !monoChanged) return;
      prevTheme = themeId;
      prevMono = monoFont;
      const newTheme = themeChanged ? buildXtermThemeForId(themeId) : null;
      // Resolve the mono stack straight from the setting (G6/WI-4.1). This
      // subscriber fires synchronously inside the store `set`, before useTheme's
      // effect writes --font-mono, so reading that CSS var here would yield the
      // PREVIOUS font on a monoFont-only change.
      const newFont = verifiedMonoStack(monoFont, getRuntimePlatform());
      const sessions = sessionsRef.current;
      if (!sessions) return;
      for (const [, entry] of sessions) {
        if (newTheme) {
          entry.instance.term.options.theme = newTheme;
          // The bold repaint rule is per theme too (WI-UI1.4/D10) — switching
          // to solarized live must stop repainting bold as base-tone grey.
          entry.instance.term.options.drawBoldTextInBrightColors =
            drawBoldTextInBrightColorsForId(themeId);
        }
        entry.instance.term.options.fontFamily = newFont;
        // A different mono family changes cell advance width, so cols/rows
        // change just as they do for a font-size change. This effect used to
        // set fontFamily and stop, leaving BOTH xterm geometry and the PTY
        // stale — strictly worse than the font-size path.
        if (monoChanged) fitAndResizePty(entry);
      }
    };
    const unsubs = [
      useSettingsStore.subscribe(sync),
      useSystemAppearanceStore.subscribe(sync),
      // Tab focus changes the neutral, so it changes the terminal theme. `sync`
      // early-returns when nothing it cares about moved, so the extra traffic
      // from unrelated tab-metadata writes costs a comparison.
      useTabStore.subscribe(sync),
    ];
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [sessionsRef]);

  // Workspace-root sync — cd running sessions when the root changes
  useEffect(() => {
    const currentRoot = () =>
      {
        const scope = getActiveWorkspaceScope(getCurrentWindowLabel());
        return scope.isWorkspaceMode ? scope.rootPath : null;
      };
    let prevRoot = currentRoot();
    const syncRoot = () => {
      const newRoot = currentRoot();
      if (!newRoot) {
        // Leaving workspace mode INVALIDATES any deferred cd. Without this the
        // early return skipped the loop below, so a root queued while a shell
        // was busy outlived the workspace, and the next idle event cd'd into a
        // directory the user had just closed (audit 20260815-163607 #14).
        prevRoot = newRoot;
        for (const [, entry] of sessionsRef.current ?? []) entry.pendingRoot = null;
        return;
      }
      if (newRoot === prevRoot) {
        prevRoot = newRoot;
        return;
      }
      prevRoot = newRoot;

      const cdCommand = buildCdCommand(newRoot);
      const sessions = sessionsRef.current;
      if (!sessions) return;
      for (const [, entry] of sessions) {
        // Never inject `cd` into a shell that's running a foreground command
        // (e.g. vim, less) — the Ctrl+U + cd would corrupt it. Record the
        // root as pending so the idle flush (OSC 133 done) cd's once the
        // command exits, instead of leaving the session stuck in the old
        // workspace. Requires shell integration; without it isShellBusy() is
        // always false (prior behavior — no pending root is ever recorded).
        if (entry.instance.isShellBusy()) {
          entry.pendingRoot = newRoot;
          continue;
        }
        // A pending root is now superseded by this (idle) sync.
        entry.pendingRoot = null;
        // Prefer the shell's live cwd (OSC 7) over the spawn-time cwd, so a
        // session the user already cd'd into newRoot isn't redundantly cd'd
        // again (WI-2.2).
        const currentCwd = entry.instance.getCwd() ?? entry.spawnedCwd;
        if (entry.pty && !entry.shellExited && currentCwd !== newRoot) {
          entry.pty.write(cdCommand);
          entry.spawnedCwd = newRoot;
        }
      }
    };

    // Register an idle flush per session so a deferred root cd applies the
    // moment the busy shell returns to a prompt. Track which entries we've
    // wired so newly-created sessions get hooked on the next sync, and so
    // cleanup can clear them.
    const wired = new Set<SyncableSessionEntry>();
    const wireIdleFlush = () => {
      const sessions = sessionsRef.current;
      if (!sessions) return;
      const live = new Set(sessions.values());
      // RECONCILE, don't just accumulate. `wired` only ever grew, so a closed
      // session stayed in the set — retaining its disposed xterm instance and
      // leaving its idle callback installed — until the whole hook unmounted
      // (audit 20260815-163607 #15).
      for (const entry of wired) {
        if (live.has(entry)) continue;
        entry.instance.setOnShellIdle(null);
        wired.delete(entry);
      }
      for (const entry of live) {
        if (wired.has(entry)) continue;
        wired.add(entry);
        entry.instance.setOnShellIdle(() => flushPendingRoot(entry));
      }
    };
    wireIdleFlush();
    const syncRootAndWire = () => {
      wireIdleFlush();
      syncRoot();
    };

    const unsubs = [
      useWorkspaceStore.subscribe(syncRootAndWire),
      useWorkspaceInstancesStore.subscribe(syncRootAndWire),
      useSettingsStore.subscribe(syncRootAndWire),
    ];
    return () => {
      for (const unsub of unsubs) unsub();
      for (const entry of wired) entry.instance.setOnShellIdle(null);
      wired.clear();
    };
  }, [sessionsRef]);

  // Terminal-settings sync lives in its own module (see terminalSettingsSync.ts).
  useTerminalSettingsSync(sessionsRef);
}
