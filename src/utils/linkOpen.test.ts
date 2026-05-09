/**
 * Tests for utils/linkOpen — href classification + cross-file open emit.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — hoisted so vi.mock factories can reference them.
// ---------------------------------------------------------------------------

const { mockEmit, mockGetActiveTab } = vi.hoisted(() => ({
  mockEmit: vi.fn(() => Promise.resolve()),
  mockGetActiveTab: vi.fn<() => { id: string; filePath: string | null } | null>(
    () => ({ id: "tab-1", filePath: "/repo/docs/index.md" }),
  ),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main", emit: mockEmit }),
}));

vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: () => ({
      getActiveTab: mockGetActiveTab,
    }),
  },
}));

vi.mock("@/utils/debug", () => ({
  linkPopupError: vi.fn(),
}));

// ---------------------------------------------------------------------------

import { classifyHref, openFilepathLink } from "./linkOpen";

describe("classifyHref", () => {
  it("classifies fragment-only as 'fragment'", () => {
    expect(classifyHref("#section")).toBe("fragment");
    expect(classifyHref("#")).toBe("fragment");
  });

  it("classifies http/https URLs as 'external'", () => {
    expect(classifyHref("http://example.com")).toBe("external");
    expect(classifyHref("https://example.com/path?q=1#x")).toBe("external");
  });

  it("classifies mailto/tel/file URIs as 'external'", () => {
    expect(classifyHref("mailto:user@example.com")).toBe("external");
    expect(classifyHref("tel:+1234567890")).toBe("external");
    expect(classifyHref("file:///etc/hosts")).toBe("external");
  });

  it("classifies relative paths as 'filepath'", () => {
    expect(classifyHref("../foo.md")).toBe("filepath");
    expect(classifyHref("./bar.md")).toBe("filepath");
    expect(classifyHref("baz.md")).toBe("filepath");
    expect(classifyHref("../appendix/cards.md#bern")).toBe("filepath");
  });

  it("classifies POSIX absolute paths as 'filepath'", () => {
    expect(classifyHref("/repo/docs/foo.md")).toBe("filepath");
  });

  it("classifies a Windows-style drive letter as 'filepath' (not external)", () => {
    // `C:` has only one char before the colon, so it must NOT match a URI scheme.
    expect(classifyHref("C:/Users/me/foo.md")).toBe("filepath");
  });

  it("treats empty href as 'filepath' (caller filters empties separately)", () => {
    expect(classifyHref("")).toBe("filepath");
  });
});

describe("openFilepathLink", () => {
  beforeEach(() => {
    mockEmit.mockClear();
    mockGetActiveTab.mockReset();
    mockGetActiveTab.mockReturnValue({ id: "tab-1", filePath: "/repo/docs/index.md" });
  });

  it("returns false for empty href without emitting", async () => {
    const result = await openFilepathLink("");
    expect(result).toBe(false);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("resolves a relative href against the active doc and emits open-file", async () => {
    const result = await openFilepathLink("../appendix/cards.md#bern");
    expect(result).toBe(true);
    expect(mockEmit).toHaveBeenCalledWith("open-file", {
      path: "/repo/appendix/cards.md",
    });
  });

  it("resolves a same-directory href", async () => {
    const result = await openFilepathLink("./neighbour.md");
    expect(result).toBe(true);
    expect(mockEmit).toHaveBeenCalledWith("open-file", {
      path: "/repo/docs/neighbour.md",
    });
  });

  it("strips the fragment before emitting", async () => {
    await openFilepathLink("./neighbour.md#anchor");
    expect(mockEmit).toHaveBeenCalledWith("open-file", {
      path: "/repo/docs/neighbour.md",
    });
  });

  it("returns false when active tab is untitled and href is relative", async () => {
    mockGetActiveTab.mockReturnValue({ id: "tab-1", filePath: null });
    const result = await openFilepathLink("./neighbour.md");
    expect(result).toBe(false);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("falls through to absolute path (minus fragment) when active tab is untitled", async () => {
    mockGetActiveTab.mockReturnValue({ id: "tab-1", filePath: null });
    const result = await openFilepathLink("/abs/path/foo.md#x");
    expect(result).toBe(true);
    expect(mockEmit).toHaveBeenCalledWith("open-file", { path: "/abs/path/foo.md" });
  });

  it("returns false when no active tab is available", async () => {
    mockGetActiveTab.mockReturnValue(null);
    const result = await openFilepathLink("./neighbour.md");
    expect(result).toBe(false);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("passes through a Windows absolute path with a titled active doc (does not base-prefix)", async () => {
    mockGetActiveTab.mockReturnValue({ id: "tab-1", filePath: "/repo/docs/index.md" });
    const result = await openFilepathLink("C:/Users/me/foo.md#x");
    expect(result).toBe(true);
    expect(mockEmit).toHaveBeenCalledWith("open-file", {
      path: "C:/Users/me/foo.md",
    });
  });

  it("normalizes Windows backslashes to forward slashes", async () => {
    mockGetActiveTab.mockReturnValue({ id: "tab-1", filePath: "/repo/docs/index.md" });
    const result = await openFilepathLink("C:\\Users\\me\\foo.md");
    expect(result).toBe(true);
    expect(mockEmit).toHaveBeenCalledWith("open-file", {
      path: "C:/Users/me/foo.md",
    });
  });

  it("passes through a Windows absolute path even when active tab is untitled", async () => {
    mockGetActiveTab.mockReturnValue({ id: "tab-1", filePath: null });
    const result = await openFilepathLink("D:/work/notes.md#h");
    expect(result).toBe(true);
    expect(mockEmit).toHaveBeenCalledWith("open-file", {
      path: "D:/work/notes.md",
    });
  });

  it("returns false and logs when emit rejects", async () => {
    const { linkPopupError } = await import("@/utils/debug");
    mockEmit.mockRejectedValueOnce(new Error("emit failed"));
    const result = await openFilepathLink("../appendix/cards.md");
    expect(result).toBe(false);
    expect(linkPopupError).toHaveBeenCalledWith(
      "Failed to emit open-file:",
      expect.any(Error),
    );
  });
});
