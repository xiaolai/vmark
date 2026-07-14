// WI-S1.1 — browserUiStore: transient per-tab browser nav UI state (urlInput, loading)
import { describe, it, expect, beforeEach } from "vitest";
import { useBrowserUiStore } from "./browserUiStore";

beforeEach(() => {
  useBrowserUiStore.setState({ entries: {} });
});

describe("browserUiStore", () => {
  it("seeds an entry with the initial url, loading=true, and no history", () => {
    useBrowserUiStore.getState().ensureEntry("tab-1", "https://example.com/");
    const entry = useBrowserUiStore.getState().entries["tab-1"];
    expect(entry).toEqual({
      urlInput: "https://example.com/",
      loading: true,
      canGoBack: false,
      canGoForward: false,
      frozen: false,
    });
  });

  // WI-S1.6 (Codex re-review D3#5): back/forward shipped as always-enabled no-ops.
  it("setHistory records the webview's back/forward state", () => {
    useBrowserUiStore.getState().ensureEntry("tab-1", "https://a.com/");
    useBrowserUiStore.getState().setHistory("tab-1", true, false);
    const entry = useBrowserUiStore.getState().entries["tab-1"];
    expect(entry.canGoBack).toBe(true);
    expect(entry.canGoForward).toBe(false);
  });

  it("setHistory on a missing tab is a no-op", () => {
    useBrowserUiStore.getState().setHistory("ghost", true, true);
    expect(useBrowserUiStore.getState().entries["ghost"]).toBeUndefined();
  });

  // WI-SOC.1b — the frozen flag is what lets BrowserSurface paint an opaque
  // placeholder where the hidden native view used to be, so an overlay never
  // composites over a blank hole.
  it("seeds a tab as not frozen", () => {
    useBrowserUiStore.getState().ensureEntry("tab-1", "https://a.com/");
    expect(useBrowserUiStore.getState().entries["tab-1"].frozen).toBe(false);
  });

  it("setFrozen records that the native view is hidden", () => {
    useBrowserUiStore.getState().ensureEntry("tab-1", "https://a.com/");
    useBrowserUiStore.getState().setFrozen("tab-1", true);
    expect(useBrowserUiStore.getState().entries["tab-1"].frozen).toBe(true);
    useBrowserUiStore.getState().setFrozen("tab-1", false);
    expect(useBrowserUiStore.getState().entries["tab-1"].frozen).toBe(false);
  });

  it("setFrozen on a missing tab is a no-op", () => {
    useBrowserUiStore.getState().setFrozen("ghost", true);
    expect(useBrowserUiStore.getState().entries["ghost"]).toBeUndefined();
  });

  it("ensureEntry does not clobber an existing entry", () => {
    useBrowserUiStore.getState().ensureEntry("tab-1", "https://example.com/");
    useBrowserUiStore.getState().setUrlInput("tab-1", "https://edited.com/");
    useBrowserUiStore.getState().setLoading("tab-1", false);
    // Second ensure with a different seed must be a no-op for an existing tab.
    useBrowserUiStore.getState().ensureEntry("tab-1", "https://other.com/");
    expect(useBrowserUiStore.getState().entries["tab-1"]).toEqual({
      urlInput: "https://edited.com/",
      loading: false,
      canGoBack: false,
      canGoForward: false,
      frozen: false,
    });
  });

  it("setUrlInput updates only that tab's input", () => {
    useBrowserUiStore.getState().ensureEntry("tab-1", "https://a.com/");
    useBrowserUiStore.getState().ensureEntry("tab-2", "https://b.com/");
    useBrowserUiStore.getState().setUrlInput("tab-1", "https://a2.com/");
    expect(useBrowserUiStore.getState().entries["tab-1"].urlInput).toBe("https://a2.com/");
    expect(useBrowserUiStore.getState().entries["tab-2"].urlInput).toBe("https://b.com/");
  });

  it("setLoading toggles the loading flag", () => {
    useBrowserUiStore.getState().ensureEntry("tab-1", "https://a.com/");
    useBrowserUiStore.getState().setLoading("tab-1", false);
    expect(useBrowserUiStore.getState().entries["tab-1"].loading).toBe(false);
  });

  it("setUrlInput on a missing tab is a no-op (guards keyed state)", () => {
    useBrowserUiStore.getState().setUrlInput("ghost", "https://x.com/");
    expect(useBrowserUiStore.getState().entries["ghost"]).toBeUndefined();
  });

  it("setLoading on a missing tab is a no-op", () => {
    useBrowserUiStore.getState().setLoading("ghost", true);
    expect(useBrowserUiStore.getState().entries["ghost"]).toBeUndefined();
  });

  it("clearForTab removes the entry", () => {
    useBrowserUiStore.getState().ensureEntry("tab-1", "https://a.com/");
    useBrowserUiStore.getState().clearForTab("tab-1");
    expect(useBrowserUiStore.getState().entries["tab-1"]).toBeUndefined();
  });

  it("clearForTab on a missing tab is a no-op", () => {
    expect(() => useBrowserUiStore.getState().clearForTab("ghost")).not.toThrow();
  });
});
