/**
 * terminalSessionStoreSync
 *
 * Purpose: Subscribes a set of live xterm sessions to three Zustand stores
 * (settings.appearance.theme, workspace.rootPath, settings.terminal) and
 * keeps each session in sync as those stores change. Extracted from
 * useTerminalSessions to keep that hook as an orchestrator.
 *
 * Behavior preserved verbatim from the original inline implementation:
 *   - Theme or monoFont changes update each session's term.options.theme and/or
 *     fontFamily, resolving the mono stack straight from the monoFont setting
 *     (not the --font-mono CSS var, which useTheme writes only in a later
 *     effect, so it would lag a monoFont-only change) (G6/WI-4.1).
 *   - Workspace-root changes inject a `cd` command into every alive PTY whose
 *     current cwd differs from the new root — the live OSC 7 cwd when known,
 *     else the spawn-time cwd (WI-2.2); PTY-less or exited sessions are skipped.
 *   - Terminal-setting changes update fontSize/lineHeight/cursorStyle/
 *     cursorBlink/macOptionIsMeta/screenReaderMode/scrollback/
 *     minimumContrastRatio on each xterm; a font change also re-fits the
 *     addon to repaint at the new metrics.
 *
 * @coordinates-with useTerminalSessions.ts — sole caller
 * @module components/Terminal/terminalSessionStoreSync
 */
import { useEffect } from "react";
import type { IPty } from "@/lib/pty";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { getActiveWorkspaceScope } from "@/services/workspaces/activeWorkspaceScope";
import { buildXtermThemeForId } from "@/theme";
import { resolveMonoFontStack } from "@/utils/fontStacks";
import type { TerminalInstance } from "./createTerminalInstance";

/**
 * Minimum shape of a session entry that the sync effects need. Kept narrow
 * so the hook's full SessionEntry type remains private to useTerminalSessions.
 */
export interface SyncableSessionEntry {
  instance: TerminalInstance;
  pty: IPty | null;
  shellExited: boolean;
  spawnedCwd: string | undefined;
  /**
   * Workspace root that arrived while this session's shell was busy and so
   * could not be cd'd immediately. Flushed when the shell returns to idle
   * (OSC 133 done / next prompt) so a session doesn't stay stuck in the old
   * workspace after a long-running foreground command exits.
   */
  pendingRoot?: string | null;
}

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
  // Theme + mono-font sync
  useEffect(() => {
    const appearance = () => useSettingsStore.getState().appearance;
    let prevTheme = appearance().theme;
    let prevMono = appearance().monoFont;
    return useSettingsStore.subscribe((state) => {
      const themeId = state.appearance.theme;
      const monoFont = state.appearance.monoFont;
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
      const newFont = resolveMonoFontStack(monoFont);
      const sessions = sessionsRef.current;
      if (!sessions) return;
      for (const [, entry] of sessions) {
        if (newTheme) entry.instance.term.options.theme = newTheme;
        entry.instance.term.options.fontFamily = newFont;
      }
    });
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
      if (!newRoot || newRoot === prevRoot) {
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
      for (const [, entry] of sessions) {
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

  // Terminal-settings sync (font, cursor, macOptionIsMeta)
  useEffect(() => {
    const getTermSettings = () => useSettingsStore.getState().terminal;
    let prev = getTermSettings();
    return useSettingsStore.subscribe((state) => {
      const curr = state.terminal;
      if (!curr || !prev) { prev = curr; return; }
      const fontChanged = curr.fontSize !== prev.fontSize || curr.lineHeight !== prev.lineHeight;
      const cursorChanged = curr.cursorStyle !== prev.cursorStyle || curr.cursorBlink !== prev.cursorBlink;
      const metaChanged = curr.macOptionIsMeta !== prev.macOptionIsMeta;
      const screenReaderChanged = curr.screenReaderMode !== prev.screenReaderMode;
      const scrollbackChanged = curr.scrollback !== prev.scrollback;
      const contrastChanged = curr.minimumContrastRatio !== prev.minimumContrastRatio;
      if (!fontChanged && !cursorChanged && !metaChanged && !screenReaderChanged && !scrollbackChanged && !contrastChanged) return;
      prev = curr;

      const sessions = sessionsRef.current;
      if (!sessions) return;
      for (const [, entry] of sessions) {
        const opts = entry.instance.term.options;
        if (fontChanged) {
          opts.fontSize = curr.fontSize;
          opts.lineHeight = curr.lineHeight;
        }
        if (cursorChanged) {
          opts.cursorStyle = curr.cursorStyle;
          opts.cursorBlink = curr.cursorBlink;
        }
        if (metaChanged) {
          opts.macOptionIsMeta = curr.macOptionIsMeta;
        }
        if (screenReaderChanged) {
          opts.screenReaderMode = curr.screenReaderMode;
        }
        if (scrollbackChanged) {
          // Clamp like creation does — corrupt persisted state could carry an
          // extreme value (Codex audit).
          opts.scrollback = Math.min(Math.max(curr.scrollback, 100), 200_000);
        }
        if (contrastChanged) {
          // xterm accepts 1–21; clamp like creation does.
          opts.minimumContrastRatio = Math.min(Math.max(curr.minimumContrastRatio, 1), 21);
        }
        if (fontChanged) {
          try { entry.instance.fitAddon.fit(); } catch { /* ignore */ }
        }
      }
    });
  }, [sessionsRef]);
}
