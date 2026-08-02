import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The unbound path reads as "no workflow". Reaching it needs a fresh module
 * instance, because `src/test/setup.ts` does not bind this one but other
 * tests in the same file would.
 */
let bindWorkflowPort: typeof import("./workflowPort").bindWorkflowPort;
let workflowPort: typeof import("./workflowPort").workflowPort;

beforeEach(async () => {
  vi.resetModules();
  ({ bindWorkflowPort, workflowPort } = await import("./workflowPort"));
});

describe("workflowPort", () => {
  it("reads as no-workflow when nothing was bound, rather than throwing", () => {
    // Reached from the autocomplete source on every keystroke and from cursor
    // sync on every selection change: throwing here would turn a missing
    // binding into a broken editor rather than a missing panel.
    expect(() => workflowPort()).not.toThrow();
    const s = workflowPort().getState();
    expect(s.gha.workflow).toBeNull();
    expect(s.preview.panelOpen).toBe(false);
    expect(s.view.selectedJobId).toBeNull();
  });

  it("swallows writes when unbound instead of parsing into a void loudly", () => {
    const s = workflowPort().getState();
    expect(() => {
      s.setGraph(null);
      s.previewOpenPanel();
      s.previewClosePanel();
      s.resetPreview();
      s.selectJob("build");
    }).not.toThrow();
    expect(workflowPort().getState().preview.panelOpen).toBe(false);
  });

  it("returns the port once bound", () => {
    const port = { getState: () => ({}) } as never;
    bindWorkflowPort(port);
    expect(workflowPort()).toBe(port);
  });

  it("rebinding replaces the previous port", () => {
    const first = { getState: () => ({ id: 1 }) } as never;
    const second = { getState: () => ({ id: 2 }) } as never;
    bindWorkflowPort(first);
    bindWorkflowPort(second);
    expect(workflowPort()).toBe(second);
  });
});
