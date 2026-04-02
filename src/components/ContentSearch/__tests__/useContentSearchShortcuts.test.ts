/**
 * Tests for useContentSearchShortcuts
 *
 * Covers: keyboard shortcut registration and menu event listener.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useContentSearchShortcuts } from "../useContentSearchShortcuts";
import { useContentSearchStore } from "@/stores/contentSearchStore";

const mockListen = vi.fn().mockResolvedValue(() => {});
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("useContentSearchShortcuts", () => {
  beforeEach(() => {
    mockListen.mockClear();
    useContentSearchStore.setState({ isOpen: false });
  });

  it("registers menu:find-in-files listener", () => {
    renderHook(() => useContentSearchShortcuts());
    expect(mockListen).toHaveBeenCalledWith(
      "menu:find-in-files",
      expect.any(Function)
    );
  });

  it("opens content search when menu event fires", () => {
    renderHook(() => useContentSearchShortcuts());

    // Find the callback for menu:find-in-files
    const call = mockListen.mock.calls.find(
      (c: unknown[]) => c[0] === "menu:find-in-files"
    );
    expect(call).toBeDefined();

    // Invoke the callback
    const callback = call![1] as () => void;
    callback();

    expect(useContentSearchStore.getState().isOpen).toBe(true);
  });
});
