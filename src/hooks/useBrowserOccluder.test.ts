// WI-SOC.1 / WI-SOC.1c — useBrowserOccluder: freeze every mounted browser tab while an
// overlay is up. Every MOUNTED tab, not just the focused one: in split view a browser
// can sit in an unfocused pane and still paint over whatever is drawn on top of it.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const occlusion = vi.hoisted(() => ({
  browserOcclusion: { addOccluder: vi.fn(), removeOccluder: vi.fn() },
  OCCLUDER: {},
}));
vi.mock("@/services/browser/browserOcclusion", () => occlusion);

import { useBrowserOccluder } from "./useBrowserOccluder";
import { useBrowserUiStore } from "@/stores/browserUiStore";

beforeEach(() => {
  useBrowserUiStore.setState({ entries: {} });
  occlusion.browserOcclusion.addOccluder.mockClear();
  occlusion.browserOcclusion.removeOccluder.mockClear();
});

describe("useBrowserOccluder", () => {
  it("freezes every MOUNTED browser tab, not just the focused one", () => {
    // Split view: a browser in each pane. Both native views are real and both paint
    // over anything drawn on top of them, so both must freeze. Keying occlusion off
    // the FOCUSED tab's kind is exactly the bug the cross-model review caught (D2#2).
    useBrowserUiStore.getState().ensureEntry("tab-a", "https://a.com/");
    useBrowserUiStore.getState().ensureEntry("tab-b", "https://b.com/");

    renderHook(() => useBrowserOccluder(true, "command-palette"));

    expect(occlusion.browserOcclusion.addOccluder).toHaveBeenCalledWith("tab-a", "command-palette");
    expect(occlusion.browserOcclusion.addOccluder).toHaveBeenCalledWith("tab-b", "command-palette");
  });

  it("releases exactly the tabs it froze when the overlay closes", () => {
    useBrowserUiStore.getState().ensureEntry("tab-a", "https://a.com/");
    const { unmount } = renderHook(() => useBrowserOccluder(true, "command-palette"));
    unmount();
    expect(occlusion.browserOcclusion.removeOccluder).toHaveBeenCalledWith(
      "tab-a",
      "command-palette",
    );
  });

  it("does nothing while the overlay is closed", () => {
    useBrowserUiStore.getState().ensureEntry("tab-a", "https://a.com/");
    renderHook(() => useBrowserOccluder(false, "command-palette"));
    expect(occlusion.browserOcclusion.addOccluder).not.toHaveBeenCalled();
  });

  it("does nothing when no browser tab is mounted (the overwhelmingly common case)", () => {
    renderHook(() => useBrowserOccluder(true, "command-palette"));
    expect(occlusion.browserOcclusion.addOccluder).not.toHaveBeenCalled();
  });
});
