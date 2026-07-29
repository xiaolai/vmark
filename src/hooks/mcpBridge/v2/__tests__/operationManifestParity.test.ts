/**
 * Cross-language parity proof for the bridge operation manifest (WI-1).
 *
 * Extracts the `vmark.*` operation surface from all four source-of-truth
 * sites and fails when any operation is missing from the manifest, present
 * in the manifest but absent from its owning surface, or classified with a
 * different effect than the code enforces:
 *   - dispatch.ts case labels        == manifest owner:"webview"
 *   - core-types.ts wire types       == manifest (all operations)
 *   - state.rs read-only matches!    == manifest owner:"webview" effect:"read"
 *   - routing.rs coherence arms      == manifest owner:"rust"
 *   - routing.rs write-guard ops     == manifest owner:"rust" effect:"write"
 *
 * Unknown operations remain fail-closed as writes on the Rust side (the
 * `matches!` default; pinned by state.test.rs) — this test proves the
 * declared surface, Rust proves the default.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BRIDGE_OPERATIONS, operationsWhere } from "../operationManifest";

const ROOT = process.cwd();

function source(relPath: string): string {
  return readFileSync(join(ROOT, relPath), "utf8");
}

function extract(text: string, pattern: RegExp): string[] {
  const out = new Set<string>();
  for (const match of text.matchAll(pattern)) out.add(match[1]);
  return [...out].sort();
}

const manifestAll = Object.keys(BRIDGE_OPERATIONS).sort();
const manifestWebview = operationsWhere((op) => op.owner === "webview");
const manifestWebviewReads = operationsWhere(
  (op) => op.owner === "webview" && op.effect === "read"
);
const manifestRust = operationsWhere((op) => op.owner === "rust");
const manifestRustWrites = operationsWhere(
  (op) => op.owner === "rust" && op.effect === "write"
);

describe("bridge operation manifest parity", () => {
  it("webview dispatcher cases match the manifest exactly", () => {
    const cases = extract(
      source("src/hooks/mcpBridge/v2/dispatch.ts"),
      /case "(vmark\.[^"]+)":/g
    );
    expect(cases).toEqual(manifestWebview);
  });

  it("sidecar wire types match the manifest exactly", () => {
    const wire = extract(
      source("server/mcp/src/bridge/core-types.ts"),
      /type: '(vmark\.[^']+)'/g
    );
    expect(wire).toEqual(manifestAll);
  });

  it("Rust read-only classifier matches the manifest's webview reads exactly", () => {
    // After the audit-20260729 cleanup, state.rs contains vmark.* literals
    // ONLY inside is_read_only_operation's matches! block.
    const rustReads = extract(
      source("src-tauri/src/mcp_bridge/state.rs"),
      /"(vmark\.[^"]+)"/g
    );
    expect(rustReads).toEqual(manifestWebviewReads);
  });

  it("Rust-answered coherence arms match the manifest's rust owners exactly", () => {
    const routing = source("src-tauri/src/mcp_bridge/routing.rs");
    const answers = source("src-tauri/src/mcp_bridge/coherence_answers.rs");
    const routingArms = extract(routing, /"(vmark\.coherence\.[^"]+)"/g);
    const answerArms = extract(answers, /"(vmark\.coherence\.[^"]+)" =>/g);
    expect(routingArms).toEqual(manifestRust);
    expect(answerArms).toEqual(manifestRust);
  });

  it("routing's coherence write-guard matches the manifest's rust writes exactly", () => {
    const routing = source("src-tauri/src/mcp_bridge/routing.rs");
    const guarded = extract(
      routing,
      /request_type\s*==\s*"(vmark\.coherence\.[^"]+)"/g
    );
    expect(guarded).toEqual(manifestRustWrites);
  });

  it("every manifest operation has a valid owner/effect", () => {
    for (const [name, op] of Object.entries(BRIDGE_OPERATIONS)) {
      expect(name.startsWith("vmark."), `${name} must be vmark.*`).toBe(true);
      expect(["webview", "rust"]).toContain(op.owner);
      expect(["read", "write"]).toContain(op.effect);
    }
  });
});
