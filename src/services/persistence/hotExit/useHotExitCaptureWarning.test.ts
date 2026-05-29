/**
 * Tests for useHotExitCaptureWarning (#969).
 *
 * The partial-capture event previously had no frontend listener, so a
 * timed-out window's dropped edits were silent. This hook must register a
 * listener and surface a warning toast when the event fires.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const listeners = new Map<string, (e: { payload: unknown }) => void>();
const mockListen = vi.fn(
  (event: string, cb: (e: { payload: unknown }) => void) => {
    listeners.set(event, cb);
    return Promise.resolve(() => listeners.delete(event));
  },
);
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) =>
    mockListen(...(args as [string, (e: { payload: unknown }) => void])),
}));

const mockWarning = vi.fn();
vi.mock("@/services/ime/imeToast", () => ({
  imeToast: { warning: (...args: unknown[]) => mockWarning(...args) },
}));

vi.mock("@/i18n", () => ({
  // Passthrough that echoes the key + interpolated windows for assertions.
  default: {
    t: (key: string, opts?: { windows?: string }) =>
      opts?.windows ? `${key}|${opts.windows}` : key,
  },
}));

import { useHotExitCaptureWarning } from "./useHotExitCaptureWarning";

beforeEach(() => {
  listeners.clear();
  mockListen.mockClear();
  mockWarning.mockClear();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("useHotExitCaptureWarning", () => {
  it("registers a listener for the partial-capture event", async () => {
    renderHook(() => useHotExitCaptureWarning());
    await flush();
    expect(mockListen).toHaveBeenCalledWith(
      "hot-exit:partial-capture",
      expect.any(Function),
    );
  });

  it("shows a warning toast naming the missing windows when capture is partial", async () => {
    renderHook(() => useHotExitCaptureWarning());
    await flush();

    listeners.get("hot-exit:partial-capture")?.({
      payload: { captured: 1, expected: 2, missing: ["doc-1", "doc-2"] },
    });

    expect(mockWarning).toHaveBeenCalledTimes(1);
    const [title, opts] = mockWarning.mock.calls[0] as [
      string,
      { description: string },
    ];
    expect(title).toBe("common:hotExit.partialCapture.title");
    expect(opts.description).toContain("doc-1, doc-2");
  });

  it("falls back to a generic phrase when no window labels are provided", async () => {
    renderHook(() => useHotExitCaptureWarning());
    await flush();

    listeners.get("hot-exit:partial-capture")?.({ payload: {} });

    expect(mockWarning).toHaveBeenCalledTimes(1);
    const [, opts] = mockWarning.mock.calls[0] as [string, { description: string }];
    expect(opts.description).toContain(
      "common:hotExit.partialCapture.unknownWindows",
    );
  });

  it("removes its listeners on unmount", async () => {
    const { unmount } = renderHook(() => useHotExitCaptureWarning());
    await flush();
    expect(listeners.has("hot-exit:partial-capture")).toBe(true);
    unmount();
    expect(listeners.has("hot-exit:partial-capture")).toBe(false);
  });
});
