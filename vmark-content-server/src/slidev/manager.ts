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
      pending = startSlidevServer({ entry: deck, base: "/slidev/", loadSlidev: this.loadSlidev });
      this.starting.set(deck, pending);
      pending
        .then((server) => this.servers.set(deck, server))
        .finally(() => this.starting.delete(deck));
    }
    const server = await pending;
    return { deck, subPort: server.port };
  }

  /** Stop one deck's server (KB server is unaffected — ADR-10). */
  async stop(deck: string): Promise<void> {
    const server = this.servers.get(deck);
    if (server) {
      this.servers.delete(deck);
      await server.close();
    }
  }

  /** Stop all Slidev servers (on shutdown). */
  async stopAll(): Promise<void> {
    const all = [...this.servers.values()];
    this.servers.clear();
    await Promise.all(all.map((s) => s.close()));
  }

  /** The sub-port serving `deck`, if running. */
  subPort(deck: string): number | undefined {
    return this.servers.get(deck)?.port;
  }

  count(): number {
    return this.servers.size;
  }
}
