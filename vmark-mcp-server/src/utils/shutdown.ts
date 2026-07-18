/**
 * Graceful-shutdown wiring for the sidecar process.
 *
 * Purpose: Build a double-invocation-safe shutdown handler and attach it to
 * every terminate trigger the sidecar can receive — SIGINT/SIGTERM and, for
 * orphan detection, stdin EOF/close. The stdio MCP transport closing means
 * the parent AI client exited; without this the sidecar would run forever,
 * kept alive by reconnect timers, occupying a bridge slot in VMark.
 *
 * @coordinates-with cli.ts (main entry wiring)
 */

/** Minimal process surface needed for shutdown wiring (testable). */
export interface ShutdownProcess {
  on(event: string, listener: () => void): unknown;
  stdin: {
    on(event: string, listener: () => void): unknown;
    /** True once the stream was read to EOF (Node Readable). */
    readableEnded?: boolean;
    /** True once the underlying descriptor was destroyed (Node Stream). */
    destroyed?: boolean;
  };
}

/**
 * Create a shutdown handler that runs `cleanup` at most once, swallows
 * cleanup errors, and then calls `exit(0)`.
 */
export function createShutdownHandler(
  cleanup: () => Promise<void>,
  exit: (code: number) => void,
): () => Promise<void> {
  let shuttingDown = false;
  return async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await cleanup();
    } catch {
      // Ignore errors during shutdown
    }
    exit(0);
  };
}

/**
 * Attach a shutdown handler to signals and to stdio transport closure.
 *
 * Both 'end' and 'close' are wired for stdin: 'end' fires when the stream is
 * read to EOF (the MCP stdio transport does read it), 'close' when the
 * underlying descriptor closes.
 *
 * If stdin already ended or was destroyed BEFORE registration (EOF during
 * the startup window: bridge connect / MCP transport setup), those events
 * have already fired and will never fire again — invoke the handler
 * immediately instead of leaving an orphaned sidecar running forever.
 */
export function registerShutdownTriggers(
  proc: ShutdownProcess,
  handler: () => void,
): void {
  proc.on('SIGINT', handler);
  proc.on('SIGTERM', handler);
  proc.stdin.on('end', handler);
  proc.stdin.on('close', handler);

  if (proc.stdin.readableEnded || proc.stdin.destroyed) {
    handler();
  }
}
