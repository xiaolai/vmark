// useSearchCommands — Find/Replace menu-event routing for the current
// window: window-label filtering, FindBar toggle + bar mutual
// exclusivity, find-next/prev open-or-navigate branching, the
// use-selection DOM event, and listener cleanup on unmount.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

type MenuHandler = (event: { payload: string }) => void;

const handlers = vi.hoisted(() => new Map<string, MenuHandler>());
const unlisteners = vi.hoisted(() => new Map<string, ReturnType<typeof vi.fn>>());
const listenMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    label: "main",
    listen: async (event: string, handler: MenuHandler) => {
      listenMock(event);
      handlers.set(event, handler);
      const unlisten = vi.fn();
      unlisteners.set(event, unlisten);
      return unlisten;
    },
  }),
}));

import { useUIStore } from "@/stores/uiStore";
import { useSearchCommands } from "./useSearchCommands";

function fire(event: string, payload = "main") {
  const handler = handlers.get(event);
  if (!handler) throw new Error(`no handler registered for ${event}`);
  handler({ payload });
}

async function mountHook() {
  const utils = renderHook(() => useSearchCommands());
  await vi.waitFor(() => expect(listenMock).toHaveBeenCalledTimes(4));
  return utils;
}

beforeEach(() => {
  handlers.clear();
  unlisteners.clear();
  listenMock.mockClear();
  useUIStore.setState({
    statusBarVisible: true,
    universalToolbarVisible: false,
  } as never);
  useUIStore.getState().searchClose();
  useUIStore.getState().searchSetMatches(0, -1);
});

describe("useSearchCommands", () => {
  it("registers the four Find/Replace menu events", async () => {
    const { unmount } = await mountHook();
    expect([...handlers.keys()].sort()).toEqual([
      "menu:find-next",
      "menu:find-prev",
      "menu:find-replace",
      "menu:use-selection-find",
    ]);
    unmount();
  });

  it("find-replace opens the FindBar, displaces the StatusBar, and closes the toolbar", async () => {
    useUIStore.setState({ universalToolbarVisible: true } as never);
    const { unmount } = await mountHook();

    fire("menu:find-replace");

    const ui = useUIStore.getState();
    expect(ui.search.isOpen).toBe(true);
    expect(ui.statusBarVisible).toBe(false);
    expect(ui.universalToolbarVisible).toBe(false);
    unmount();
  });

  it("find-replace toggles the FindBar closed on the second event", async () => {
    const { unmount } = await mountHook();
    fire("menu:find-replace");
    fire("menu:find-replace");
    expect(useUIStore.getState().search.isOpen).toBe(false);
    unmount();
  });

  it("ignores menu events targeted at another window", async () => {
    const { unmount } = await mountHook();
    fire("menu:find-replace", "doc-2");
    fire("menu:find-next", "doc-2");
    const ui = useUIStore.getState();
    expect(ui.search.isOpen).toBe(false);
    expect(ui.statusBarVisible).toBe(true);
    unmount();
  });

  it("find-next opens the bar when closed instead of navigating", async () => {
    const { unmount } = await mountHook();
    useUIStore.getState().searchSetMatches(3, 0);

    fire("menu:find-next");

    const ui = useUIStore.getState();
    expect(ui.search.isOpen).toBe(true);
    // No navigation on the open step.
    expect(ui.search.currentIndex).toBe(0);
    unmount();
  });

  it("find-next advances the current match when the bar is open", async () => {
    const { unmount } = await mountHook();
    useUIStore.getState().searchOpen();
    useUIStore.getState().searchSetMatches(3, 0);

    fire("menu:find-next");

    expect(useUIStore.getState().search.currentIndex).toBe(1);
    unmount();
  });

  it("find-prev opens the bar when closed, and wraps backwards when open", async () => {
    const { unmount } = await mountHook();

    fire("menu:find-prev");
    expect(useUIStore.getState().search.isOpen).toBe(true);

    useUIStore.getState().searchSetMatches(3, 0);
    fire("menu:find-prev");
    expect(useUIStore.getState().search.currentIndex).toBe(2);
    unmount();
  });

  it("use-selection-find dispatches the use-selection-for-find DOM event", async () => {
    const { unmount } = await mountHook();
    const domListener = vi.fn();
    window.addEventListener("use-selection-for-find", domListener);

    fire("menu:use-selection-find");
    expect(domListener).toHaveBeenCalledTimes(1);

    fire("menu:use-selection-find", "other-window");
    expect(domListener).toHaveBeenCalledTimes(1);

    window.removeEventListener("use-selection-for-find", domListener);
    unmount();
  });

  it("detaches every Tauri listener on unmount", async () => {
    const { unmount } = await mountHook();
    unmount();
    expect(unlisteners.size).toBe(4);
    for (const unlisten of unlisteners.values()) {
      expect(unlisten).toHaveBeenCalledTimes(1);
    }
  });

  it("does not leak a listener when unmounted mid-setup (cancelled race)", async () => {
    // Hold the first listen() promise so unmount happens before it resolves.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const pendingUnlisten = vi.fn();
    const gatedListen = vi.fn(async () => {
      await gate;
      return pendingUnlisten;
    });
    const mod = await import("@tauri-apps/api/webviewWindow");
    const spy = vi
      .spyOn(mod, "getCurrentWebviewWindow")
      .mockReturnValue({ label: "main", listen: gatedListen } as never);

    const { unmount } = renderHook(() => useSearchCommands());
    await vi.waitFor(() => expect(gatedListen).toHaveBeenCalled());
    unmount();
    release();
    // The resolved listener must be torn down immediately by the cancelled guard.
    await vi.waitFor(() => expect(pendingUnlisten).toHaveBeenCalledTimes(1));
    spy.mockRestore();
  });

  it("survives a listener registration failure without throwing", async () => {
    const mod = await import("@tauri-apps/api/webviewWindow");
    const spy = vi.spyOn(mod, "getCurrentWebviewWindow").mockReturnValue({
      label: "main",
      listen: async () => {
        throw new Error("ipc down");
      },
    } as never);

    const { unmount } = renderHook(() => useSearchCommands());
    // Flush the rejected setup chain; an unhandled rejection would fail the run.
    await Promise.resolve();
    await Promise.resolve();
    unmount();
    spy.mockRestore();
  });
});
