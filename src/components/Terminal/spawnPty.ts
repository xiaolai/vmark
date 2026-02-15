/**
 * spawnPty
 *
 * Purpose: Spawns a PTY (pseudo-terminal) process connected to an xterm instance.
 * Resolves the working directory, gets the default shell from Rust, and wires
 * up bidirectional data streams.
 *
 * Key decisions:
 *   - CWD priority: workspace root > active file's parent directory > shell default ($HOME).
 *   - Shell is determined by the Rust backend (get_default_shell), not hardcoded,
 *     to respect the user's configured shell on any platform.
 *   - Sets TERM_PROGRAM=vmark and EDITOR=vmark so CLI tools can detect the host.
 *   - Sets VMARK_WORKSPACE when a workspace is open, enabling shell scripts
 *     to access the workspace root.
 *   - The disposed() callback lets the caller abort if the session was removed
 *     while the async spawn was in flight.
 *
 * @coordinates-with useTerminalSessions.ts — calls spawnPty when starting a shell
 * @coordinates-with createTerminalInstance.ts — provides the xterm Terminal instance
 * @module components/Terminal/spawnPty
 */
import { spawn, type IPty } from "tauri-pty";
import { invoke } from "@tauri-apps/api/core";
import type { Terminal } from "@xterm/xterm";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
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
      if (lastSlash > 0) return doc.filePath.substring(0, lastSlash);
    }
  }

  return undefined;
}

export interface SpawnOptions {
  term: Terminal;
  cwd?: string;
  onExit: (exitCode: number) => void;
  disposed: () => boolean;
}

/**
 * Spawn a PTY process connected to the terminal.
 * Reads shell from Tauri backend, resolves cwd, wires data streams.
 */
export async function spawnPty(options: SpawnOptions): Promise<IPty> {
  const { term, cwd, onExit, disposed } = options;

  const shell = await invoke<string>("get_default_shell");
  if (disposed()) throw new Error("disposed before spawn");
  const workspaceRoot = useWorkspaceStore.getState().rootPath;

  const env: Record<string, string> = {
    TERM: "xterm-256color",
    TERM_PROGRAM: "vmark",
    EDITOR: "vmark",
  };
  if (workspaceRoot) {
    env.VMARK_WORKSPACE = workspaceRoot;
  }

  const pty = spawn(shell, [], {
    cols: term.cols || 80,
    rows: term.rows || 24,
    cwd,
    env,
  });

  // PTY → xterm
  pty.onData((data) => {
    if (!disposed()) term.write(data);
  });

  // PTY exit
  pty.onExit(({ exitCode }) => {
    onExit(exitCode);
  });

  return pty;
}
