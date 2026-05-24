import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(vi.fn())),
}));

vi.mock("@/utils/debug", () => ({
  outlineSyncError: vi.fn(),
}));

vi.mock("@/utils/safeUnlisten", () => ({
  safeUnlisten: vi.fn(),
}));

vi.mock("@/services/editor/tiptapView", () => ({
  getTiptapEditorDom: vi.fn((view) => view?._dom ?? null),
}));

const mockSetActiveHeadingLine = vi.fn();
vi.mock("@/stores/uiStore", () => ({
  useUIStore: {
    getState: () => ({ setActiveHeadingLine: mockSetActiveHeadingLine }),
  },
}));

import { renderHook } from "@testing-library/react";
import { useOutlineSync } from "../useOutlineSync";

function makeMockView(headingCount: number) {
  const dom = document.createElement("div");
  const mockDoc = {
    descendants: vi.fn((cb: (node: { type: { name: string } }, pos: number) => boolean | void) => {
      for (let i = 0; i < headingCount; i++) {
        const result = cb({ type: { name: "heading" } }, i * 100);
        if (result === false) break;
      }
    }),
  };
  return {
    view: { state: { selection: { anchor: 250 }, doc: mockDoc }, _dom: dom },
    dom,
  };
}

describe("useOutlineSync debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not fire after 16ms (one rAF frame) — proves debounce, not rAF", () => {
    const { view, dom } = makeMockView(5);
    renderHook(() => useOutlineSync(() => view as any));

    const callsAfterInit = mockSetActiveHeadingLine.mock.calls.length;
    dom.dispatchEvent(new Event("keyup"));

    vi.advanceTimersByTime(16); // rAF fires at ~16ms
    expect(mockSetActiveHeadingLine).toHaveBeenCalledTimes(callsAfterInit);
  });

  it("fires after 250ms debounce delay", () => {
    const { view, dom } = makeMockView(5);
    renderHook(() => useOutlineSync(() => view as any));

    const callsAfterInit = mockSetActiveHeadingLine.mock.calls.length;
    dom.dispatchEvent(new Event("keyup"));

    vi.advanceTimersByTime(250);
    expect(mockSetActiveHeadingLine).toHaveBeenCalledTimes(callsAfterInit + 1);
  });

  it("coalesces rapid events into single update", () => {
    const { view, dom } = makeMockView(5);
    renderHook(() => useOutlineSync(() => view as any));

    const callsAfterInit = mockSetActiveHeadingLine.mock.calls.length;

    for (let i = 0; i < 10; i++) {
      dom.dispatchEvent(new Event("keyup"));
    }
    vi.advanceTimersByTime(250);

    expect(mockSetActiveHeadingLine).toHaveBeenCalledTimes(callsAfterInit + 1);
  });
});
