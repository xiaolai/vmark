// @vitest-environment node
/**
 * Tests for installed-font-family discovery (#1429).
 *
 * @module services/fonts/systemFonts.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import { loadSystemFontFamilies, __resetSystemFontCache } from "./systemFonts";

beforeEach(() => {
  vi.clearAllMocks();
  __resetSystemFontCache();
});

describe("loadSystemFontFamilies", () => {
  it("asks the backend once and caches the answer", async () => {
    mockInvoke.mockResolvedValue(["Menlo", "Monaco"]);
    expect(await loadSystemFontFamilies()).toEqual(["Menlo", "Monaco"]);
    expect(await loadSystemFontFamilies()).toEqual(["Menlo", "Monaco"]);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith("list_system_font_families");
  });

  it("shares one in-flight request between concurrent callers", async () => {
    mockInvoke.mockResolvedValue(["Menlo"]);
    const [a, b] = await Promise.all([loadSystemFontFamilies(), loadSystemFontFamilies()]);
    expect(a).toEqual(["Menlo"]);
    expect(b).toEqual(["Menlo"]);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("answers an empty list where the platform does not enumerate", async () => {
    mockInvoke.mockResolvedValue([]);
    expect(await loadSystemFontFamilies()).toEqual([]);
  });

  it("degrades to an empty list rather than rejecting", async () => {
    // Suggestions are a convenience; a typed family name still works. A
    // rejection here would break the settings panel over a nicety.
    mockInvoke.mockRejectedValue(new Error("no such command"));
    await expect(loadSystemFontFamilies()).resolves.toEqual([]);
  });

  it("retries after a failure instead of caching the empty result", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("boom"));
    expect(await loadSystemFontFamilies()).toEqual([]);
    mockInvoke.mockResolvedValue(["Menlo"]);
    expect(await loadSystemFontFamilies()).toEqual(["Menlo"]);
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("drops anything that is not a usable family name", async () => {
    // The command is typed, but the boundary is still a boundary: a malformed
    // payload must not put a non-string into a CSS family reference.
    mockInvoke.mockResolvedValue(["Menlo", 42, null, "", "   ", 'X"; color: red']);
    expect(await loadSystemFontFamilies()).toEqual(["Menlo"]);
  });

  it("answers an empty list when the payload is not an array", async () => {
    mockInvoke.mockResolvedValue({ families: ["Menlo"] });
    await expect(loadSystemFontFamilies()).resolves.toEqual([]);
  });
});
