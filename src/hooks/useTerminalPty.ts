import { useEffect, useCallback, useRef, type MutableRefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useTerminalStore } from "@/stores/terminalStore";
import type { Terminal } from "@xterm/xterm";

interface PtySession {
  id: string;
  cols: number;
  rows: number;
}

interface PtyOutput {
  sessionId: string;
  data: string;
}

interface PtyExit {
  sessionId: string;
  code: number | null;
}

/**
 * Hook to manage PTY connection for a terminal session.
 *
 * Handles:
 * - Spawning PTY session on mount
 * - Forwarding PTY output to xterm.js
 * - Sending user input to PTY
 * - Cleaning up on unmount
 *
 * @param terminalRef - Reference to the xterm.js Terminal instance
 * @param processData - Optional function to process data before writing to terminal
 * @param onSessionCreated - Callback when PTY session is created
 * @param onSessionEnded - Callback when PTY session ends
 */
export function useTerminalPty(
  terminalRef: MutableRefObject<Terminal | null>,
  processData?: (data: string) => string,
  onSessionCreated?: (sessionId: string) => void,
  onSessionEnded?: (sessionId: string) => void
) {
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const sessionIdRef = useRef<string | null>(null);
  const unlistenOutputRef = useRef<UnlistenFn | null>(null);
  const unlistenExitRef = useRef<UnlistenFn | null>(null);

  // Send input to PTY
  const sendInput = useCallback((data: string) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;

    invoke("pty_write", { sessionId, data }).catch((err) => {
      console.error("[PTY] Write error:", err);
    });
  }, []);

  // Spawn PTY on mount
  useEffect(() => {
    let mounted = true;

    const spawnPty = async () => {
      try {
        // Spawn PTY with workspace root as cwd
        const session = await invoke<PtySession>("pty_spawn", {
          cwd: rootPath || undefined,
          cols: 80,
          rows: 24,
        });

        if (!mounted) {
          // Component unmounted, kill the session
          await invoke("pty_kill", { sessionId: session.id });
          return;
        }

        sessionIdRef.current = session.id;
        onSessionCreated?.(session.id);

        // Listen for PTY output
        unlistenOutputRef.current = await listen<PtyOutput>("pty:output", (event) => {
          if (event.payload.sessionId !== sessionIdRef.current) return;
          // Process data through markdown filter if available
          const data = processData ? processData(event.payload.data) : event.payload.data;
          terminalRef.current?.write(data);
        });

        // Listen for PTY exit
        unlistenExitRef.current = await listen<PtyExit>("pty:exit", (event) => {
          if (event.payload.sessionId !== sessionIdRef.current) return;

          const exitCode = event.payload.code;
          terminalRef.current?.writeln("");
          terminalRef.current?.writeln(
            `\x1b[90m[Process exited with code ${exitCode ?? "unknown"}]\x1b[0m`
          );

          const endedSessionId = sessionIdRef.current;
          sessionIdRef.current = null;
          if (endedSessionId) {
            onSessionEnded?.(endedSessionId);
          }
        });
      } catch (err) {
        console.error("[PTY] Spawn error:", err);
        terminalRef.current?.writeln(
          `\x1b[31mError: Failed to start terminal: ${err}\x1b[0m`
        );
      }
    };

    spawnPty();

    return () => {
      mounted = false;

      // Cleanup listeners
      if (unlistenOutputRef.current) {
        unlistenOutputRef.current();
        unlistenOutputRef.current = null;
      }
      if (unlistenExitRef.current) {
        unlistenExitRef.current();
        unlistenExitRef.current = null;
      }

      // Kill PTY session
      const sessionId = sessionIdRef.current;
      if (sessionId) {
        invoke("pty_kill", { sessionId }).catch((err) => {
          console.error("[PTY] Kill error:", err);
        });
        sessionIdRef.current = null;
      }
    };
  }, [rootPath, terminalRef, processData, onSessionCreated, onSessionEnded]);

  return {
    sessionId: sessionIdRef.current,
    sendInput,
  };
}

/**
 * Hook to use the terminal store for session management.
 * Returns functions to add/remove sessions from the store.
 */
export function useTerminalSessions() {
  const addSession = useTerminalStore((state) => state.addSession);
  const removeSession = useTerminalStore((state) => state.removeSession);
  const rootPath = useWorkspaceStore((state) => state.rootPath);

  const createSession = useCallback(
    (sessionId: string) => {
      addSession({
        id: sessionId,
        title: `Terminal ${useTerminalStore.getState().sessions.length + 1}`,
        cwd: rootPath || undefined,
        createdAt: Date.now(),
      });
    },
    [addSession, rootPath]
  );

  return { createSession, removeSession };
}
