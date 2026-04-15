import { describe, it, expect, beforeEach } from "vitest";
import { useUIStore } from "../uiStore";

beforeEach(() => {
  useUIStore.setState({
    statusBarVisible: true,
    universalToolbarVisible: false,
    universalToolbarHasFocus: false,
    toolbarSessionFocusIndex: -1,
    toolbarDropdownOpen: false,
    _savedStatusBarVisible: null,
  });
});

describe("displaceStatusBar", () => {
  it("saves current visibility and hides StatusBar", () => {
    useUIStore.getState().displaceStatusBar();
    expect(useUIStore.getState().statusBarVisible).toBe(false);
    expect(useUIStore.getState()._savedStatusBarVisible).toBe(true);
  });

  it("saves false when StatusBar was already hidden", () => {
    useUIStore.setState({ statusBarVisible: false });
    useUIStore.getState().displaceStatusBar();
    expect(useUIStore.getState().statusBarVisible).toBe(false);
    expect(useUIStore.getState()._savedStatusBarVisible).toBe(false);
  });

  it("does not overwrite saved state on second call", () => {
    useUIStore.getState().displaceStatusBar();
    expect(useUIStore.getState()._savedStatusBarVisible).toBe(true);
    useUIStore.getState().displaceStatusBar();
    expect(useUIStore.getState()._savedStatusBarVisible).toBe(true);
  });
});

describe("restoreStatusBar", () => {
  it("restores StatusBar to saved state (was visible)", () => {
    useUIStore.getState().displaceStatusBar();
    useUIStore.getState().restoreStatusBar();
    expect(useUIStore.getState().statusBarVisible).toBe(true);
    expect(useUIStore.getState()._savedStatusBarVisible).toBeNull();
  });

  it("restores StatusBar to saved state (was hidden)", () => {
    useUIStore.setState({ statusBarVisible: false });
    useUIStore.getState().displaceStatusBar();
    useUIStore.getState().restoreStatusBar();
    expect(useUIStore.getState().statusBarVisible).toBe(false);
    expect(useUIStore.getState()._savedStatusBarVisible).toBeNull();
  });

  it("is a no-op when nothing was saved", () => {
    useUIStore.getState().restoreStatusBar();
    expect(useUIStore.getState().statusBarVisible).toBe(true);
    expect(useUIStore.getState()._savedStatusBarVisible).toBeNull();
  });
});

describe("setStatusBarVisible clears saved state", () => {
  it("clears saved state when user explicitly sets visibility", () => {
    useUIStore.getState().displaceStatusBar();
    useUIStore.getState().setStatusBarVisible(true);
    expect(useUIStore.getState()._savedStatusBarVisible).toBeNull();
  });
});
