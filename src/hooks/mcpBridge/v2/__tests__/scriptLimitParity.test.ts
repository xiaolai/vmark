/**
 * Cross-layer parity check for the browser script size limit.
 *
 * The 64 KiB bound exists in THREE places that cannot share a constant
 * surface (Rust crate, React app, npm sidecar):
 *   - src-tauri/src/browser/script_limit.rs   (authoritative gate)
 *   - src/hooks/mcpBridge/v2/browserPower.ts  (webview mirror)
 *   - server/mcp/src/tools/browserArgs.ts     (sidecar mirror)
 *
 * The duplication is structural (documented in script_limit.rs), but until
 * this test it was only PROSE — nothing failed when a copy drifted. This
 * extracts each declaration from source and fails on any divergence.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function extractLimit(relPath: string, pattern: RegExp): number {
  const source = readFileSync(join(ROOT, relPath), "utf8");
  const match = source.match(pattern);
  if (!match) {
    throw new Error(`MAX_SCRIPT_BYTES declaration not found in ${relPath}`);
  }
  // Declarations are `<a> * <b>` products or plain integers.
  const parts = match[1].split("*").map((part) => Number(part.trim()));
  if (parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`Unparseable MAX_SCRIPT_BYTES value in ${relPath}: ${match[1]}`);
  }
  return parts.reduce((a, b) => a * b, 1);
}

describe("MAX_SCRIPT_BYTES parity across Rust, webview, and sidecar", () => {
  it("all three declarations agree", () => {
    const rust = extractLimit(
      "src-tauri/src/browser/script_limit.rs",
      /const MAX_SCRIPT_BYTES:\s*usize\s*=\s*([0-9*\s]+);/
    );
    const webview = extractLimit(
      "src/hooks/mcpBridge/v2/browserPower.ts",
      /const MAX_SCRIPT_BYTES\s*=\s*([0-9*\s]+);/
    );
    const sidecar = extractLimit(
      "server/mcp/src/tools/browserArgs.ts",
      /const MAX_SCRIPT_BYTES\s*=\s*([0-9*\s]+);/
    );

    expect(webview).toBe(rust);
    expect(sidecar).toBe(rust);
    expect(rust).toBe(64 * 1024);
  });
});
