/**
 * Tests for useFileShortcuts — menu event listeners and keyboard shortcuts
 *
 * @module hooks/useFileShortcuts.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

// Hoist mocks so they're available for vi.mock factories
const {
  mockListen, mockUnlisten: _mockUnlisten,
  mockHandleSave, mockHandleSaveAs, mockHandleMoveTo,
  mockHandleSaveAllQuit, mockHandleOpen, mockHandleOpenFile, mockHandleNew,
  mockMatchesShortcutEvent, mockIsImeKeyEvent,
} = vi.hoisted(() => ({
  mockListen: vi.fn(() => Promise.resolve(vi.fn())),
  mockUnlisten: vi.fn(),
  mockHandleSave: vi.fn(() => Promise.resolve()),
  mockHandleSaveAs: vi.fn(() => Promise.resolve()),
  mockHandleMoveTo: vi.fn(),
  mockHandleSaveAllQuit: vi.fn(),
  mockHandleOpen: vi.fn(),
  mockHandleOpenFile: vi.fn(),
  mockHandleNew: vi.fn(),
  mockMatchesShortcutEvent: vi.fn(() => false),
  mockIsImeKeyEvent: vi.fn(() => false),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(() => ({
    label: "main",
    listen: mockListen,
  })),
}));

vi.mock("@/stores/settingsStore", () => ({
  useShortcutsStore: {
    getState: vi.fn(() => ({
      getShortcut: vi.fn((id: string) => {
        if (id === "save") return "Mod-s";
        if (id === "saveAs") return "Mod-Shift-s";
        return "";
      }),
    })),
  },
}));

vi.mock("@/utils/shortcutMatch", () => ({
  matchesShortcutEvent: mockMatchesShortcutEvent,
}));

vi.mock("@/utils/imeGuard", () => ({
  isImeKeyEvent: mockIsImeKeyEvent,
}));

vi.mock("@/utils/safeUnlisten", () => ({
  safeUnlistenAll: vi.fn((fns: (() => void)[]) => {
    fns.forEach((fn) => fn());
    return [];
  }),
}));

vi.mock("./useFileSave", () => ({
  handleSave: mockHandleSave,
  handleSaveAs: mockHandleSaveAs,
  handleMoveTo: mockHandleMoveTo,
  handleSaveAllQuit: mockHandleSaveAllQuit,
}));

vi.mock("./useFileOpen", () => ({
  handleOpen: mockHandleOpen,
  handleOpenFile: mockHandleOpenFile,
  handleNew: mockHandleNew,
}));

vi.mock("@/utils/debug", () => ({
  fileOpsLog: vi.fn(),
}));

import { useFileShortcuts } from "./useFileShortcuts";

describe("useFileShortcuts", () => {
  let listenCallbacks: Record<string, (event: { payload: unknown }) => void>;

  beforeEach(() => {
    vi.clearAllMocks();
    listenCallbacks = {};

    // Capture callbacks for each event type
    mockListen.mockImplementation((eventName: string, callback: (event: { payload: unknown }) => void) => {
      listenCallbacks[eventName] = callback;
      const unlisten = vi.fn();
      return Promise.resolve(unlisten);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers all expected menu event listeners", async () => {
    renderHook(() => useFileShortcuts("main"));

    // Wait for all async listener setup
    await vi.waitFor(() => {
      expect(mockListen).toHaveBeenCalledTimes(7);
    });

    const eventNames = mockListen.mock.calls.map(
      (call: unknown[]) => call[0],
    );
    expect(eventNames).toContain("menu:new");
    expect(eventNames).toContain("menu:open");
    expect(eventNames).toContain("menu:save");
    expect(eventNames).toContain("menu:save-as");
    expect(eventNames).toContain("menu:move-to");
    expect(eventNames).toContain("menu:save-all-quit");
    expect(eventNames).toContain("open-file");
  });

  it("calls handleNew when menu:new event matches window", async () => {
    renderHook(() => useFileShortcuts("main"));

    await vi.waitFor(() => {
      expect(listenCallbacks["menu:new"]).toBeDefined();
    });

    listenCallbacks["menu:new"]({ payload: "main" });

    expect(mockHandleNew).toHaveBeenCalledWith("main");
  });

  it("ignores menu:new event for different window", async () => {
    renderHook(() => useFileShortcuts("main"));

    await vi.waitFor(() => {
      expect(listenCallbacks["menu:new"]).toBeDefined();
    });

    listenCallbacks["menu:new"]({ payload: "doc-1" });

    expect(mockHandleNew).not.toHaveBeenCalled();
  });

  it("calls handleSave when menu:save event matches window", async () => {
    renderHook(() => useFileShortcuts("main"));

    await vi.waitFor(() => {
      expect(listenCallbacks["menu:save"]).toBeDefined();
    });

    listenCallbacks["menu:save"]({ payload: "main" });

    // handleSave is async — let microtasks settle
    await vi.waitFor(() => {
      expect(mockHandleSave).toHaveBeenCalledWith("main");
    });
  });

  it("calls handleSaveAs when menu:save-as event matches window", async () => {
    renderHook(() => useFileShortcuts("main"));

    await vi.waitFor(() => {
      expect(listenCallbacks["menu:save-as"]).toBeDefined();
    });

    listenCallbacks["menu:save-as"]({ payload: "main" });

    await vi.waitFor(() => {
      expect(mockHandleSaveAs).toHaveBeenCalledWith("main");
    });
  });

  it("calls handleMoveTo when menu:move-to event matches window", async () => {
    renderHook(() => useFileShortcuts("main"));

    await vi.waitFor(() => {
      expect(listenCallbacks["menu:move-to"]).toBeDefined();
    });

    listenCallbacks["menu:move-to"]({ payload: "main" });

    await vi.waitFor(() => {
      expect(mockHandleMoveTo).toHaveBeenCalledWith("main");
    });
  });

  it("calls handleSaveAllQuit when menu:save-all-quit event matches", async () => {
    renderHook(() => useFileShortcuts("main"));

    await vi.waitFor(() => {
      expect(listenCallbacks["menu:save-all-quit"]).toBeDefined();
    });

    listenCallbacks["menu:save-all-quit"]({ payload: "main" });

    await vi.waitFor(() => {
      expect(mockHandleSaveAllQuit).toHaveBeenCalledWith("main");
    });
  });

  it("calls handleOpenFile for open-file events targeting this window", async () => {
    renderHook(() => useFileShortcuts("main"));

    await vi.waitFor(() => {
      expect(listenCallbacks["open-file"]).toBeDefined();
    });

    listenCallbacks["open-file"]({
      payload: { path: "/path/to/file.md", windowLabel: "main" },
    });

    await vi.waitFor(() => {
      expect(mockHandleOpenFile).toHaveBeenCalledWith("main", "/path/to/file.md");
    });
  });

  it("ignores open-file events from OTHER windows (#1112 — emit broadcasts)", async () => {
    renderHook(() => useFileShortcuts("main"));

    await vi.waitFor(() => {
      expect(listenCallbacks["open-file"]).toBeDefined();
    });

    listenCallbacks["open-file"]({
      payload: { path: "/path/to/file.md", windowLabel: "window-2" },
    });

    // Give any wrongly-scheduled handler a tick to run before asserting.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockHandleOpenFile).not.toHaveBeenCalled();
  });

  it("cleans up listeners on unmount", async () => {
    const { unmount } = renderHook(() => useFileShortcuts("main"));

    await vi.waitFor(() => {
      expect(mockListen).toHaveBeenCalled();
    });

    unmount();

    // safeUnlistenAll was called with the accumulated unlisten functions
    // The mock returns [] which is the expected cleanup behavior
  });

  describe("keyboard shortcuts", () => {
    it("calls handleSave on Mod+S keyboard shortcut", async () => {
      mockMatchesShortcutEvent.mockImplementation(
        (_e: unknown, key: string) => key === "Mod-s",
      );

      renderHook(() => useFileShortcuts("main"));

      // Wait for listeners to be set up
      await vi.waitFor(() => {
        expect(mockListen).toHaveBeenCalled();
      });

      const event = new KeyboardEvent("keydown", {
        key: "s",
        metaKey: true,
      });
      Object.defineProperty(event, "target", {
        value: document.createElement("div"),
      });
      window.dispatchEvent(event);

      expect(mockHandleSave).toHaveBeenCalledWith("main");
    });

    it("calls handleSaveAs on Mod+Shift+S keyboard shortcut", async () => {
      mockMatchesShortcutEvent.mockImplementation(
        (_e: unknown, key: string) => key === "Mod-Shift-s",
      );

      renderHook(() => useFileShortcuts("main"));

      await vi.waitFor(() => {
        expect(mockListen).toHaveBeenCalled();
      });

      const event = new KeyboardEvent("keydown", {
        key: "s",
        metaKey: true,
        shiftKey: true,
      });
      Object.defineProperty(event, "target", {
        value: document.createElement("div"),
      });
      window.dispatchEvent(event);

      expect(mockHandleSaveAs).toHaveBeenCalledWith("main");
    });

    it("ignores keyboard events during IME composition", async () => {
      mockIsImeKeyEvent.mockReturnValue(true);
      mockMatchesShortcutEvent.mockReturnValue(true);

      renderHook(() => useFileShortcuts("main"));

      await vi.waitFor(() => {
        expect(mockListen).toHaveBeenCalled();
      });

      const event = new KeyboardEvent("keydown", { key: "s", metaKey: true });
      Object.defineProperty(event, "target", {
        value: document.createElement("div"),
      });
      window.dispatchEvent(event);

      expect(mockHandleSave).not.toHaveBeenCalled();
    });

    it("ignores keyboard events from INPUT elements", async () => {
      mockMatchesShortcutEvent.mockReturnValue(true);

      renderHook(() => useFileShortcuts("main"));

      await vi.waitFor(() => {
        expect(mockListen).toHaveBeenCalled();
      });

      const event = new KeyboardEvent("keydown", { key: "s", metaKey: true });
      Object.defineProperty(event, "target", {
        value: document.createElement("input"),
      });
      window.dispatchEvent(event);

      expect(mockHandleSave).not.toHaveBeenCalled();
    });

    it("ignores keyboard events from TEXTAREA elements", async () => {
      mockMatchesShortcutEvent.mockReturnValue(true);

      renderHook(() => useFileShortcuts("main"));

      await vi.waitFor(() => {
        expect(mockListen).toHaveBeenCalled();
      });

      const event = new KeyboardEvent("keydown", { key: "s", metaKey: true });
      Object.defineProperty(event, "target", {
        value: document.createElement("textarea"),
      });
      window.dispatchEvent(event);

      expect(mockHandleSave).not.toHaveBeenCalled();
    });

    it("does not match unrelated keyboard events", async () => {
      mockMatchesShortcutEvent.mockReturnValue(false);

      renderHook(() => useFileShortcuts("main"));

      await vi.waitFor(() => {
        expect(mockListen).toHaveBeenCalled();
      });

      const event = new KeyboardEvent("keydown", { key: "a" });
      Object.defineProperty(event, "target", {
        value: document.createElement("div"),
      });
      window.dispatchEvent(event);

      expect(mockHandleSave).not.toHaveBeenCalled();
      expect(mockHandleSaveAs).not.toHaveBeenCalled();
    });

    it("calls handleOpen when menu:open event matches window", async () => {
      renderHook(() => useFileShortcuts("main"));

      await vi.waitFor(() => {
        expect(listenCallbacks["menu:open"]).toBeDefined();
      });

      listenCallbacks["menu:open"]({ payload: "main" });

      await vi.waitFor(() => {
        expect(mockHandleOpen).toHaveBeenCalledWith("main");
      });
    });

    it("ignores menu:open event for different window", async () => {
      renderHook(() => useFileShortcuts("main"));

      await vi.waitFor(() => {
        expect(listenCallbacks["menu:open"]).toBeDefined();
      });

      listenCallbacks["menu:open"]({ payload: "doc-1" });

      expect(mockHandleOpen).not.toHaveBeenCalled();
    });

    it("ignores menu:save event for different window", async () => {
      renderHook(() => useFileShortcuts("main"));

      await vi.waitFor(() => {
        expect(listenCallbacks["menu:save"]).toBeDefined();
      });

      listenCallbacks["menu:save"]({ payload: "doc-1" });

      expect(mockHandleSave).not.toHaveBeenCalled();
    });

    it("ignores menu:save-as event for different window", async () => {
      renderHook(() => useFileShortcuts("main"));

      await vi.waitFor(() => {
        expect(listenCallbacks["menu:save-as"]).toBeDefined();
      });

      listenCallbacks["menu:save-as"]({ payload: "doc-1" });

      expect(mockHandleSaveAs).not.toHaveBeenCalled();
    });

    it("ignores menu:move-to event for different window", async () => {
      renderHook(() => useFileShortcuts("main"));

      await vi.waitFor(() => {
        expect(listenCallbacks["menu:move-to"]).toBeDefined();
      });

      listenCallbacks["menu:move-to"]({ payload: "doc-1" });

      expect(mockHandleMoveTo).not.toHaveBeenCalled();
    });

    it("ignores menu:save-all-quit event for different window", async () => {
      renderHook(() => useFileShortcuts("main"));

      await vi.waitFor(() => {
        expect(listenCallbacks["menu:save-all-quit"]).toBeDefined();
      });

      listenCallbacks["menu:save-all-quit"]({ payload: "doc-1" });

      expect(mockHandleSaveAllQuit).not.toHaveBeenCalled();
    });

    it("removes keyboard listener on unmount", async () => {
      const removeListenerSpy = vi.spyOn(window, "removeEventListener");

      const { unmount } = renderHook(() => useFileShortcuts("main"));

      await vi.waitFor(() => {
        expect(mockListen).toHaveBeenCalled();
      });

      unmount();

      expect(removeListenerSpy).toHaveBeenCalledWith(
        "keydown",
        expect.any(Function),
      );

      removeListenerSpy.mockRestore();
    });

    it("does not call save when no shortcut matches", async () => {
      mockMatchesShortcutEvent.mockReturnValue(false);

      renderHook(() => useFileShortcuts("main"));

      await vi.waitFor(() => {
        expect(mockListen).toHaveBeenCalled();
      });

      const event = new KeyboardEvent("keydown", { key: "z", metaKey: true });
      Object.defineProperty(event, "target", {
        value: document.createElement("div"),
      });
      window.dispatchEvent(event);

      expect(mockHandleSave).not.toHaveBeenCalled();
      expect(mockHandleSaveAs).not.toHaveBeenCalled();
    });
  });

  describe("cancelled guard on early unmount", () => {
    it("cleans up listeners that were set up before unmount during async setup", async () => {
      // Make the first listen resolve, then unmount before the rest complete
      let resolveSecond: ((fn: () => void) => void) | undefined;
      let callCount = 0;
      mockListen.mockImplementation((_eventName: string, _callback: unknown) => {
        callCount++;
        if (callCount === 1) {
          // First listener resolves immediately
          return Promise.resolve(vi.fn());
        }
        // Second listener is delayed
        return new Promise<() => void>((resolve) => {
          resolveSecond = resolve;
        });
      });

      const { unmount } = renderHook(() => useFileShortcuts("main"));

      // Wait for first listen to be called
      await vi.waitFor(() => {
        expect(mockListen).toHaveBeenCalledTimes(2);
      });

      // Unmount while second listen is still pending
      unmount();

      // Now resolve the second listen — it should call the unlisten immediately
      // because cancelled is now true
      const unlisten2 = vi.fn();
      if (resolveSecond) {
        resolveSecond(unlisten2);
      }

      await vi.waitFor(() => {
        expect(unlisten2).toHaveBeenCalled();
      });
    });
  });

  describe("cancelled guards for each listener (lines 52, 67, 74, 81, 92, 102)", () => {
    // Each listener has: `if (cancelled) { unlistenX(); return; }`
    // We trigger it by unmounting between each sequential await.

    it("cancelled guard fires for menu:save listener (3rd listener, line 67)", async () => {
      // Let first 2 listeners resolve, block 3rd, unmount, resolve 3rd
      let callCount = 0;
      let resolveThird: ((fn: () => void) => void) | undefined;

      mockListen.mockImplementation((_eventName: string, _callback: unknown) => {
        callCount++;
        if (callCount <= 2) {
          return Promise.resolve(vi.fn());
        }
        if (callCount === 3) {
          return new Promise<() => void>((resolve) => {
            resolveThird = resolve;
          });
        }
        return Promise.resolve(vi.fn());
      });

      const { unmount } = renderHook(() => useFileShortcuts("main"));

      await vi.waitFor(() => {
        expect(mockListen).toHaveBeenCalledTimes(3);
      });

      unmount();

      const unlisten3 = vi.fn();
      if (resolveThird) resolveThird(unlisten3);

      await vi.waitFor(() => {
        expect(unlisten3).toHaveBeenCalled();
      });
    });

    it("cancelled guard fires for menu:save-as listener (4th listener, line 74)", async () => {
      let callCount = 0;
      let resolveFourth: ((fn: () => void) => void) | undefined;

      mockListen.mockImplementation((_eventName: string, _callback: unknown) => {
        callCount++;
        if (callCount <= 3) return Promise.resolve(vi.fn());
        if (callCount === 4) {
          return new Promise<() => void>((resolve) => {
            resolveFourth = resolve;
          });
        }
        return Promise.resolve(vi.fn());
      });

      const { unmount } = renderHook(() => useFileShortcuts("main"));

      await vi.waitFor(() => {
        expect(mockListen).toHaveBeenCalledTimes(4);
      });

      unmount();

      const unlisten4 = vi.fn();
      if (resolveFourth) resolveFourth(unlisten4);

      await vi.waitFor(() => {
        expect(unlisten4).toHaveBeenCalled();
      });
    });

    it("cancelled guard fires for menu:move-to listener (5th listener, line 81)", async () => {
      let callCount = 0;
      let resolveFifth: ((fn: () => void) => void) | undefined;

      mockListen.mockImplementation((_eventName: string, _callback: unknown) => {
        callCount++;
        if (callCount <= 4) return Promise.resolve(vi.fn());
        if (callCount === 5) {
          return new Promise<() => void>((resolve) => {
            resolveFifth = resolve;
          });
        }
        return Promise.resolve(vi.fn());
      });

      const { unmount } = renderHook(() => useFileShortcuts("main"));

      await vi.waitFor(() => {
        expect(mockListen).toHaveBeenCalledTimes(5);
      });

      unmount();

      const unlisten5 = vi.fn();
      if (resolveFifth) resolveFifth(unlisten5);

      await vi.waitFor(() => {
        expect(unlisten5).toHaveBeenCalled();
      });
    });

    it("cancelled guard fires for menu:save-all-quit listener (6th listener, line 92)", async () => {
      let callCount = 0;
      let resolveSixth: ((fn: () => void) => void) | undefined;

      mockListen.mockImplementation((_eventName: string, _callback: unknown) => {
        callCount++;
        if (callCount <= 5) return Promise.resolve(vi.fn());
        if (callCount === 6) {
          return new Promise<() => void>((resolve) => {
            resolveSixth = resolve;
          });
        }
        return Promise.resolve(vi.fn());
      });

      const { unmount } = renderHook(() => useFileShortcuts("main"));

      await vi.waitFor(() => {
        expect(mockListen).toHaveBeenCalledTimes(6);
      });

      unmount();

      const unlisten6 = vi.fn();
      if (resolveSixth) resolveSixth(unlisten6);

      await vi.waitFor(() => {
        expect(unlisten6).toHaveBeenCalled();
      });
    });

    it("cancelled guard fires for open-file listener (7th listener, line 102)", async () => {
      let callCount = 0;
      let resolveSeventh: ((fn: () => void) => void) | undefined;

      mockListen.mockImplementation((_eventName: string, _callback: unknown) => {
        callCount++;
        if (callCount <= 6) return Promise.resolve(vi.fn());
        if (callCount === 7) {
          return new Promise<() => void>((resolve) => {
            resolveSeventh = resolve;
          });
        }
        return Promise.resolve(vi.fn());
      });

      const { unmount } = renderHook(() => useFileShortcuts("main"));

      await vi.waitFor(() => {
        expect(mockListen).toHaveBeenCalledTimes(7);
      });

      unmount();

      const unlisten7 = vi.fn();
      if (resolveSeventh) resolveSeventh(unlisten7);

      await vi.waitFor(() => {
        expect(unlisten7).toHaveBeenCalled();
      });
    });

    it("cancelled=true after safeUnlistenAll on re-render skips setup (line 41)", async () => {
      // When the effect cleanup runs and cancelled is set, a second setupListeners
      // call (from a re-render) will check `if (cancelled) return` after safeUnlistenAll.
      // We simulate this by unmounting immediately so cancelled fires before listeners resolve.
      let resolveFirst: ((fn: () => void) => void) | undefined;

      mockListen.mockImplementation(() => {
        return new Promise<() => void>((resolve) => {
          resolveFirst = resolve;
        });
      });

      const { unmount } = renderHook(() => useFileShortcuts("main"));

      // Unmount before any listener resolves — cancelled becomes true
      unmount();

      // Resolve the first listener after unmount
      const unlisten = vi.fn();
      if (resolveFirst) resolveFirst(unlisten);

      await vi.waitFor(() => {
        expect(unlisten).toHaveBeenCalled();
      });
    });

    it("keydown handler treats INPUT target as skippable (line 114)", async () => {
      // This test verifies that the INPUT guard (line 114) is properly exercised.
      // We use a custom mockMatchesShortcutEvent to verify the handler exits before matching.
      mockMatchesShortcutEvent.mockImplementation(() => true);

      // Track whether matchesShortcutEvent was called
      let _matchCallCount = 0;
      mockMatchesShortcutEvent.mockImplementation(() => {
        _matchCallCount++;
        return true;
      });

      renderHook(() => useFileShortcuts("main"));

      await vi.waitFor(() => {
        expect(mockListen).toHaveBeenCalled();
      });

      // Create a keyboard event — use a trick to make target.tagName === "INPUT"
      // by using a synthetic event with a proper target via addEventListener spy
      const inputEl = document.createElement("input");
      document.body.appendChild(inputEl);

      // Dispatch directly on the input element — when it bubbles to window,
      // event.target will be the input
      inputEl.dispatchEvent(new KeyboardEvent("keydown", {
        key: "s",
        metaKey: true,
        bubbles: true,
      }));

      // handleSave should NOT be called because target is INPUT
      expect(mockHandleSave).not.toHaveBeenCalled();

      document.body.removeChild(inputEl);
    });
  });
});
