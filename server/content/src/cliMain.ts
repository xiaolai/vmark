/**
 * vmark-content-server CLI core — everything cli.ts does, with injected
 * dependencies so argument handling, startup failure, and signal-driven
 * shutdown are unit-testable (cli.ts stays a minimal process wrapper).
 *
 * @coordinates-with cli.ts — binds real process/env/server dependencies
 * @module cliMain
 */

export interface CliArgs {
  root?: string;
  token?: string;
  port?: number;
  portFile?: string;
}

export interface CliServer {
  url: string;
  close: () => Promise<void>;
}

export interface CliDeps {
  startServer: (opts: {
    root: string;
    bootstrapToken: string;
    port?: number;
    portFile?: string;
  }) => Promise<CliServer>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: Record<string, string | undefined>;
  exit: (code: number) => void;
  onSignal: (signal: "SIGINT" | "SIGTERM", handler: () => void) => void;
  /** Watchdog timer pair — cli.ts binds real (unref'd) timers. */
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  version: string;
}

/** How long a close() may take before the watchdog force-exits. */
export const SHUTDOWN_TIMEOUT_MS = 10_000;

/** A flag's value must be a real value — a following flag means it's missing. */
function flagValue(argv: string[], i: number, flag: string): string {
  const value = argv[i + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  const seen = new Set<string>();
  const once = (flag: string) => {
    // Last-value-wins for a duplicated --root/--token is ambiguous at best
    // and an operator error at worst — refuse it.
    if (seen.has(flag)) throw new Error(`Duplicate argument: ${flag}`);
    seen.add(flag);
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") {
      once(a);
      args.root = flagValue(argv, i++, "--root");
    } else if (a === "--token") {
      once(a);
      args.token = flagValue(argv, i++, "--token");
    } else if (a === "--port") {
      once(a);
      const raw = flagValue(argv, i++, "--port");
      // Strict decimal only: Number() would accept "", "0x50", "1e3".
      if (!/^\d+$/.test(raw)) throw new Error("--port must be a decimal integer");
      args.port = Number(raw);
    } else if (a === "--port-file") {
      once(a);
      args.portFile = flagValue(argv, i++, "--port-file");
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

interface StartupConfig {
  root: string;
  bootstrapToken: string;
  port?: number;
  portFile?: string;
}

/**
 * Parse and validate argv into a startup config. Emits the error and exits 2
 * (returning null) on any invalid input.
 */
function resolveStartupConfig(argv: string[], deps: CliDeps): StartupConfig | null {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    deps.stderr(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    deps.exit(2);
    return null;
  }
  const root = args.root ?? deps.env.VMARK_CS_ROOT;
  const token = args.token ?? deps.env.VMARK_CS_TOKEN;
  if (!root || !token) {
    deps.stderr("error: --root and --token (or VMARK_CS_ROOT/VMARK_CS_TOKEN) required\n");
    deps.exit(2);
    return null;
  }
  if (args.port !== undefined && (!Number.isInteger(args.port) || args.port < 0 || args.port > 65535)) {
    deps.stderr("error: --port must be an integer in 0-65535\n");
    deps.exit(2);
    return null;
  }
  return { root, bootstrapToken: token, port: args.port, portFile: args.portFile };
}

/**
 * Register idempotent signal-driven shutdown with a force-exit watchdog: a
 * close() that never settles would otherwise leave `closing` latched and
 * every later signal ignored — a process only SIGKILL could end.
 */
function registerShutdown(server: CliServer, deps: CliDeps): void {
  let closing = false;
  const shutdown = async () => {
    // Idempotent: a second SIGINT/SIGTERM while closing must not close twice.
    if (closing) return;
    closing = true;
    const watchdog = deps.setTimer(() => {
      deps.stderr(`shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms; forcing exit\n`);
      deps.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    try {
      await server.close();
      deps.clearTimer(watchdog);
      deps.exit(0);
    } catch (err) {
      // A failed close must exit nonzero, not become an unhandled rejection
      // that leaves the process alive and every later signal ignored.
      deps.clearTimer(watchdog);
      deps.stderr(`shutdown failed: ${err instanceof Error ? err.message : String(err)}\n`);
      deps.exit(1);
    }
  };
  deps.onSignal("SIGINT", shutdown);
  deps.onSignal("SIGTERM", shutdown);
}

export async function runCli(argv: string[], deps: CliDeps): Promise<void> {
  if (argv.includes("--version")) {
    deps.stdout(`${deps.version}\n`);
    return;
  }

  const config = resolveStartupConfig(argv, deps);
  if (!config) return;

  let server: CliServer;
  try {
    server = await deps.startServer(config);
  } catch (err) {
    deps.stderr(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    deps.exit(1);
    return;
  }

  deps.stdout(`vmark-content-server listening ${server.url}\n`);
  registerShutdown(server, deps);
}
