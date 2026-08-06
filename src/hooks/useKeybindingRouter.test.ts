// WI-3.1 — the window capture adapter: resolve → gate → execute through the bus.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("@/utils/shortcutMatch", () => ({ isMacPlatform: () => true }));

const mockExecute = vi.fn(async () => true);
vi.mock("@/services/commands", () => ({
  executeCommand: (...a: unknown[]) => mockExecute(...a),
}));

let keyMap: Record<string, string> = { commandPalette: "Mod-k" };
vi.mock("@/stores/settingsStore/shortcuts", () => ({
  useShortcutsStore: {
    getState: () => ({ getShortcut: (id: string) => keyMap[id] ?? "" }),
    subscribe: () => () => {},
  },
}));
vi.mock("@/contexts/WindowContext", () => ({ useWindowLabel: () => "main" }));
vi.mock("@/stores/uiStore", () => ({
  useUIStore: { getState: () => ({ sourceMode: false }) },
}));

let composing = false;
vi.mock("@/utils/imeGuard", () => ({ isImeKeyEvent: () => composing }));

import { useKeybindingRouter } from "./useKeybindingRouter";

function press(init: Partial<KeyboardEvent> & { code: string }) {
  const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(e);
  return e;
}

beforeEach(() => {
  keyMap = { commandPalette: "Mod-k" };
  composing = false;
  mockExecute.mockClear();
});

describe("useKeybindingRouter", () => {
  it("executes the resolved command through the bus and consumes the event", () => {
    renderHook(() => useKeybindingRouter());
    const e = press({ code: "KeyK", metaKey: true });
    expect(mockExecute).toHaveBeenCalledWith(
      "app.commandPalette",
      null,
      expect.objectContaining({ windowLabel: "main", activeScopes: expect.arrayContaining(["window"]) }),
    );
    expect(e.defaultPrevented).toBe(true);
  });

  it("ignores an unbound chord", () => {
    renderHook(() => useKeybindingRouter());
    press({ code: "KeyJ", metaKey: true });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("IME-blocks the binding during composition", () => {
    composing = true;
    renderHook(() => useKeybindingRouter());
    press({ code: "KeyK", metaKey: true });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("denies repeat (held key) for a repeat:'deny' binding", () => {
    renderHook(() => useKeybindingRouter());
    press({ code: "KeyK", metaKey: true, repeat: true });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("picks up a rebind without remount (reactivity) — but here the store is static", () => {
    renderHook(() => useKeybindingRouter());
    // Sanity: the same chord still resolves after a re-press.
    press({ code: "KeyK", metaKey: true });
    press({ code: "KeyK", metaKey: true });
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it("removes its listener on unmount", () => {
    const { unmount } = renderHook(() => useKeybindingRouter());
    unmount();
    press({ code: "KeyK", metaKey: true });
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
