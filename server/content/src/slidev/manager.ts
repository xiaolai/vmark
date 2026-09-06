/**
 * Slidev supervisor (Phase 6, C2/C4). Owns at most one Slidev dev server per
 * deck, started with base `/slidev/` so it can be reverse-proxied under the KB
 * origin (single authed origin — ADR-9). Reuses a running server for the same
 * deck; closing one deck's server doesn't affect the KB server (ADR-10).
 *
 * @module slidev/manager
 */

import { startSlidevServer, type RunningSlidev, type SlidevModule } from "./server";

export interface SlidevHandle {
  deck: string;
  subPort: number;
}

export class SlidevManager {
  private servers = new Map<string, RunningSlidev>();
  /** In-flight starts, so concurrent start(deck) don't spawn duplicates. */
  private starting = new Map<string, Promise<RunningSlidev>>();
  /** True while `stopAll` runs, so a late start closes instead of registering. */
  private closing = false;
  private loadSlidev?: () => Promise<SlidevModule>;

  /** `loadSlidev` is injectable for tests; production uses the dynamic import. */
  constructor(loadSlidev?: () => Promise<SlidevModule>) {
    this.loadSlidev = loadSlidev;
  }

  /** Start (or reuse) a Slidev server for `deck`; returns its loopback sub-port. */
  async start(deck: string): Promise<SlidevHandle> {
    const existing = this.servers.get(deck);
    if (existing) return { deck, subPort: existing.port };
    // Codex audit: coalesce concurrent starts for the same deck.
    let pending = this.starting.get(deck);
    if (!pending) {
      pending = this.beginStart(deck);
      this.starting.set(deck, pending);
    }
    const server = await pending;
    return { deck, subPort: server.port };
  }

  /**
   * The whole startup lifecycle, in ONE promise.
   *
   * This used to be a `.then(...).finally(...)` chain DERIVED from the startup
   * promise. `start()` awaited the original, so its caller saw a failure and
   * the route returned 500 — but the derived chain rejected too, with nobody
   * observing it. Node's default action for an unhandled rejection is to
   * terminate the process, so an ordinary bad deck took down the whole
   * knowledge-base server and every preview sharing it (audit 20260906,
   * MCP-C01).
   *
   * Owning the bookkeeping inside the awaited promise means there is no second
   * chain to go unobserved. Retry after a failure still works — the entry is
   * removed in `finally` — and same-deck coalescing is unchanged.
   */
  private async beginStart(deck: string): Promise<RunningSlidev> {
    try {
      const server = await startSlidevServer({
        entry: deck,
        base: "/slidev/",
        loadSlidev: this.loadSlidev,
      });

      // A stop() or stopAll() that ran while this was starting OWNS the
      // outcome. Registering the server now would resurrect a deck the caller
      // has already shut down, leaving an unproxied server running past
      // shutdown (audit 20260906, MCP-C04). Both cancellers remove the entry
      // from `starting`, so its absence is the cancellation signal.
      if (this.closing || !this.starting.has(deck)) {
        await server.close();
        throw new Error(`Slidev startup for ${deck} was cancelled by shutdown`);
      }

      this.servers.set(deck, server);
      return server;
    } finally {
      this.starting.delete(deck);
    }
  }

  /** Stop one deck's server (KB server is unaffected — ADR-10). */
  async stop(deck: string): Promise<void> {
    // Cancel an in-flight start FIRST, then wait for it: a start that is
    // already past the point of no return has to be closed, not abandoned.
    const pending = this.starting.get(deck);
    if (pending) {
      this.starting.delete(deck);
      await pending.catch(() => {});
    }

    const server = this.servers.get(deck);
    if (server) {
      this.servers.delete(deck);
      await server.close();
    }
  }

  /** Stop all Slidev servers (on shutdown). */
  async stopAll(): Promise<void> {
    this.closing = true;
    try {
      // `stopAll` used to snapshot only the COMPLETED servers, so a start
      // still in flight inserted itself afterwards and outlived the shutdown:
      // the manager reported 0 servers, then reported 1 once the pending
      // startup resolved.
      const pendingStarts = [...this.starting.values()];
      this.starting.clear();
      await Promise.all(pendingStarts.map((p) => p.catch(() => {})));

      const all = [...this.servers.values()];
      this.servers.clear();
      await Promise.all(all.map((s) => s.close()));
    } finally {
      // The manager stays reusable — the in-process runtime can be restarted.
      this.closing = false;
    }
  }

  /** The sub-port serving `deck`, if running. */
  subPort(deck: string): number | undefined {
    return this.servers.get(deck)?.port;
  }

  count(): number {
    return this.servers.size;
  }
}
