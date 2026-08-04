// Architecture-fitness test — MCP bridge filesystem path-guard invariant.
//
// Why this exists: the fs capability granted to document windows is broad
// (read/write/mkdir/copy/rename/remove on $HOME/**). The ONLY thing confining
// the MCP bridge to the workspace + open-document tree is call-site discipline:
// every handler that touches plugin-fs must first consult checkBridgePath().
// That discipline is invisible to the type system, so a future handler (e.g. a
// new vmark.document.rename or vmark.workspace.delete tool) could import
// @tauri-apps/plugin-fs and skip the guard with no compile error — re-opening
// the exact hole this branch closed.
//
// This test makes the invariant structural: any bridge source file that imports
// from @tauri-apps/plugin-fs MUST also reference checkBridgePath. If a new
// handler adds a raw fs import without wiring the guard, this goes red.
//
// Limitation: this proves the guard is *imported*, not that it is *called on
// the same path* before the write. It catches the "forgot the guard entirely"
// class — the realistic regression — not a deliberately mis-wired check. The
// per-handler behavior (denied path short-circuits before disk) is covered in
// workspace.test.ts / document.test.ts.
//
// @coordinates-with services/mcpBridge/bridgePathGuard.ts — checkBridgePath

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const BRIDGE_ROOT = resolve(__dirname, "..", "..");

/** Recursively collect non-test .ts source files under the bridge tree. */
function collectBridgeSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue;
      out.push(...collectBridgeSources(full));
      continue;
    }
    if (!entry.endsWith(".ts")) continue;
    if (entry.endsWith(".test.ts") || entry.endsWith(".d.ts")) continue;
    out.push(full);
  }
  return out;
}

const PLUGIN_FS_IMPORT = /from\s+["']@tauri-apps\/plugin-fs["']/;

describe("MCP bridge fs path-guard invariant", () => {
  const sources = collectBridgeSources(BRIDGE_ROOT);

  it("finds bridge source files to scan", () => {
    // Guard against the test silently passing because the glob found nothing
    // (e.g. the directory moved). There must be real handler files here.
    expect(sources.length).toBeGreaterThan(0);
  });

  it("every file importing @tauri-apps/plugin-fs also wires checkBridgePath", () => {
    const offenders = sources.filter((file) => {
      const src = readFileSync(file, "utf8");
      if (!PLUGIN_FS_IMPORT.test(src)) return false;
      return !src.includes("checkBridgePath");
    });

    expect(
      offenders,
      `These MCP bridge files import @tauri-apps/plugin-fs but never reference ` +
        `checkBridgePath — every bridge disk read/write must go through the ` +
        `path guard (services/mcpBridge/bridgePathGuard.ts). Wire the guard, or ` +
        `move the raw fs access out of the bridge surface:\n` +
        offenders.map((f) => `  - ${f}`).join("\n"),
    ).toEqual([]);
  });
});
