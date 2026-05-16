/**
 * Tests for useReloadGuard — the runtime wiring that prevents page reload
 * in the webview. Covers the production keydown / beforeunload /
 * contextmenu listener path AND the dev-only dirty-doc warning path.
 *
 * The pure helpers (shouldBlockReload, isReloadShortcut, etc.) are
 * already tested in src/utils/reloadGuard.test.ts; this file covers the
 * hook wiring only.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const {
  mockShouldBlock,
  mockIsReload,
  mockIsTermFocused,
  mockIsCtrlR,
  mockGetWarning,
  mockGetAllDirty,
} = vi.hoisted(() => ({
  mockShouldBlock: vi.fn(),
  mockIsReload: vi.fn(),
  mockIsTermFocused: vi.fn(),
  mockIsCtrlR: vi.fn(),
  mockGetWarning: vi.fn(),
  mockGetAllDirty: vi.fn(),
}));

vi.mock("@/utils/reloadGuard", () => ({
  shouldBlockReload: (...args: unknown[]) => mockShouldBlock(...args),
  isReloadShortcut: (...args: unknown[]) => mockIsReload(...args),
  isTerminalFocused: (...args: unknown[]) => mockIsTermFocused(...args),
  isCtrlR: (...args: unknown[]) => mockIsCtrlR(...args),
  getReloadWarningMessage: (...args: unknown[]) => mockGetWarning(...args),
}));

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: () => ({ getAllDirtyDocuments: mockGetAllDirty }),
  },
}));

import { useReloadGuard } from "./useReloadGuard";

/** Capture an event listener installed on `window`. */
function captureListener(
  type: string,
): { handler: EventListener; capture: boolean } {
  const addSpy = vi.spyOn(window, "addEventListener");
  return {
    get handler() {
      const call = addSpy.mock.calls.find((c) => c[0] === type);
      return (call?.[1] as EventListener) ?? (() => {});
    },
    get capture() {
      const call = addSpy.mock.calls.find((c) => c[0] === type);
      return call?.[2] === true;
    },
  };
}

function makeKeyboardEvent(): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key: "r" });
  Object.defineProperty(e, "preventDefault", { value: vi.fn() });
  Object.defineProperty(e, "stopPropagation", { value: vi.fn() });
  return e;
}

function makeBeforeUnloadEvent(): BeforeUnloadEvent {
  const e = new Event("beforeunload") as BeforeUnloadEvent;
  Object.defineProperty(e, "preventDefault", { value: vi.fn() });
  Object.defineProperty(e, "returnValue", {
    value: "",
    writable: true,
  });
  return e;
}

function makeContextMenuEvent(): MouseEvent {
  const e = new MouseEvent("contextmenu");
  Object.defineProperty(e, "preventDefault", { value: vi.fn() });
  return e;
}

