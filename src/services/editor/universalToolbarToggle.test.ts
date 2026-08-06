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

  it("moves FOCUS rather than hiding when already visible", () => {
    // The shortcut summons and re-focuses; dismissal is Esc. A menu item
    // carrying the same accelerator must behave identically, or clicking
    // the item and pressing the key would diverge while macOS advertises
    // them as the same action.
    toggleUniversalToolbar();
    toggleUniversalToolbar();
    expect(useUIStore.getState().universalToolbarVisible).toBe(true);
    expect(useUIStore.getState().universalToolbarHasFocus).toBe(false);
  });

  it("displaces the StatusBar when summoning — they share the strip", () => {
    expect(useUIStore.getState().statusBarVisible).toBe(true);
    toggleUniversalToolbar();
    expect(useUIStore.getState().statusBarVisible).toBe(false);
  });

  it("closes an open search when summoning", () => {
    useUIStore.getState().searchOpen();
    expect(useUIStore.getState().search.isOpen).toBe(true);
    toggleUniversalToolbar();
    expect(useUIStore.getState().search.isOpen).toBe(false);
  });

  it("does not touch the StatusBar again once the toolbar is up", () => {
    toggleUniversalToolbar();
    useUIStore.getState().setStatusBarVisible(true);
    toggleUniversalToolbar();
    expect(useUIStore.getState().statusBarVisible).toBe(true);
  });
});
