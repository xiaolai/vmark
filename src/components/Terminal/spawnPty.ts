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
 *   - Sets TERM_PROGRAM=vmark and EDITOR=vmark so CLI tools can detect the host.
 *   - Injects login shell PATH via get_login_shell_path Tauri command so CLI
 *     tools (node, claude, etc.) are discoverable — macOS GUI apps have minimal
 *     PATH by default.
 *   - Sets LC_CTYPE=UTF-8 because macOS GUI apps have minimal env; without it
 *     the shell defaults to C locale and tools emit "?" for CJK characters.
 *     LC_CTYPE (not LANG) avoids overriding the user's full locale.
 *   - Sets VMARK_WORKSPACE when a workspace is open, enabling shell scripts
 *     to access the workspace root.
 *   - The disposed() callback lets the caller abort if the session was removed
 *     while the async spawn was in flight.
 *   - Watermark-based flow control pauses the PTY when xterm.js can't keep up
 *     with rapid output (e.g. AI tool redraws), preventing lag and freezes.
 *   - PTY data is coerced to Uint8Array before passing to xterm.js because
 *     Tauri event IPC serializes Rust Vec<u8> as a JSON number array, not a typed array.
 *
 * @coordinates-with useTerminalSessions.ts — calls spawnPty when starting a shell
 * @coordinates-with createTerminalInstance.ts — provides the xterm Terminal instance
 * @module components/Terminal/spawnPty
 */
import { spawn, type IPty, type IEvent } from "@/lib/pty";
import { invoke } from "@tauri-apps/api/core";
import type { Terminal } from "@xterm/xterm";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { getCurrentWindowLabel } from "@/utils/workspaceStorage";

/**
 * Resolve terminal working directory:
 * 1. Workspace root (if open)
 * 2. Active file's parent directory (if saved)
 * 3. undefined — lets the shell start in its default ($HOME)
 */
export function resolveTerminalCwd(): string | undefined {
  const workspaceRoot = useWorkspaceStore.getState().rootPath;
  if (workspaceRoot) return workspaceRoot;

  const windowLabel = getCurrentWindowLabel();
  const activeTabId = useTabStore.getState().activeTabId[windowLabel];
  if (activeTabId) {
    const doc = useDocumentStore.getState().getDocument(activeTabId);
    if (doc?.filePath) {
      const lastSlash = doc.filePath.lastIndexOf("/");
      // lastSlash === 0 means file is at filesystem root (e.g. /foo.md) → return "/"
      /* v8 ignore next 3 -- @preserve root-level or missing-slash paths not exercised in spawnPty tests */
      if (lastSlash === 0) return "/";
      if (lastSlash > 0) return doc.filePath.substring(0, lastSlash);
    }
  }

  return undefined;
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
 * xterm.js. We pause the PTY when too many write callbacks are pending,
 * and resume when the parser catches up.
 */
/** Runtime PTY data: real Uint8Array or JSON-deserialized number[] from Tauri IPC. */
export type PtyPayload = Uint8Array | number[];

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

  pty.onData((rawData) => {
    if (disposed()) return;
    // Tauri event IPC serializes Rust Vec<u8> as a JSON number array.
    // xterm.js needs a real Uint8Array for correct UTF-8 multibyte decoding (CJK, emoji, etc.).
    if (!(rawData instanceof Uint8Array) && !Array.isArray(rawData)) return;
    const data = rawData instanceof Uint8Array ? rawData : new Uint8Array(rawData);
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
  // Falls back to basic system paths if IPC fails or returns empty.
  let loginPath: string;
  try {
    loginPath = await invoke<string>("get_login_shell_path");
  } catch {
    loginPath = "";
  }
  if (!loginPath) {
    loginPath = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  }

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
  const workspaceRoot = useWorkspaceStore.getState().rootPath;

  const env: Record<string, string> = {
    // Ensure consistent color capabilities in xterm.js; Tauri GUI apps may not inherit terminal env vars.
    TERM: "xterm-256color",
    TERM_PROGRAM: "vmark",
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

  const spawnOpts = { cols: term.cols || 80, rows: term.rows || 24, cwd, env };
  let pty: IPty;
  try {
    pty = spawn(shell, [], spawnOpts);
  } catch (err) {
    // If configured shell fails, fall back to system default
    if (safeShell) {
      const fallback = await invoke<string>("get_default_shell");
      if (disposed()) throw new Error("disposed before fallback spawn");
      // Validate fallback shell is an absolute path (same check as primary shell)
      /* v8 ignore next 3 -- @preserve reason: platform-specific PTY fallback path; requires real shell spawning failure not reproducible in unit tests */
      const fallbackIsAbsolute = fallback.startsWith("/") || /^[a-zA-Z]:[/\\]/.test(fallback);
      const safeFallback = fallbackIsAbsolute ? fallback : "/bin/sh";
      pty = spawn(safeFallback, [], spawnOpts);
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
