// WI-1.2 (companion) — snapshotRoot exposes attachTo + captureSnapshot
// for renderXyflowSnapshot. The actual React/xyflow/html-to-image work
// is exercised in the live smoke; this test guards the API shape so a
// rename or signature change surfaces immediately.

import { describe, it, expect } from "vitest";

describe("snapshotRoot module shape", () => {
  it("exports attachTo and captureSnapshot", async () => {
    const mod = await import("./snapshotRoot");
    expect(typeof mod.attachTo).toBe("function");
    expect(typeof mod.captureSnapshot).toBe("function");
  });

  it("captureSnapshot resolves null before attachTo is called", async () => {
    const mod = await import("./snapshotRoot");
    // Module-load order: renderXyflowSnapshot calls attachTo first; if
    // a caller skips that step we must surface null rather than
    // silently throwing into the void.
    await expect(
      mod.captureSnapshot("name: ci\non: push\njobs: {}\n"),
    ).resolves.toBeNull();
  });
});
