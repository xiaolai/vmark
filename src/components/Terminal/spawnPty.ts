/**
 * spawnPty
 *
 * Purpose: Spawns a PTY (pseudo-terminal) process connected to an xterm instance.
 * Resolves the working directory, gets the default shell from Rust, and wires
 * up bidirectional data streams.
 *
 * Key decisions:
 *   - CWD priority: workspace root > active file's parent directory > shell default ($HOME).
 *   - Shell priority: user-configured shell in settings > Rust backend default
 *     (get_default_shell: getpwuid → $SHELL → /bin/sh). Only absolute paths
 *     are accepted; relative paths are rejected to prevent PATH/CWD hijack.
 *   - If the configured shell fails to spawn, retries with system default.
 *   - Sets TERM_PROGRAM=WezTerm (impersonation) so CLI tools with terminal
 *     allowlists (Claude Code's /terminal-setup, etc.) recognize the host as a
 *     CSI-u-capable terminal. WezTerm chosen for lowest side-effect risk among
 *     the four recognized values. See dev-docs/decisions/ADR-006-terminal-program-identity.md.
 *     Do NOT change to "vmark" — third-party tools will fall through to a
 *     generic "unknown terminal" path. The impersonation is kept honest by
 *     terminalKeyHandler.ts, which translates Shift+Enter into the matching
 *     CSI-u sequence ("\x1b[13;2u") that real WezTerm sends.
 *   - Sets EDITOR=vmark so $EDITOR-aware CLI tools open files back in VMark.
 *   - Injects login shell PATH via get_login_shell_path Tauri command so CLI
 *     tools (node, claude, etc.) are discoverable — macOS GUI apps have minimal
 *     PATH by default. Fallback PATH is platform-aware (Windows vs Unix).
 *   - Sets LC_CTYPE=UTF-8 because macOS GUI apps have minimal env; without it
 *     the shell defaults to C locale and tools emit "?" for CJK characters.
 *     LC_CTYPE (not LANG) avoids overriding the user's full locale.
 *   - Sets VMARK_WORKSPACE when a workspace is open, enabling shell scripts
 *     to access the workspace root.
 *   - The disposed() callback lets the caller abort if the session was removed
 *     while the async spawn was in flight.
 *   - Watermark-based flow control pauses the PTY when xterm.js's parser can't
 *     keep up with rapid output (e.g. AI tool redraws), preventing lag/freezes.
 *     Retained after WI-1.1: the binary Channel removed the IPC-encoding
 *     bottleneck, but xterm's parse/render rate is a separate limit this guards.
 *   - PTY output arrives as a Uint8Array (the binary Channel delivers an
 *     ArrayBuffer, coerced once in lib/pty.ts), passed straight to xterm.js.
 *
 * @coordinates-with useTerminalSessions.ts — calls spawnPty when starting a shell
 * @coordinates-with createTerminalInstance.ts — provides the xterm Terminal instance
 * @module components/Terminal/spawnPty
 */
import { spawn, type IPty, type IEvent } from "@/lib/pty";
import { invoke } from "@tauri-apps/api/core";
import type { Terminal } from "@xterm/xterm";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { getActiveWorkspaceScope } from "@/services/workspaces/activeWorkspaceScope";
import { getParentDir } from "@/utils/paths/paths";
import { resolveLoginShellPath, buildShellEnv } from "./terminalSpawnEnv";

/**
 * Resolve terminal working directory:
 * 1. Workspace root (if open)
 * 2. Active file's parent directory (if saved)
 * 3. undefined — lets the shell start in its default ($HOME)
 */