beforeEach(() => {
  mockShouldBlock.mockReset();
  mockIsReload.mockReset();
  mockIsTermFocused.mockReset();
  mockIsCtrlR.mockReset();
  mockGetWarning.mockReset();
  mockGetAllDirty.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("useReloadGuard — production path (DEV=false)", () => {
  beforeEach(() => {
    vi.stubEnv("DEV", false);
  });

  it("attaches keydown / beforeunload / contextmenu listeners", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const { unmount } = renderHook(() => useReloadGuard());

    const types = addSpy.mock.calls.map((c) => c[0]);
    expect(types).toContain("keydown");
    expect(types).toContain("beforeunload");
    expect(types).toContain("contextmenu");

    // keydown must be in capture phase to intercept before app handlers.
    const keydownCall = addSpy.mock.calls.find((c) => c[0] === "keydown");
    expect(keydownCall?.[2]).toBe(true);

    unmount();
  });

  it("removes all three listeners on unmount", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useReloadGuard());
    unmount();

    const types = removeSpy.mock.calls.map((c) => c[0]);
    expect(types).toContain("keydown");
    expect(types).toContain("beforeunload");
    expect(types).toContain("contextmenu");
  });

  it("calls preventDefault + stopPropagation on a reload shortcut when terminal is NOT focused", () => {
    const keyListener = captureListener("keydown");
    renderHook(() => useReloadGuard());

    mockIsReload.mockReturnValue(true);
    mockIsTermFocused.mockReturnValue(false);
    mockIsCtrlR.mockReturnValue(true);

    const event = makeKeyboardEvent();
    keyListener.handler(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
  });

  it("lets Ctrl+R through when the terminal IS focused (shell reverse-i-search)", () => {
    const keyListener = captureListener("keydown");
    renderHook(() => useReloadGuard());

    mockIsReload.mockReturnValue(true);
    mockIsTermFocused.mockReturnValue(true);
    mockIsCtrlR.mockReturnValue(true);

    const event = makeKeyboardEvent();
    keyListener.handler(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });

  it("still blocks Cmd+R inside the terminal (only Ctrl+R passes through)", () => {
    const keyListener = captureListener("keydown");
    renderHook(() => useReloadGuard());

    mockIsReload.mockReturnValue(true);
    mockIsTermFocused.mockReturnValue(true);
    mockIsCtrlR.mockReturnValue(false); // Cmd+R, not Ctrl+R

    const event = makeKeyboardEvent();
    keyListener.handler(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
  });

  it("does NOT call preventDefault on a non-reload keydown", () => {
    const keyListener = captureListener("keydown");
    renderHook(() => useReloadGuard());

    mockIsReload.mockReturnValue(false);

    const event = makeKeyboardEvent();
    keyListener.handler(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("beforeunload always preventDefaults and sets returnValue", () => {
    const beforeListener = captureListener("beforeunload");
    renderHook(() => useReloadGuard());

    const event = makeBeforeUnloadEvent();
    beforeListener.handler(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.returnValue).toBe("");
  });

  it("contextmenu always preventDefaults", () => {
    const ctxListener = captureListener("contextmenu");
    renderHook(() => useReloadGuard());

    const event = makeContextMenuEvent();
    ctxListener.handler(event);

    expect(event.preventDefault).toHaveBeenCalled();
  });
});

describe("useReloadGuard — dev path (DEV=true)", () => {
  beforeEach(() => {
    vi.stubEnv("DEV", true);
  });

  it("attaches ONLY a beforeunload listener (no keydown, no contextmenu)", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    renderHook(() => useReloadGuard());

    const types = addSpy.mock.calls.map((c) => c[0]);
    expect(types).toContain("beforeunload");
    expect(types).not.toContain("keydown");
    expect(types).not.toContain("contextmenu");
  });

  it("blocks reload + returns warning when dirty docs exist", () => {
    const beforeListener = captureListener("beforeunload");
    mockGetAllDirty.mockReturnValue(["tab-1", "tab-2"]);
    mockShouldBlock.mockReturnValue({ shouldBlock: true, count: 2 });
    mockGetWarning.mockReturnValue("2 unsaved");
    renderHook(() => useReloadGuard());

    const event = makeBeforeUnloadEvent();
    const result = (
      beforeListener.handler as unknown as (
        e: BeforeUnloadEvent,
      ) => string | undefined
    )(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.returnValue).toBe("");
    expect(result).toBe("2 unsaved");
  });

  it("returns undefined and does NOT preventDefault when no dirty docs", () => {
    const beforeListener = captureListener("beforeunload");
    mockGetAllDirty.mockReturnValue([]);
    mockShouldBlock.mockReturnValue({ shouldBlock: false, count: 0 });
    renderHook(() => useReloadGuard());

    const event = makeBeforeUnloadEvent();
    const result = (
      beforeListener.handler as unknown as (
        e: BeforeUnloadEvent,
      ) => string | undefined
    )(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it("removes the beforeunload listener on unmount", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useReloadGuard());
    unmount();

    const types = removeSpy.mock.calls.map((c) => c[0]);
    expect(types).toContain("beforeunload");
  });
});
