import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useQuickOpenStore } from "@/components/QuickOpen/quickOpenStore";

const listenCallbacks = new Map<string, (...args: unknown[]) => void>();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
    listenCallbacks.set(event, cb);
    return Promise.resolve(vi.fn());
  }),
}));

vi.mock("@/stores/settingsStore", () => ({
  useShortcutsStore: {
    getState: () => ({ getShortcut: (id: string) => id === "quickOpen" ? "Mod-o" : "" }),
  },
}));

vi.mock("@/utils/shortcutMatch", () => ({
  matchesShortcutEvent: vi.fn((e: KeyboardEvent, key: string) => {
    return key === "Mod-o" && e.key === "o" && e.metaKey;
  }),
}));

vi.mock("@/utils/imeGuard", () => ({
  isImeKeyEvent: vi.fn(() => false),
}));

vi.mock("@/utils/safeUnlisten", () => ({
  safeUnlistenAsync: vi.fn(),
}));

import { useQuickOpenShortcuts } from "./useQuickOpenShortcuts";

beforeEach(() => {
  useQuickOpenStore.setState({ isOpen: false });
  listenCallbacks.clear();
});

describe("useQuickOpenShortcuts", () => {
  it("toggles Quick Open on Cmd+O keydown", () => {
    renderHook(() => useQuickOpenShortcuts());

    const event = new KeyboardEvent("keydown", { key: "o", metaKey: true });
    window.dispatchEvent(event);

    expect(useQuickOpenStore.getState().isOpen).toBe(true);
  });

  it("closes Quick Open on second Cmd+O", () => {
    useQuickOpenStore.setState({ isOpen: true });
    renderHook(() => useQuickOpenShortcuts());

    const event = new KeyboardEvent("keydown", { key: "o", metaKey: true });
    window.dispatchEvent(event);

    expect(useQuickOpenStore.getState().isOpen).toBe(false);
  });

  it("ignores repeat key events", () => {
    renderHook(() => useQuickOpenShortcuts());

    const event = new KeyboardEvent("keydown", { key: "o", metaKey: true, repeat: true });
    window.dispatchEvent(event);

    expect(useQuickOpenStore.getState().isOpen).toBe(false);
  });

  it("opens Quick Open on menu:quick-open event", async () => {
    renderHook(() => useQuickOpenShortcuts());

    // Wait for listen promise to resolve and register callback
    await vi.waitFor(() => {
      expect(listenCallbacks.has("menu:quick-open")).toBe(true);
    });

    listenCallbacks.get("menu:quick-open")!();
    expect(useQuickOpenStore.getState().isOpen).toBe(true);
  });

  it("does nothing when shortcut does not match", () => {
    renderHook(() => useQuickOpenShortcuts());

    // Key that doesn't match the quickOpen shortcut
    const event = new KeyboardEvent("keydown", { key: "x" });
    window.dispatchEvent(event);

    expect(useQuickOpenStore.getState().isOpen).toBe(false);
  });

  it("removes listener on unmount", () => {
    const { unmount } = renderHook(() => useQuickOpenShortcuts());
    unmount();

    const event = new KeyboardEvent("keydown", { key: "o", metaKey: true });
    window.dispatchEvent(event);

    expect(useQuickOpenStore.getState().isOpen).toBe(false);
  });
});
