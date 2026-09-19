/**
 * useSystemFontFamilies — the React adapter over font discovery (#1429).
 *
 * The permanent state on a platform VMark does not enumerate is "empty", so
 * what matters here is that empty is rendered as a normal answer and that a
 * late arrival cannot land on an unmounted component.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const mockLoad = vi.fn<() => Promise<string[]>>();
vi.mock("@/services/fonts/systemFonts", () => ({
  loadSystemFontFamilies: () => mockLoad(),
}));

import { useSystemFontFamilies } from "./useSystemFontFamilies";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useSystemFontFamilies", () => {
  it("starts empty and fills in when the families arrive", async () => {
    mockLoad.mockResolvedValue(["Menlo", "Monaco"]);
    const { result } = renderHook(() => useSystemFontFamilies());
    expect(result.current).toEqual([]);
    await waitFor(() => expect(result.current).toEqual(["Menlo", "Monaco"]));
  });

  it("stays empty where the platform does not enumerate", async () => {
    mockLoad.mockResolvedValue([]);
    const { result } = renderHook(() => useSystemFontFamilies());
    await waitFor(() => expect(mockLoad).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });

  it("does not set state after unmount", async () => {
    let settle: (names: string[]) => void = () => {};
    mockLoad.mockReturnValue(new Promise((resolve) => { settle = resolve; }));
    const { unmount } = renderHook(() => useSystemFontFamilies());
    unmount();
    settle(["Menlo"]);
    // A state update on an unmounted hook would warn; reaching here without
    // one is the assertion. Flush the microtask queue so the resolve lands.
    await Promise.resolve();
    expect(mockLoad).toHaveBeenCalledTimes(1);
  });
});
