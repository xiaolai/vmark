import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRenderMarkmapToElement = vi.fn();
const mockSetupMarkmapExport = vi.fn();
const mockCleanupDescendants = vi.fn();
const mockInstallDoubleClickHandler = vi.fn();
const mockDiagramWarn = vi.fn();

vi.mock("@/plugins/markmap", () => ({
  renderMarkmapToElement: (...args: unknown[]) => mockRenderMarkmapToElement(...args),
}));
vi.mock("@/plugins/markmap/markmapExport", () => ({
  setupMarkmapExport: (...args: unknown[]) => mockSetupMarkmapExport(...args),
}));
vi.mock("@/plugins/shared/diagramCleanup", () => ({
  cleanupDescendants: (...args: unknown[]) => mockCleanupDescendants(...args),
}));
vi.mock("../previewHelpers", () => ({
  installDoubleClickHandler: (...args: unknown[]) => mockInstallDoubleClickHandler(...args),
}));
vi.mock("@/utils/debug", () => ({
  diagramWarn: (...args: unknown[]) => mockDiagramWarn(...args),
}));

import { createMarkmapPreview } from "./renderMarkmapPreview";

describe("createMarkmapPreview", () => {
  let rafCallbacks: FrameRequestCallback[];

  beforeEach(() => {
    vi.clearAllMocks();
    rafCallbacks = [];
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
  });

  it("shows error indicator when renderMarkmapToElement rejects", async () => {
    mockRenderMarkmapToElement.mockRejectedValue(new Error("Markmap render failed"));

    const wrapper = createMarkmapPreview("# Test");

    // Attach to DOM so svgEl.isConnected returns true
    document.body.appendChild(wrapper);

    // Trigger the requestAnimationFrame callback
    expect(rafCallbacks).toHaveLength(1);
    rafCallbacks[0](0);

    // Wait for the rejected promise to settle
    await vi.waitFor(() => {
      expect(mockDiagramWarn).toHaveBeenCalledWith(
        "Markmap render failed:",
        "Markmap render failed",
      );
    });

    expect(wrapper.className).toContain("mermaid-error");
    expect(wrapper.textContent).toContain("Failed to render mindmap");

    document.body.removeChild(wrapper);
  });

  it("renders normally when renderMarkmapToElement resolves", async () => {
    const mockInstance = { fit: vi.fn() };
    mockRenderMarkmapToElement.mockResolvedValue(mockInstance);

    const wrapper = createMarkmapPreview("# Test");
    document.body.appendChild(wrapper);

    expect(rafCallbacks).toHaveLength(1);
    rafCallbacks[0](0);

    await vi.waitFor(() => {
      expect(mockSetupMarkmapExport).toHaveBeenCalled();
    });

    // Should not have error class
    expect(wrapper.className).not.toContain("mermaid-error");
    // Should have a fit button
    expect(wrapper.querySelector(".markmap-fit-btn")).not.toBeNull();

    document.body.removeChild(wrapper);
  });
});
