// @vitest-environment node
/**
 * Cross-layer parity check for the browser wait bound (audit 2026-09-03, timing).
 *
 * The bound exists in two places that cannot share a constant surface (React app,
 * npm sidecar) and must stay BELOW the bridge's first 10 s deadline
 * (src-tauri/src/mcp_bridge/server.rs), or a healthy slow wait trips the bridge's
 * wake-and-retry recovery. Until this test the relationship was prose.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_WAIT_MS } from "@/services/mcpBridge/v2/browserHelpers";

const ROOT = process.cwd();

function extract(relPath: string, pattern: RegExp): number {
  const match = readFileSync(join(ROOT, relPath), "utf8").match(pattern);
  if (!match) throw new Error(`declaration not found in ${relPath}`);
  return Number(match[1].replace(/_/g, ""));
}

describe("MAX_WAIT_MS parity across webview, sidecar and the bridge deadline", () => {
  it("the sidecar advertises the same bound the webview enforces", () => {
    const sidecar = extract("server/mcp/src/tools/browserArgs.ts", /export const MAX_WAIT_MS = ([0-9_]+);/);
    expect(sidecar).toBe(MAX_WAIT_MS);
  });

  it("the bound is below the bridge's first response deadline", () => {
    const seconds = extract(
      "src-tauri/src/mcp_bridge/server.rs",
      /tokio::time::timeout\(Duration::from_secs\(([0-9_]+)\), response_rx\)/,
    );
    expect(MAX_WAIT_MS).toBeLessThan(seconds * 1000);
  });
});
