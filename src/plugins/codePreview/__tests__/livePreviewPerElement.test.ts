// Audit F9 — live-preview debounce state must be keyed per preview element,
// not module-global: concurrent edit sessions (split panes rendering the same
// document, or two registered editors) must not cancel each other's pending
// renders.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const renderLatexMock = vi.hoisted(() => ({
  updateLatexLivePreview: vi.fn(),
  createLatexPreviewWidget: vi.fn(),
}));

const renderWorkflowMock = vi.hoisted(() => ({
  updateWorkflowLivePreview: vi.fn(async () => {}),
  createWorkflowPreviewWidget: vi.fn(),
}));

vi.mock("../renderers/renderLatex", () => renderLatexMock);
vi.mock("../renderers/renderWorkflowPreview", () => renderWorkflowMock);

import { updateLivePreview } from "../editMode";

describe("updateLivePreview per-element debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    renderLatexMock.updateLatexLivePreview.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not cancel element A's pending render when element B updates", () => {
    const elA = document.createElement("div");
    const elB = document.createElement("div");

    // Blank content renders the "empty" placeholder synchronously inside the
    // debounce callback — no async renderer involved.
    updateLivePreview(elA, "latex", "   ");
    updateLivePreview(elB, "latex", "   ");
    vi.runAllTimers();

    expect(elA.querySelector(".code-block-live-preview-empty")).not.toBeNull();
    expect(elB.querySelector(".code-block-live-preview-empty")).not.toBeNull();
  });

  it("still debounces rapid updates to the SAME element (only the last renders)", () => {
    const el = document.createElement("div");

    updateLivePreview(el, "latex", "x^1");
    updateLivePreview(el, "latex", "x^2");
    vi.runAllTimers();

    expect(renderLatexMock.updateLatexLivePreview).toHaveBeenCalledTimes(1);
    expect(renderLatexMock.updateLatexLivePreview).toHaveBeenCalledWith(
      el,
      "x^2",
      expect.any(Number),
      expect.any(Function),
    );
  });

  it("routes yaml content to the workflow live renderer", () => {
    const el = document.createElement("div");

    updateLivePreview(el, "yaml", "on: push\njobs:\n  build:\n    runs-on: x");
    vi.runAllTimers();

    expect(renderWorkflowMock.updateWorkflowLivePreview).toHaveBeenCalledWith(
      el,
      expect.stringContaining("on: push"),
      expect.any(Number),
      expect.any(Function),
    );
  });

  it("renders both elements when they debounce concurrently with real content", () => {
    const elA = document.createElement("div");
    const elB = document.createElement("div");

    updateLivePreview(elA, "latex", "a^2");
    updateLivePreview(elB, "latex", "b^2");
    vi.runAllTimers();

    const targets = renderLatexMock.updateLatexLivePreview.mock.calls.map((c) => c[0]);
    expect(targets).toContain(elA);
    expect(targets).toContain(elB);
  });
});
