/**
 * Slidev dev-server wrapper (Phase 6, WI-6.2).
 *
 * Lazily loads `@slidev/cli` (provisioned separately per ADR-2 — NOT a hard
 * dependency of this package) and boots a Vite dev server against an arbitrary
 * deck. Validated live in spike S0.2 (createServer/resolveOptions, 341ms boot,
 * clean close). The Slidev module is injectable so the wiring is unit-testable
 * without the 451 MB tree present.
 *
 * @module slidev/server
 */

/** Minimal shape of the bits of `@slidev/cli` we use (verified in S0.2). */
export interface SlidevModule {
  resolveOptions: (entryOptions: { entry: string; theme?: string }, mode: string) => Promise<unknown>;
  createServer: (
    options: unknown,
    viteConfig: Record<string, unknown>
  ) => Promise<{
    listen: () => Promise<void>;
    close: () => Promise<void>;
    httpServer?: { address: () => { port: number } | string | null } | null;
    config: { server: { port?: number } };
  }>;
}

export interface SlidevServerOptions {
  /** Absolute path to the deck `.md`. */
  entry: string;
  /** Preferred port; 0 → OS-assigned. */
  port?: number;
  /** Vite base path so the server can be reverse-proxied under the KB origin. */
  base?: string;
  /** Inject the Slidev module (defaults to dynamic import of the provisioned pkg). */
  loadSlidev?: () => Promise<SlidevModule>;
}

export interface RunningSlidev {
  port: number;
  url: string;
  close: () => Promise<void>;
}

const defaultLoad = (): Promise<SlidevModule> => {
  // The provisioned Slidev bundle is resolved at runtime; the package is NOT a
  // build-time dependency. The specifier is indirected through a variable so
  // tsc does not attempt static module resolution of a package that only exists
  // after first-use provisioning (ADR-2).
  const specifier = "@slidev/cli";
  return import(/* @vite-ignore */ specifier) as unknown as Promise<SlidevModule>;
};

/** Start a Slidev dev server for `entry`; resolves once listening. */
export async function startSlidevServer(options: SlidevServerOptions): Promise<RunningSlidev> {
  const load = options.loadSlidev ?? defaultLoad;
  const slidev = await load();
  const resolved = await slidev.resolveOptions({ entry: options.entry }, "dev");
  const viteConfig: Record<string, unknown> = {
    server: { port: options.port ?? 0, host: "127.0.0.1" },
    logLevel: "silent",
  };
  if (options.base) viteConfig.base = options.base;
  const server = await slidev.createServer(resolved, viteConfig);
  // Codex audit: if listen() fails, close the partially-created Vite server.
  try {
    await server.listen();
  } catch (e) {
    await server.close().catch(() => {});
    throw e;
  }

  const addr = server.httpServer?.address();
  const port =
    typeof addr === "object" && addr ? addr.port : server.config.server.port ?? options.port ?? 0;

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    close: () => server.close(),
  };
}
