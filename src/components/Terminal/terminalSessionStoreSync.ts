/**
 * terminalSessionStoreSync
 *
 * Purpose: Subscribes a set of live xterm sessions to three Zustand stores
 * (settings.appearance.theme, workspace.rootPath, settings.terminal) and
 * keeps each session in sync as those stores change. Extracted from
 * useTerminalSessions to keep that hook as an orchestrator.
 *
 * Behavior preserved verbatim from the original inline implementation:
 *   - Theme changes update each session's term.options.theme AND re-resolve
 *     fontFamily from --font-mono (G6/WI-4.1).
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
import { buildXtermThemeForId } from "@/theme";
import { resolveMonoFont, type TerminalInstance } from "./createTerminalInstance";

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
      // The mono font derives from the --font-mono CSS var, which both a theme
      // switch and the monoFont setting update (via useTheme) — re-resolve on
      // either so running sessions repaint with the new font (G6/WI-4.1).
      if (!themeChanged && !monoChanged) return;
      prevTheme = themeId;
      prevMono = monoFont;
      const newTheme = themeChanged ? buildXtermThemeForId(themeId) : null;
      const newFont = resolveMonoFont();
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
        // Never inject `cd` into a shell that's running a foreground command
        // (e.g. vim, less) — the Ctrl+U + cd would corrupt it. Skip; a later
        // workspace change (or none) will cd once it's idle. Requires shell
        // integration; without it isShellBusy() is always false (prior behavior).
        if (entry.instance.isShellBusy()) continue;
        // Prefer the shell's live cwd (OSC 7) over the spawn-time cwd, so a
        // session the user already cd'd into newRoot isn't redundantly cd'd
        // again (WI-2.2).
        const currentCwd = entry.instance.getCwd() ?? entry.spawnedCwd;
        if (entry.pty && !entry.shellExited && currentCwd !== newRoot) {
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