export function resolveTerminalCwd(): string | undefined {
  const windowLabel = getCurrentWindowLabel();
  const workspaceRoot = resolveTerminalWorkspaceRoot(windowLabel);
  if (workspaceRoot) return workspaceRoot;

  const activeTabId = useTabStore.getState().activeTabId[windowLabel];
  if (activeTabId) {
    const doc = useDocumentStore.getState().getDocument(activeTabId);
    if (doc?.filePath) {
      // Use the cross-platform path helper instead of a raw forward-slash
      // search. On Windows, `doc.filePath` is typically backslash-separated
      // (`C:\Users\foo\bar.md`); `lastIndexOf("/")` returned -1 and the
      // terminal opened in $HOME, breaking the documented CWD priority.
      // `getParentDir` normalizes both separators and returns "" for
      // filesystem roots.
      const parent = getParentDir(doc.filePath);
      // getParentDir returns "" for both POSIX root files (`/file.md`) and
      // Windows drive-root files (`C:\file.md`) — but those need DIFFERENT
      // roots, not $HOME. Resolve each explicitly so the terminal starts in
      // the file's actual directory.
      if (parent) {
        // Windows drive-root edge: `C:\sub\file.md` → getParentDir yields
        // "c:" (a drive-relative reference, NOT an absolute path), which
        // would start the shell in the wrong directory. Append a slash so it
        // anchors to the drive root.
        if (/^[a-z]:$/i.test(parent)) return `${parent}/`;
        return parent;
      }
      // File is directly at a filesystem root.
      if (doc.filePath.startsWith("/")) return "/";
      // Windows drive-root file (e.g. `C:\file.md` or `C:/file.md`) — return
      // the drive root so the shell starts at `C:/` rather than $HOME.
      const driveMatch = /^([a-zA-Z]):[/\\]/.exec(doc.filePath);
      if (driveMatch) return `${driveMatch[1].toLowerCase()}:/`;
    }
  }

  return undefined;
}

/** Resolve the active workspace root used for terminal CWD and VMARK_WORKSPACE. */
export function resolveTerminalWorkspaceRoot(
  windowLabel = getCurrentWindowLabel(),
): string | undefined {
  return getActiveWorkspaceScope(windowLabel).rootPath ?? undefined;
}

/** Options for spawning a PTY process connected to an xterm instance. */
export interface SpawnOptions {
  term: Terminal;
  cwd?: string;
  onExit: (exitCode: number) => void;
  disposed: () => boolean;
}

/** Flow control constants — exported for tests. */
export const CALLBACK_BYTE_LIMIT = 100_000;
/** Number of pending write callbacks that triggers PTY pause. */
export const HIGH_WATERMARK = 5;
/** Number of pending write callbacks that triggers PTY resume. */
export const LOW_WATERMARK = 2;

/**
 * Wire PTY → xterm with watermark-based flow control.
 * Fast producers (e.g. claude-code with rapid ANSI redraws) can overwhelm
 * xterm.js's PARSER (not the transport — output is now binary, WI-1.1). We pause
 * the PTY when too many write callbacks are pending, and resume when the parser
 * catches up. This backpressure guards the parse/render rate, so it is retained.
 */
/** Runtime PTY data: a Uint8Array (the binary Channel always delivers bytes). */
export type PtyPayload = Uint8Array;

/** Minimal PTY interface for flow control wiring (testable without full IPty). */
export interface FlowControlPty {
  onData: IEvent<PtyPayload>;
  pause(): void;
  resume(): void;
}

/** Wire PTY data to xterm with watermark-based flow control to prevent output lag. */
export function wirePtyFlowControl(
  pty: FlowControlPty,
  term: Pick<Terminal, "write">,
  disposed: () => boolean,
): void {
  let written = 0;
  let pendingCallbacks = 0;
  let paused = false;

  pty.onData((data) => {
    if (disposed()) return;
    // Zero-trust at the boundary: the binary Channel delivers a Uint8Array, but
    // drop anything else rather than crash on a malformed payload.
    if (!(data instanceof Uint8Array)) return;
    written += data.length;

    if (written > CALLBACK_BYTE_LIMIT) {
      term.write(data, () => {
        pendingCallbacks = Math.max(pendingCallbacks - 1, 0);
        if (paused && pendingCallbacks < LOW_WATERMARK) {
          paused = false;
          pty.resume();
        }
      });
      pendingCallbacks++;
      written = 0;
      if (!paused && pendingCallbacks > HIGH_WATERMARK) {
        paused = true;
        pty.pause();
      }
    } else {
      term.write(data);
    }
  });
}

/**
 * Spawn a PTY process connected to the terminal.
 * Reads shell from Tauri backend, accepts optional cwd, wires data streams.
 */
