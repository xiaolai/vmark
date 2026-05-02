/**
 * terminalSessionStoreSync
 *
 * Purpose: Subscribes a set of live xterm sessions to three Zustand stores
 * (settings.appearance.theme, workspace.rootPath, settings.terminal) and
 * keeps each session in sync as those stores change. Extracted from
 * useTerminalSessions to keep that hook as an orchestrator.
 *
 * Behavior preserved verbatim from the original inline implementation:
 *   - Theme changes update each session's term.options.theme.
 *   - Workspace-root changes inject a `cd` command into every alive PTY
 *     whose spawnedCwd is stale; PTY-less or exited sessions are skipped.
 *   - Terminal-setting changes update fontSize/lineHeight/cursorStyle/
 *     cursorBlink/macOptionIsMeta on each xterm; a font change also
 *     re-fits the addon to repaint at the new metrics.
 *
 * @coordinates-with useTerminalSessions.ts — sole caller
 * @module components/Terminal/terminalSessionStoreSync
 */
import { useEffect } from "react";
import type { IPty } from "@/lib/pty";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { buildXtermThemeForId } from "./terminalTheme";
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
}

/** Build a `cd` command string for the given path (POSIX-quoted). */
export function buildCdCommand(path: string): string {
  const sanitized = path.replace(/[\n\r]/g, "");
  const escaped = sanitized.replace(/'/g, "'\\''");
  // Ctrl+U clears any partial input before the cd.
  return `\x15cd '${escaped}'\n`;
}

/**
 * Hook that wires the three store→session sync effects. Subscriptions are
 * established on mount and torn down on unmount.
 */
export function useTerminalSessionStoreSync(
  sessionsRef: React.RefObject<Map<string, SyncableSessionEntry>>,
): void {
  // Theme sync
  useEffect(() => {
    let prevTheme = useSettingsStore.getState().appearance.theme;
    return useSettingsStore.subscribe((state) => {
      const themeId = state.appearance.theme;
      if (themeId === prevTheme) return;
      prevTheme = themeId;
      const newTheme = buildXtermThemeForId(themeId);
      const sessions = sessionsRef.current;
      if (!sessions) return;
      for (const [, entry] of sessions) {
        entry.instance.term.options.theme = newTheme;
      }
    });
  }, [sessionsRef]);

  // Workspace-root sync — cd running sessions when the root changes
  useEffect(() => {
    let prevRoot = useWorkspaceStore.getState().rootPath;
    return useWorkspaceStore.subscribe((state) => {
      const newRoot = state.rootPath;
      if (!newRoot || newRoot === prevRoot) {
        prevRoot = newRoot;
        return;
      }
      prevRoot = newRoot;

      const cdCommand = buildCdCommand(newRoot);
      const sessions = sessionsRef.current;
      if (!sessions) return;
      for (const [, entry] of sessions) {
        if (entry.pty && !entry.shellExited && entry.spawnedCwd !== newRoot) {
          entry.pty.write(cdCommand);
          entry.spawnedCwd = newRoot;
        }
      }
    });
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
      if (!fontChanged && !cursorChanged && !metaChanged) return;
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
        if (fontChanged) {
          try { entry.instance.fitAddon.fit(); } catch { /* ignore */ }
        }
      }
    });
  }, [sessionsRef]);
}
