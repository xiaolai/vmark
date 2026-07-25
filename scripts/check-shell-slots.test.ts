/**
 * Tests for the ADR-007 shell-slot budget gate.
 *
 * The gate's whole value is that it FIRES when a new top-level surface is added
 * directly to App.tsx, so the detection itself is what needs proving — a gate
 * that silently counts zero would pass forever and enforce nothing.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { countSurfaceMounts } from "./check-shell-slots.mjs";

describe("countSurfaceMounts", () => {
  it("counts each recognised top-level surface kind", () => {
    const src = `
      <>
        <QuickLookOverlay />
        <WindowStatusOverlay />
        <TerminalPanel />
        <ApprovalDialog />
        <GeniePickerOverlay />
      </>`;
    expect(countSurfaceMounts(src)).toEqual([
      "QuickLookOverlay",
      "WindowStatusOverlay",
      "TerminalPanel",
      "ApprovalDialog",
      "GeniePickerOverlay",
    ]);
  });

  it("detects a newly added surface — the regression the gate exists to catch", () => {
    const before = `<>\n  <QuickLookOverlay />\n</>`;
    const after = `<>\n  <QuickLookOverlay />\n  <SomeNewPanel />\n</>`;
    expect(countSurfaceMounts(after).length).toBeGreaterThan(
      countSurfaceMounts(before).length
    );
    expect(countSurfaceMounts(after)).toContain("SomeNewPanel");
  });

  it("ignores components that are not top-level surfaces", () => {
    const src = `
      <>
        <DocumentSplitContainer />
        <BottomBar />
        <FeatureErrorBoundary feature="x" />
      </>`;
    expect(countSurfaceMounts(src)).toEqual([]);
  });

  it("ignores surface names appearing in imports or prose, not as JSX mounts", () => {
    const src = `import { QuickLookOverlay } from "@/components/QuickLook";\n// mentions ApprovalDialog in a comment`;
    expect(countSurfaceMounts(src)).toEqual([]);
  });

  it("matches the committed baseline against the real App.tsx", () => {
    const actual = countSurfaceMounts(readFileSync("src/App.tsx", "utf8")).length;
    const baseline = JSON.parse(
      readFileSync("scripts/shell-slots-baseline.json", "utf8")
    ).maxDirectSurfaceMounts;
    // Ratchets down only: a mismatch in either direction is a gate failure, so
    // the committed number must track reality exactly.
    expect(actual).toBe(baseline);
  });
});
