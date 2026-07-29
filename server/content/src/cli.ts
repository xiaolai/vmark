#!/usr/bin/env node
/**
 * vmark-content-server CLI — the entry VMark's Rust ContentServerManager
 * spawns. Reads config from flags/env, starts the KB server, and shuts down
 * cleanly on SIGINT/SIGTERM.
 *
 * Usage:
 *   vmark-content-server --root <dir> --token <bootstrap> [--port N] [--port-file P]
 *
 * @module cli
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startKbServer } from "./server/runtime.js";

/** Read version from the package manifest (grill L4 — no hardcoded drift point). */
function readVersion(): string {
  try {
    const pkgUrl = new URL("../package.json", import.meta.url);
    return JSON.parse(readFileSync(fileURLToPath(pkgUrl), "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
const VERSION = readVersion();

interface Args {
  root?: string;
  token?: string;
  port?: number;
  portFile?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") args.root = argv[++i];
    else if (a === "--token") args.token = argv[++i];
    else if (a === "--port") args.port = Number(argv[++i]);
    else if (a === "--port-file") args.portFile = argv[++i];
  }
  return args;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--version")) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  const args = parseArgs(argv);
  const root = args.root ?? process.env.VMARK_CS_ROOT;
  const token = args.token ?? process.env.VMARK_CS_TOKEN;
  if (!root || !token) {
    process.stderr.write("error: --root and --token (or VMARK_CS_ROOT/VMARK_CS_TOKEN) required\n");
    process.exit(2);
  }

  const server = await startKbServer({
    root,
    bootstrapToken: token,
    port: args.port,
    portFile: args.portFile,
  });

  process.stdout.write(`vmark-content-server listening ${server.url}\n`);

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
