// useUniversalToolbar — the global Mod-Shift-B toggle plus the
// two-step Escape cascade (spec §3.3): dropdown closes first, then the
// toolbar session ends and the StatusBar is restored (unless the
// FindBar owns the bottom slot). Uses the real uiStore, the real
// shortcuts store (default binding) and the real shortcut matcher, so
// these tests exercise the full keydown → store pipeline.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useUIStore } from "@/stores/uiStore";
import { isMacPlatform } from "@/utils/shortcutMatch";
import { useUniversalToolbar } from "./useUniversalToolbar";

/** Keydown matching the default `formatToolbar` binding (Mod-Shift-b). */
function shortcutEvent(): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key: "b",
    shiftKey: true,
    metaKey: isMacPlatform(),
    ctrlKey: !isMacPlatform(),
    bubbles: true,
    cancelable: true,
  });
}

function escapeEvent(): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
}

beforeEach(() => {
  useUIStore.setState({
    statusBarVisible: true,
    _savedStatusBarVisible: null,
    universalToolbarVisible: false,
    universalToolbarHasFocus: false,
    toolbarDropdownOpen: false,
  } as never);
  useUIStore.getState().searchClose();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useUniversalToolbar — shortcut toggle", () => {
  it("opens the toolbar, displaces the StatusBar, and closes the FindBar", () => {
    useUIStore.getState().searchOpen();
    const { unmount } = renderHook(() => useUniversalToolbar());

    const event = shortcutEvent();
    document.dispatchEvent(event);

    const ui = useUIStore.getState();
    expect(ui.universalToolbarVisible).toBe(true);
    expect(ui.statusBarVisible).toBe(false);
    expect(ui.search.isOpen).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    unmount();
  });

  it("keeps the toolbar open on a second press (focus toggle, not hide)", () => {
    const { unmount } = renderHook(() => useUniversalToolbar());
    document.dispatchEvent(shortcutEvent());
    expect(useUIStore.getState().universalToolbarHasFocus).toBe(true);

    document.dispatchEvent(shortcutEvent());
    const ui = useUIStore.getState();
    expect(ui.universalToolbarVisible).toBe(true);
    expect(ui.universalToolbarHasFocus).toBe(false);
    unmount();
  });

  it("ignores non-matching keydowns", () => {
    const { unmount } = renderHook(() => useUniversalToolbar());
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "b", bubbles: true, cancelable: true }),
    );
    expect(useUIStore.getState().universalToolbarVisible).toBe(false);
    unmount();
  });

  it("stops toggling after unmount (listener removed)", () => {
    const { unmount } = renderHook(() => useUniversalToolbar());
    unmount();
    document.dispatchEvent(shortcutEvent());
    expect(useUIStore.getState().universalToolbarVisible).toBe(false);
  });
});

describe("useUniversalToolbar — Escape cascade", () => {
  it("step 1: closes an open dropdown but keeps the toolbar", () => {
    useUIStore.setState({
      universalToolbarVisible: true,
      toolbarDropdownOpen: true,
    } as never);
    const { unmount } = renderHook(() => useUniversalToolbar());

    const event = escapeEvent();
    document.dispatchEvent(event);

    const ui = useUIStore.getState();
    expect(ui.toolbarDropdownOpen).toBe(false);
    expect(ui.universalToolbarVisible).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    unmount();
  });

  it("step 2: closes the toolbar session and restores the StatusBar", () => {
    const { unmount } = renderHook(() => useUniversalToolbar());
    // Open via the shortcut so the StatusBar displacement is recorded.
    document.dispatchEvent(shortcutEvent());
    expect(useUIStore.getState().statusBarVisible).toBe(false);

    document.dispatchEvent(escapeEvent());

    const ui = useUIStore.getState();
    expect(ui.universalToolbarVisible).toBe(false);
    expect(ui.statusBarVisible).toBe(true);
    unmount();
  });

  it("does not restore the StatusBar when the FindBar is open", () => {
    const { unmount } = renderHook(() => useUniversalToolbar());
    document.dispatchEvent(shortcutEvent());
    useUIStore.getState().searchOpen();

    document.dispatchEvent(escapeEvent());

    const ui = useUIStore.getState();
    expect(ui.universalToolbarVisible).toBe(false);
    expect(ui.statusBarVisible).toBe(false);
    unmount();
  });

  it("leaves Escape alone while typing in an input", () => {
    useUIStore.setState({ universalToolbarVisible: true } as never);
    const { unmount } = renderHook(() => useUniversalToolbar());
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    const event = escapeEvent();
    input.dispatchEvent(event);

    expect(useUIStore.getState().universalToolbarVisible).toBe(true);
    expect(event.defaultPrevented).toBe(false);
    unmount();
  });

  it("leaves Escape alone when focus is inside the toolbar (two-step handled there)", () => {
    useUIStore.setState({ universalToolbarVisible: true } as never);
    const { unmount } = renderHook(() => useUniversalToolbar());
    const toolbar = document.createElement("div");
    toolbar.className = "universal-toolbar";
    const button = document.createElement("button");
    toolbar.appendChild(button);
    document.body.appendChild(toolbar);
    button.focus();

    const event = escapeEvent();
    button.dispatchEvent(event);

    expect(useUIStore.getState().universalToolbarVisible).toBe(true);
    expect(event.defaultPrevented).toBe(false);
    unmount();
  });

  it("ignores Escape entirely when the toolbar is hidden", () => {
    const { unmount } = renderHook(() => useUniversalToolbar());
    const event = escapeEvent();
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(useUIStore.getState().statusBarVisible).toBe(true);
    unmount();
  });
});
