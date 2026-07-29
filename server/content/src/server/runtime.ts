/**
 * KB server runtime (Phase 1/4) — boots the index, HTTP server, and watcher,
 * and writes the loopback port-file VMark reads to discover the server.
 *
 * This is the in-process KB child of the supervisor (ADR-10): the supervisor
 * owns this plus the on-demand Slidev child; if Slidev dies, this stays up.
 *
 * @module server/runtime
 */

import { serve } from "@hono/node-server";
import { promises as fs } from "node:fs";
import { buildIndex, type WorkspaceIndex } from "../index/buildIndex";
import { watchWorkspace, type WorkspaceWatcher } from "../index/watch";
import { createContentServer } from "./createServer";
import { stderrLogger, noopLogger, type Logger } from "./logger";

export interface KbServerOptions {
  root: string;
  /** Preferred port; 0 lets the OS assign one (recommended). */
  port?: number;
  bootstrapToken: string;
  /** Path to write `{port, token}` JSON for VMark to discover. */
  portFile?: string;
  /** Trusted workspace → relaxed CSP img-src (§3bis). */
  trusted?: boolean;
  /** Logger; defaults to stderr JSON so the supervisor can forward it. */
  logger?: Logger;
}

export interface RunningKbServer {
  port: number;
  url: string;
  close: () => Promise<void>;
}

/** Start the KB server: index → HTTP listen → watcher → port-file. */
export async function startKbServer(options: KbServerOptions): Promise<RunningKbServer> {
  const log = options.logger ?? (options.portFile ? stderrLogger : noopLogger);
  let index: WorkspaceIndex = await buildIndex(options.root);
  let watcher: WorkspaceWatcher | null = null;
  const server = createContentServer({
    root: options.root,
    bootstrapToken: options.bootstrapToken,
    getIndex: () => index,
    trusted: options.trusted,
    logger: log,
    // grill H10 — real liveness from the watcher.
    health: () => ({
      watcherAlive: watcher ? watcher.alive() : true,
      lastError: watcher ? watcher.lastError() : null,
    }),
  });

  watcher = watchWorkspace(options.root, (next, changed) => {
    index = next;
    server.notifyReload(changed);
  });

  // Listen, surfacing EADDRINUSE etc. instead of hanging forever (grill).
  const { node, port } = await new Promise<{
    node: ReturnType<typeof serve>;
    port: number;
  }>((resolve, reject) => {
    const handle = serve(
      { fetch: server.app.fetch, hostname: "127.0.0.1", port: options.port ?? 0 },
      (info) => resolve({ node: handle, port: info.port })
    );
    (handle as unknown as { on: (e: string, cb: (err: Error) => void) => void }).on(
      "error",
      reject
    );
  }).catch(async (err) => {
    await watcher?.close();
    throw err;
  });
  const url = `http://127.0.0.1:${port}`;

  if (options.portFile) {
    try {
      // grill M5 — atomic write via tmp + rename so readers never see a partial.
      const tmp = `${options.portFile}.tmp`;
      await fs.writeFile(tmp, JSON.stringify({ port, token: options.bootstrapToken }), {
        mode: 0o600,
      });
      await fs.rename(tmp, options.portFile);
    } catch (err) {
      // grill H10 — don't leak a listening server we can't advertise.
      await watcher.close();
      await new Promise<void>((resolve) => node.close(() => resolve()));
      throw err;
    }
  }

  return {
    port,
    url,
    close: async () => {
      await watcher?.close();
      await server.stopSlidev(); // Codex audit: don't leak Slidev dev servers
      await new Promise<void>((resolve) => node.close(() => resolve()));
      if (options.portFile) await fs.rm(options.portFile, { force: true });
    },
  };
}
