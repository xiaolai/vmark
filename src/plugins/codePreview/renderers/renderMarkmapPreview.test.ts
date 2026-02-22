import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("@/plugins/markmap", () => ({
  renderMarkmapToElement: vi.fn(),
}));

vi.mock("@/plugins/markmap/markmapExport", () => ({
  setupMarkmapExport: vi.fn(),
}));

vi.mock("@/plugins/shared/diagramCleanup", () => ({
  cleanupDescendants: vi.fn(),
}));

vi.mock("@/utils/debug", () => ({
  diagramWarn: vi.fn(),
}));

import { renderMarkmapToElement } from "@/plugins/markmap";
import { diagramWarn } from "@/utils/debug";
import { createMarkmapPreview } from "./renderMarkmapPreview";

describe("createMarkmapPreview", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(renderMarkmapToElement).mockReset();
    vi.mocked(diagramWarn).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("shows error state when renderMarkmapToElement rejects", async () => {
    vi.mocked(renderMarkmapToElement).mockRejectedValueOnce(new Error("markmap failed"));

    const wrapper = createMarkmapPreview("bad content");
    // Append to document so svgEl.isConnected returns true
    document.body.appendChild(wrapper);

    // Advance to trigger requestAnimationFrame callback and flush microtasks
    await vi.advanceTimersByTimeAsync(16);

    expect(wrapper.className).toContain("markmap-error");
    expect(diagramWarn).toHaveBeenCalled();
  });
});
