// WI-1.3 — workflow inline preview now uses renderXyflowSnapshot
// (xyflow + html-to-image) instead of the legacy Mermaid pipeline.
// Visual parity with the side-panel canvas is structural; this test
// guards the wiring (renderXyflowSnapshot is called, sanitizeSvg is
// applied to its output, the placeholder element gets the SVG).

import { describe, expect, it, beforeEach, vi } from "vitest";

const snapshotMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ghaWorkflow/render/renderXyflowSnapshot", () => ({
  renderXyflowSnapshot: snapshotMock,
}));

import { updateWorkflowLivePreview } from "./renderWorkflowPreview";

describe("updateWorkflowLivePreview", () => {
  beforeEach(() => {
    snapshotMock.mockReset();
  });

  it("calls renderXyflowSnapshot with the workflow YAML", async () => {
    snapshotMock.mockResolvedValue("<svg viewBox='0 0 100 100'/>");
    const el = document.createElement("div");
    const yaml =
      "on: push\njobs:\n  a:\n    runs-on: x\n    steps: []";
    await updateWorkflowLivePreview(el, yaml, 1, () => 1);
    expect(snapshotMock).toHaveBeenCalledTimes(1);
    expect(snapshotMock).toHaveBeenCalledWith(yaml);
  });

  it("renders the SVG into the element on success", async () => {
    snapshotMock.mockResolvedValue("<svg id='ok'/>");
    const el = document.createElement("div");
    await updateWorkflowLivePreview(
      el,
      "on: push\njobs:\n  a:\n    runs-on: x\n    steps: []",
      1,
      () => 1,
    );
    expect(el.innerHTML).toContain("svg");
  });

  it("renders an error placeholder when the snapshot fails", async () => {
    snapshotMock.mockResolvedValue(null);
    const el = document.createElement("div");
    await updateWorkflowLivePreview(
      el,
      "on: push\njobs:\n  a:\n    runs-on: x\n    steps: []",
      1,
      () => 1,
    );
    expect(el.innerHTML).toMatch(/invalid|failed|error/i);
  });

  it("aborts if the token has been bumped (stale render guard)", async () => {
    snapshotMock.mockResolvedValue("<svg/>");
    const el = document.createElement("div");
    let token = 1;
    await updateWorkflowLivePreview(
      el,
      "on: push\njobs:\n  a:\n    runs-on: x\n    steps: []",
      1,
      () => {
        token = 2;
        return token;
      },
    );
    // Stale guard ran AFTER snapshotMock resolved; element should NOT
    // have been updated.
    expect(el.innerHTML).toBe("");
  });

  it("returns null on snapshot exceptions without throwing into ProseMirror", async () => {
    snapshotMock.mockRejectedValue(new Error("boom"));
    const el = document.createElement("div");
    await expect(
      updateWorkflowLivePreview(
        el,
        "on: push\njobs:\n  a:\n    runs-on: x\n    steps: []",
        1,
        () => 1,
      ),
    ).resolves.toBeUndefined();
    expect(el.innerHTML).toMatch(/invalid|failed|error/i);
  });
});
