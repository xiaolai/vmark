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

// Audit finding (High): the hook snapshotted the mounted tabs ONCE, so a browser tab that
// mounted while the overlay was still open was never frozen — and a native view appearing
// over an open dialog is the exact failure this hook exists to prevent. It is not a corner
// case: the command palette is HOW you run "New Browser Tab", so the overlay is open at the
// very moment the surface mounts.
describe("useBrowserOccluder — the mounted set is not fixed for the overlay's lifetime", () => {
  it("freezes a browser tab that mounts WHILE the overlay is already open", () => {
    const { unmount } = renderHook(() => useBrowserOccluder(true, "command-palette"));
    expect(occlusion.browserOcclusion.addOccluder).not.toHaveBeenCalled();

    // The user runs "New Browser Tab" from the palette. The surface mounts under it.
    useBrowserUiStore.getState().ensureEntry("tab-new", "https://a.com/");

    expect(occlusion.browserOcclusion.addOccluder).toHaveBeenCalledWith(
      "tab-new",
      "command-palette",
    );

    // ...and it is released when the overlay closes.
    unmount();
    expect(occlusion.browserOcclusion.removeOccluder).toHaveBeenCalledWith(
      "tab-new",
      "command-palette",
    );
  });

  it("does not double-freeze a tab on unrelated store churn", () => {
    useBrowserUiStore.getState().ensureEntry("tab-a", "https://a.com/");
    renderHook(() => useBrowserOccluder(true, "command-palette"));
    occlusion.browserOcclusion.addOccluder.mockClear();

    // Typing in the omnibox writes to this store constantly.
    useBrowserUiStore.getState().setUrlInput("tab-a", "https://a.com/x");
    useBrowserUiStore.getState().setLoading("tab-a", true);

    expect(occlusion.browserOcclusion.addOccluder).not.toHaveBeenCalled();
  });
});
