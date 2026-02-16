/**
 * Tests for shared media source resolution.
 *
 * Covers: external URLs pass-through, absolute path conversion,
 * relative path resolution, security validation, URL decoding,
 * and edge cases (missing doc/tab, angle brackets).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Tauri APIs (setup.ts provides defaults, but we need specific behavior here)
const mockConvertFileSrc = vi.fn((path: string) => `asset://localhost/${path}`);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => mockConvertFileSrc(path),
}));

const mockDirname = vi.fn((p: string) =>
  Promise.resolve(p.split("/").slice(0, -1).join("/") || "/"),
);
const mockJoin = vi.fn((...parts: string[]) =>
  Promise.resolve(parts.join("/")),
);
vi.mock("@tauri-apps/api/path", () => ({
  dirname: (...args: unknown[]) => mockDirname(...(args as [string])),
  join: (...args: unknown[]) => mockJoin(...(args as string[])),
}));

// Must import AFTER mocks
import {
  resolveMediaSrc,
  normalizePathForAsset,
  getActiveTabIdForCurrentWindow,
} from "./resolveMediaSrc";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";

// Mock getWindowLabel
vi.mock("@/hooks/useWindowFocus", () => ({
  getWindowLabel: vi.fn(() => "main"),
}));

describe("normalizePathForAsset", () => {
  it("converts backslashes to forward slashes", () => {
    expect(normalizePathForAsset("C:\\Users\\test\\image.png")).toBe(
      "C:/Users/test/image.png",
    );
  });

  it("leaves forward slashes unchanged", () => {
    expect(normalizePathForAsset("/Users/test/image.png")).toBe(
      "/Users/test/image.png",
    );
  });

  it("handles mixed slashes", () => {
    expect(normalizePathForAsset("C:\\Users/test\\file.mp3")).toBe(
      "C:/Users/test/file.mp3",
    );
  });

  it("handles empty string", () => {
    expect(normalizePathForAsset("")).toBe("");
  });
});

describe("getActiveTabIdForCurrentWindow", () => {
  beforeEach(() => {
    useTabStore.setState({ activeTabId: {} });
  });

  it("returns tab ID when available", () => {
    useTabStore.setState({ activeTabId: { main: "tab-1" } });
    expect(getActiveTabIdForCurrentWindow()).toBe("tab-1");
  });

  it("returns null when no active tab", () => {
    expect(getActiveTabIdForCurrentWindow()).toBeNull();
  });
});

describe("resolveMediaSrc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTabStore.setState({ activeTabId: { main: "tab-1" } });
  });

  function setupDocWithPath(filePath: string | null) {
    useDocumentStore.getState().initDocument("tab-1", "", filePath);
  }

  describe("external URLs pass through", () => {
    it.each([
      "https://example.com/image.png",
      "http://example.com/video.mp4",
      "data:image/png;base64,abc",
      "asset://localhost/file.png",
      "tauri://localhost/file.mp3",
    ])("passes through %s unchanged", async (url) => {
      expect(await resolveMediaSrc(url)).toBe(url);
    });
  });

  describe("absolute paths", () => {
    it("converts Unix absolute path via convertFileSrc", async () => {
      const result = await resolveMediaSrc("/Users/test/photo.png");
      expect(mockConvertFileSrc).toHaveBeenCalledWith("/Users/test/photo.png");
      expect(result).toBe("asset://localhost//Users/test/photo.png");
    });

    it("converts Windows absolute path via convertFileSrc", async () => {
      const result = await resolveMediaSrc("C:\\Users\\test\\photo.png");
      expect(mockConvertFileSrc).toHaveBeenCalledWith(
        "C:/Users/test/photo.png",
      );
      expect(result).toBe("asset://localhost/C:/Users/test/photo.png");
    });
  });

  describe("relative paths", () => {
    beforeEach(() => {
      setupDocWithPath("/Users/test/docs/readme.md");
    });

    it("resolves ./image.png relative to doc directory", async () => {
      const result = await resolveMediaSrc("./image.png");
      expect(mockDirname).toHaveBeenCalledWith("/Users/test/docs/readme.md");
      expect(mockJoin).toHaveBeenCalledWith("/Users/test/docs", "image.png");
      expect(result).toBe(
        "asset://localhost//Users/test/docs/image.png",
      );
    });

    it("resolves assets/bar.mp3 relative to doc directory", async () => {
      const result = await resolveMediaSrc("assets/bar.mp3");
      expect(mockJoin).toHaveBeenCalledWith(
        "/Users/test/docs",
        "assets/bar.mp3",
      );
      expect(result).toBe(
        "asset://localhost//Users/test/docs/assets/bar.mp3",
      );
    });
  });

  describe("security", () => {
    beforeEach(() => {
      setupDocWithPath("/Users/test/docs/readme.md");
    });

    it("rejects ../ traversal — blocked by early traversal check", async () => {
      // "../../../etc/passwd" is rejected early because it contains ".."
      const result = await resolveMediaSrc("../../../etc/passwd");
      expect(result).toBe("");
    });

    it("rejects ./../../secret — validateImagePath catches ..", async () => {
      const result = await resolveMediaSrc("./../../secret");
      expect(result).toBe("");
    });
  });

  describe("URL decoding", () => {
    beforeEach(() => {
      setupDocWithPath("/Users/test/docs/readme.md");
    });

    it("strips angle brackets from <path>", async () => {
      const result = await resolveMediaSrc("</Users/test/photo.png>");
      expect(mockConvertFileSrc).toHaveBeenCalledWith("/Users/test/photo.png");
      expect(result).toBe("asset://localhost//Users/test/photo.png");
    });

    it("decodes %20 in paths", async () => {
      await resolveMediaSrc("/Users/test/my%20photos/pic.png");
      expect(mockConvertFileSrc).toHaveBeenCalledWith(
        "/Users/test/my photos/pic.png",
      );
    });
  });

  describe("edge cases", () => {
    it("returns original src when no active tab", async () => {
      useTabStore.setState({ activeTabId: {} });
      const result = await resolveMediaSrc("./local.png");
      expect(result).toBe("./local.png");
    });

    it("returns original src when doc has no filePath", async () => {
      setupDocWithPath(null);
      const result = await resolveMediaSrc("./local.png");
      expect(result).toBe("./local.png");
    });
  });
});
