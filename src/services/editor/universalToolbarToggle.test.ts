// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { toggleUniversalToolbar } from "./universalToolbarToggle";
import { useUIStore } from "@/stores/uiStore";

describe("toggleUniversalToolbar", () => {
  beforeEach(() => {
    useUIStore.getState().clearToolbarSession();
    useUIStore.getState().setStatusBarVisible(true);
    useUIStore.getState().searchClose();
  });

  it("summons the toolbar when hidden", () => {
    toggleUniversalToolbar();
    expect(useUIStore.getState().universalToolbarVisible).toBe(true);
    expect(useUIStore.getState().universalToolbarHasFocus).toBe(true);
  });

  it("hides the toolbar on the second call — the menu and the shortcut are one action", () => {
    // macOS advertises the View item and its accelerator as the same command,
    // so the second invocation must hide. Leaving the bar up made the menu
    // that showed it unable to put it away (#1711).
    toggleUniversalToolbar();
    toggleUniversalToolbar();
    expect(useUIStore.getState().universalToolbarVisible).toBe(false);
    expect(useUIStore.getState().universalToolbarHasFocus).toBe(false);
  });

  it("leaves the StatusBar — and the tab strip in it — visible when summoning", () => {
    expect(useUIStore.getState().statusBarVisible).toBe(true);
    toggleUniversalToolbar();
    expect(useUIStore.getState().statusBarVisible).toBe(true);
    expect(useUIStore.getState().universalToolbarVisible).toBe(true);
  });

  it("gives the StatusBar back when the toolbar replaces an open FindBar", () => {
    useUIStore.getState().displaceStatusBar();
    useUIStore.getState().searchOpen();
    expect(useUIStore.getState().statusBarVisible).toBe(false);

    toggleUniversalToolbar();

    expect(useUIStore.getState().search.isOpen).toBe(false);
    expect(useUIStore.getState().statusBarVisible).toBe(true);
    expect(useUIStore.getState().universalToolbarVisible).toBe(true);
  });

  it("closes an open search when summoning", () => {
    useUIStore.getState().searchOpen();
    expect(useUIStore.getState().search.isOpen).toBe(true);
    toggleUniversalToolbar();
    expect(useUIStore.getState().search.isOpen).toBe(false);
  });

  it("does not reveal a StatusBar the reader had hidden", () => {
    useUIStore.getState().setStatusBarVisible(false);
    toggleUniversalToolbar();
    expect(useUIStore.getState().statusBarVisible).toBe(false);
    expect(useUIStore.getState().universalToolbarVisible).toBe(true);
  });
});
