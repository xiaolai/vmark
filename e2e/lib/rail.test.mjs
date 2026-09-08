/**
 * Unit tests for the workspace-rail E2E helpers — the parts that need no live
 * app. The journeys themselves are driven by `e2e/run-journeys.mjs`; this file
 * covers the two places where the harness can be wrong SILENTLY.
 *
 * @coordinates-with e2e/lib/rail.mjs — the subject
 * @module e2e/lib/rail.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const evalJs = vi.fn();
vi.mock("./bridge.mjs", () => ({ evalJs: (...args) => evalJs(...args) }));

const { getRailInstances, shippedRailModeDefault } = await import("./rail.mjs");

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

beforeEach(() => {
  evalJs.mockReset();
});

// audit R3 #3 — `withRailMode` pushes a value through the storage event to
// reset the LIVE store (deleting the persisted key alone cannot: the reconciler
// deep-merges). That value used to be a hardcoded `false` — today's default
// copied into the harness — so flipping `defaults.ts` would have left every
// journey restoring the wrong live state with nothing to notice.
describe("shippedRailModeDefault", () => {
  it("reads the value the app actually ships", () => {
    const defaults = readFileSync(join(REPO, "src/stores/settingsStore/defaults.ts"), "utf8");
    const declared = /^\s*workspaceRailMode:\s*(true|false)\s*,/m.exec(defaults);
    expect(declared, "defaults.ts must declare a boolean workspaceRailMode").not.toBeNull();
    expect(shippedRailModeDefault()).toBe(declared[1] === "true");
    expect(typeof shippedRailModeDefault()).toBe("boolean");
  });

  it("tracks a flipped default instead of restoring a stale literal", () => {
    expect(shippedRailModeDefault("  workspaceRailMode: true,\n")).toBe(true);
    expect(shippedRailModeDefault("  workspaceRailMode: false,\n")).toBe(false);
  });

  it("throws when the key is gone — a fallback would be the hardcoded default under another name", () => {
    expect(() => shippedRailModeDefault("  openInNewTab: false,\n")).toThrow(
      /no longer declares a boolean `workspaceRailMode` default/,
    );
  });
});

// audit R3 #6 — `data-instance-id` is the rail's automation contract, and every
// consumer treats it as a string (`isPlaceholder` calls `startsWith`, restoreRail
// puts it in a Set). A missing attribute is `null`, and the first symptom was a
// bare TypeError from a one-line arrow several calls away from the cause.
describe("getRailInstances", () => {
  it("returns the snapshot when every entry carries its id", async () => {
    evalJs.mockResolvedValue(
      JSON.stringify([
        { instanceId: "wsi-1", name: "Notes", active: true },
        { instanceId: "wsi-placeholder-abc", name: "Empty", active: false },
      ]),
    );
    await expect(getRailInstances({})).resolves.toEqual([
      { instanceId: "wsi-1", name: "Notes", active: true },
      { instanceId: "wsi-placeholder-abc", name: "Empty", active: false },
    ]);
  });

  it.each([
    ["a missing attribute", null],
    ["an empty attribute", ""],
    ["a non-string", 7],
  ])("refuses %s with a contract failure naming the entry", async (_label, instanceId) => {
    evalJs.mockResolvedValue(JSON.stringify([{ instanceId: "wsi-1" }, { instanceId, name: "Broken" }]));
    await expect(getRailInstances({})).rejects.toThrow(
      /rail entry 1 \(title "Broken"\) carries no data-instance-id/,
    );
  });
});