export async function spawnPty(options: SpawnOptions): Promise<IPty> {
  const { term, cwd, onExit, disposed } = options;

  // Fetch login shell PATH so CLI tools (node, claude, etc.) are discoverable.
  // macOS GUI apps have minimal PATH; this aligns with system terminal behavior.
  const loginPath = await resolveLoginShellPath();

  const configuredShell = useSettingsStore.getState().terminal.shell.trim();
  // Reject relative paths (security: prevent CWD/PATH hijack on Windows).
  // Only absolute paths are accepted: Unix (/) or Windows drive letter (C:\).
  const isAbsolute = configuredShell.startsWith("/") || /^[a-zA-Z]:[/\\]/.test(configuredShell);
  const safeShell = configuredShell && isAbsolute ? configuredShell : "";
  const defaultShell = safeShell || await invoke<string>("get_default_shell");
  // Defense-in-depth: verify the resolved shell is an absolute path
  const shellIsAbsolute = defaultShell.startsWith("/") || /^[a-zA-Z]:[/\\]/.test(defaultShell);
  const shell = shellIsAbsolute ? defaultShell : "/bin/sh";
  if (disposed()) throw new Error("disposed before spawn");
  const workspaceRoot = resolveTerminalWorkspaceRoot();

  const env: Record<string, string> = {
    // Ensure consistent color capabilities in xterm.js; Tauri GUI apps may not inherit terminal env vars.
    TERM: "xterm-256color",
    // Impersonate WezTerm so CLI tools with terminal allowlists (Claude Code's
    // /terminal-setup, etc.) recognize the host. See ADR-006. Do NOT change to "vmark".
    TERM_PROGRAM: "WezTerm",
    EDITOR: "vmark",
    // macOS GUI apps launched from Dock/Spotlight have minimal environment —
    // set UTF-8 encoding so the shell and tools handle CJK/multibyte correctly.
    // LC_CTYPE (not LANG) to only affect encoding without overriding the user's locale.
    LC_CTYPE: "UTF-8",
    // Inject login shell PATH so CLI tools (node, claude, etc.) are on PATH,
    // matching system terminal behavior on macOS GUI apps.
    PATH: loginPath,
  };
  if (workspaceRoot) {
    env.VMARK_WORKSPACE = workspaceRoot;
  }

  // Shell integration (WI-3.1): inject OSC 133 command marks + OSC 7 cwd via a
  // per-shell rc. The overrides are SHELL-SPECIFIC (e.g. ZDOTDIR points at a
  // zsh rc), so each shell gets its own fresh env — applying one shell's
  // overrides to a different (fallback) shell would poison its startup.
  // See terminalSpawnEnv.buildShellEnv.
  const shellIntegrationEnabled =
    useSettingsStore.getState().terminal.shellIntegration;

  const primaryEnv = await buildShellEnv(env, shell, shellIntegrationEnabled);
  // The session may have been disposed while awaiting shell integration.
  // Only checked when integration ran (it awaits IPC); without it there is
  // no await between here and spawn, so the original code skipped this check.
  if (shellIntegrationEnabled && disposed()) {
    throw new Error("disposed before spawn");
  }

  const baseSpawnOpts = { cols: term.cols || 80, rows: term.rows || 24, cwd };
  let pty: IPty;
  try {
    pty = spawn(shell, [], { ...baseSpawnOpts, env: primaryEnv });
  } catch (err) {
    // If configured shell fails, fall back to system default
    if (safeShell) {
      const fallback = await invoke<string>("get_default_shell");
      if (disposed()) throw new Error("disposed before fallback spawn");
      // Validate fallback shell is an absolute path (same check as primary shell)
      /* v8 ignore next 3 -- @preserve reason: platform-specific PTY fallback path; requires real shell spawning failure not reproducible in unit tests */
      const fallbackIsAbsolute = fallback.startsWith("/") || /^[a-zA-Z]:[/\\]/.test(fallback);
      const safeFallback = fallbackIsAbsolute ? fallback : "/bin/sh";
      // Recompute shell integration for the fallback shell — its overrides
      // differ from the failed configured shell's, and reusing them would
      // poison the default shell's startup.
      const fallbackEnv = await buildShellEnv(
        env,
        safeFallback,
        shellIntegrationEnabled,
      );
      if (disposed()) throw new Error("disposed before fallback spawn");
      pty = spawn(safeFallback, [], { ...baseSpawnOpts, env: fallbackEnv });
    } else {
      throw err;
    }
  }

  // PTY → xterm with watermark-based flow control
  wirePtyFlowControl(pty, term, disposed);

  // PTY exit
  pty.onExit(({ exitCode }) => {
    onExit(exitCode);
  });

  return pty;
}
