/**
 * Tests for sourceImageActions — source mode image popup actions
 *
 * Covers: buildImageMarkdown, parseImageMarkdown, findImageAtPos,
 * saveImageChanges, browseImage, copyImagePath, removeImage.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mocks ---
const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  message: vi.fn(),
  writeText: vi.fn(),
  copyImageToAssets: vi.fn(),
  withReentryGuard: vi.fn(
    async (_wl: string, _op: string, fn: () => Promise<unknown>) => fn()
  ),
  getWindowLabel: vi.fn(() => "main"),
  runOrQueueCodeMirrorAction: vi.fn((_view: unknown, fn: () => void) => fn()),
  dirname: vi.fn((p: string) => Promise.resolve(p.replace(/\/[^/]+$/, ""))),
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join("/"))),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: mocks.open,
  message: mocks.message,
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: mocks.writeText,
}));

vi.mock("@tauri-apps/api/path", () => ({
  dirname: mocks.dirname,
  join: mocks.join,
}));

vi.mock("@/hooks/useImageOperations", () => ({
  copyImageToAssets: mocks.copyImageToAssets,
}));

vi.mock("@/utils/reentryGuard", () => ({
  withReentryGuard: mocks.withReentryGuard,
}));

vi.mock("@/hooks/useWindowFocus", () => ({
  getWindowLabel: mocks.getWindowLabel,
}));

vi.mock("@/utils/imeGuard", () => ({
  runOrQueueCodeMirrorAction: mocks.runOrQueueCodeMirrorAction,
}));

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: vi.fn(() => ({
      getDocument: vi.fn(() => ({
        filePath: "/docs/test.md",
        content: "# Hello",
      })),
    })),
  },
}));

vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: vi.fn(() => ({
      activeTabId: { main: "tab-1" },
    })),
  },
}));

const mockSetSrc = vi.fn();
vi.mock("@/stores/mediaPopupStore", () => ({
  useMediaPopupStore: {
    getState: vi.fn(() => ({
      mediaNodePos: 0,
      mediaSrc: "image.png",
      mediaAlt: "alt text",
      setSrc: mockSetSrc,
    })),
  },
}));

import {
  saveImageChanges,
  browseImage,
  copyImagePath,
  removeImage,
} from "./sourceImageActions";
import { useMediaPopupStore } from "@/stores/mediaPopupStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";

// --- Mock EditorView ---
function createMockView(text: string) {
  const doc = {
    lineAt: vi.fn((_pos: number) => ({
      from: 0,
      to: text.length,
      text,
    })),
    sliceString: vi.fn((from: number, to: number) => text.slice(from, to)),
  };
  const state = { doc };
  return {
    state,
    dispatch: vi.fn(),
  };
}

describe("saveImageChanges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("replaces image markdown when range is found", () => {
    const imgText = "![alt text](image.png)";
    const view = createMockView(imgText);
    vi.mocked(useMediaPopupStore.getState).mockReturnValue({
      mediaNodePos: 5,
      mediaSrc: "new-image.png",
      mediaAlt: "new alt",
      setSrc: mockSetSrc,
    } as never);

    saveImageChanges(view as never);

    expect(mocks.runOrQueueCodeMirrorAction).toHaveBeenCalled();
    expect(view.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: expect.objectContaining({
          insert: expect.stringContaining("![new alt](new-image.png)"),
        }),
      })
    );
  });

  it("does nothing when mediaNodePos is negative", () => {
    const view = createMockView("some text");
    vi.mocked(useMediaPopupStore.getState).mockReturnValue({
      mediaNodePos: -1,
      mediaSrc: "img.png",
      mediaAlt: "alt",
      setSrc: mockSetSrc,
    } as never);

    saveImageChanges(view as never);

    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("does nothing when no image found at position", () => {
    const view = createMockView("no image here");
    vi.mocked(useMediaPopupStore.getState).mockReturnValue({
      mediaNodePos: 5,
      mediaSrc: "img.png",
      mediaAlt: "alt",
      setSrc: mockSetSrc,
    } as never);

    saveImageChanges(view as never);

    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("preserves title in image markdown", () => {
    const imgText = '![alt](image.png "My Title")';
    const view = createMockView(imgText);
    vi.mocked(useMediaPopupStore.getState).mockReturnValue({
      mediaNodePos: 5,
      mediaSrc: "new.png",
      mediaAlt: "new alt",
      setSrc: mockSetSrc,
    } as never);

    saveImageChanges(view as never);

    expect(view.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: expect.objectContaining({
          insert: expect.stringContaining('"My Title"'),
        }),
      })
    );
  });

  it("preserves angle brackets for src with spaces", () => {
    const imgText = "![alt](<my image.png>)";
    const view = createMockView(imgText);
    vi.mocked(useMediaPopupStore.getState).mockReturnValue({
      mediaNodePos: 5,
      mediaSrc: "new image.png",
      mediaAlt: "new alt",
      setSrc: mockSetSrc,
    } as never);

    saveImageChanges(view as never);

    expect(view.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: expect.objectContaining({
          insert: expect.stringContaining("<new image.png>"),
        }),
      })
    );
  });
});

describe("browseImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useMediaPopupStore.getState).mockReturnValue({
      mediaNodePos: 5,
      mediaSrc: "old.png",
      mediaAlt: "alt",
      setSrc: mockSetSrc,
    } as never);
  });

  it("returns false when user cancels file picker", async () => {
    mocks.open.mockResolvedValue(null);
    const imgText = "![alt](old.png)";
    const view = createMockView(imgText);

    const result = await browseImage(view as never);

    expect(result).toBe(false);
  });

  it("shows warning when document has no filePath", async () => {
    mocks.open.mockResolvedValue("/picked/image.png");
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(() => ({ filePath: null, content: "" })),
    } as never);
    vi.mocked(useTabStore.getState).mockReturnValue({
      activeTabId: { main: "tab-1" },
    } as never);
    const view = createMockView("![alt](old.png)");

    const result = await browseImage(view as never);

    expect(result).toBe(false);
    expect(mocks.message).toHaveBeenCalledWith(
      expect.stringContaining("save the document first"),
      expect.objectContaining({ kind: "warning" })
    );
  });

  it("copies image to assets and saves on success", async () => {
    mocks.open.mockResolvedValue("/picked/image.png");
    mocks.copyImageToAssets.mockResolvedValue("assets/image.png");
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(() => ({ filePath: "/docs/test.md", content: "" })),
    } as never);
    vi.mocked(useTabStore.getState).mockReturnValue({
      activeTabId: { main: "tab-1" },
    } as never);
    const imgText = "![alt](old.png)";
    const view = createMockView(imgText);

    const result = await browseImage(view as never);

    expect(result).toBe(true);
    expect(mocks.copyImageToAssets).toHaveBeenCalledWith("/picked/image.png", "/docs/test.md");
    expect(mockSetSrc).toHaveBeenCalledWith("assets/image.png");
  });

  it("shows error toast when browse operation throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.open.mockRejectedValue(new Error("dialog error"));
    const view = createMockView("![alt](old.png)");

    const result = await browseImage(view as never);

    expect(result).toBe(false);
    expect(mocks.message).toHaveBeenCalledWith(
      "Failed to change image.",
      expect.objectContaining({ kind: "error" })
    );
    errorSpy.mockRestore();
  });

  it("returns false when reentry guard blocks", async () => {
    mocks.withReentryGuard.mockResolvedValue(undefined);
    const view = createMockView("![alt](old.png)");

    const result = await browseImage(view as never);

    expect(result).toBe(false);
  });

  it("returns false when no active tab", async () => {
    mocks.open.mockResolvedValue("/picked/image.png");
    vi.mocked(useTabStore.getState).mockReturnValue({
      activeTabId: { main: null },
    } as never);
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(() => undefined),
    } as never);
    const view = createMockView("![alt](old.png)");

    const result = await browseImage(view as never);

    expect(result).toBe(false);
  });
});

describe("copyImagePath", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default store mocks
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(() => ({
        filePath: "/docs/test.md",
        content: "# Hello",
      })),
    } as never);
    vi.mocked(useTabStore.getState).mockReturnValue({
      activeTabId: { main: "tab-1" },
    } as never);
    mocks.getWindowLabel.mockReturnValue("main");
  });

  it("resolves relative path to absolute before copying", async () => {
    mocks.writeText.mockResolvedValue(undefined);
    mocks.dirname.mockResolvedValue("/docs");
    mocks.join.mockResolvedValue("/docs/my-image.png");
    vi.mocked(useMediaPopupStore.getState).mockReturnValue({
      mediaSrc: "my-image.png",
    } as never);

    await copyImagePath();

    expect(mocks.dirname).toHaveBeenCalledWith("/docs/test.md");
    expect(mocks.join).toHaveBeenCalledWith("/docs", "my-image.png");
    expect(mocks.writeText).toHaveBeenCalledWith("/docs/my-image.png");
  });

  it("strips ./ prefix from relative path", async () => {
    mocks.writeText.mockResolvedValue(undefined);
    mocks.dirname.mockResolvedValue("/docs");
    mocks.join.mockResolvedValue("/docs/assets/img.png");
    vi.mocked(useMediaPopupStore.getState).mockReturnValue({
      mediaSrc: "./assets/img.png",
    } as never);

    await copyImagePath();

    expect(mocks.join).toHaveBeenCalledWith("/docs", "assets/img.png");
    expect(mocks.writeText).toHaveBeenCalledWith("/docs/assets/img.png");
  });

  it("copies absolute path as-is without resolution", async () => {
    mocks.writeText.mockResolvedValue(undefined);
    vi.mocked(useMediaPopupStore.getState).mockReturnValue({
      mediaSrc: "/absolute/path/image.png",
    } as never);

    await copyImagePath();

    expect(mocks.dirname).not.toHaveBeenCalled();
    expect(mocks.writeText).toHaveBeenCalledWith("/absolute/path/image.png");
  });

  it("copies URL as-is without resolution", async () => {
    mocks.writeText.mockResolvedValue(undefined);
    vi.mocked(useMediaPopupStore.getState).mockReturnValue({
      mediaSrc: "https://example.com/image.png",
    } as never);

    await copyImagePath();

    expect(mocks.dirname).not.toHaveBeenCalled();
    expect(mocks.writeText).toHaveBeenCalledWith("https://example.com/image.png");
  });

  it("falls back to raw src when document has no filePath", async () => {
    mocks.writeText.mockResolvedValue(undefined);
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(() => ({ filePath: null, content: "" })),
    } as never);
    vi.mocked(useMediaPopupStore.getState).mockReturnValue({
      mediaSrc: "img.png",
    } as never);

    await copyImagePath();

    expect(mocks.writeText).toHaveBeenCalledWith("img.png");
  });

  it("falls back to raw src when path resolution fails", async () => {
    mocks.writeText.mockResolvedValue(undefined);
    mocks.dirname.mockRejectedValue(new Error("path error"));
    vi.mocked(useMediaPopupStore.getState).mockReturnValue({
      mediaSrc: "img.png",
    } as never);

    await copyImagePath();

    expect(mocks.writeText).toHaveBeenCalledWith("img.png");
  });

  it("does nothing when imageSrc is empty", async () => {
    vi.mocked(useMediaPopupStore.getState).mockReturnValue({
      mediaSrc: "",
    } as never);

    await copyImagePath();

    expect(mocks.writeText).not.toHaveBeenCalled();
  });

  it("handles clipboard write failure gracefully", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.writeText.mockRejectedValue(new Error("clipboard denied"));
    mocks.dirname.mockResolvedValue("/docs");
    mocks.join.mockResolvedValue("/docs/img.png");
    vi.mocked(useMediaPopupStore.getState).mockReturnValue({
      mediaSrc: "img.png",
    } as never);

    await copyImagePath();

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("removeImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes image markdown from document", () => {
    const imgText = "![alt](image.png)";
    const view = createMockView(imgText);
    vi.mocked(useMediaPopupStore.getState).mockReturnValue({
      mediaNodePos: 5,
    } as never);

    removeImage(view as never);

    expect(mocks.runOrQueueCodeMirrorAction).toHaveBeenCalled();
    expect(view.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: expect.objectContaining({
          insert: "",
        }),
      })
    );
  });

  it("does nothing when no image range found", () => {
    const view = createMockView("no image here");
    vi.mocked(useMediaPopupStore.getState).mockReturnValue({
      mediaNodePos: 5,
    } as never);

    removeImage(view as never);

    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("does nothing when mediaNodePos is negative", () => {
    const view = createMockView("![alt](img.png)");
    vi.mocked(useMediaPopupStore.getState).mockReturnValue({
      mediaNodePos: -1,
    } as never);

    removeImage(view as never);

    expect(view.dispatch).not.toHaveBeenCalled();
  });
});

// --- Additional coverage for uncovered branches ---

describe("parseImageMarkdown — false branch when no match (branch 3, line 40)", () => {
  it("returns null from saveImageChanges when image markdown is malformed", () => {
    // The image is found by findImageAtPos (regex match), but the sliceString result
    // is different enough that parseImageMarkdown returns null. We achieve this by
    // making sliceString return text that doesn't match the parseImageMarkdown regex.
    // findImageAtPos uses its own regex on lineText; we make lineText have an image
    // but sliceString (used in getImageMetaFromRange) returns garbage.
    const imgText = "![alt](image.png)";
    const view = {
      state: {
        doc: {
          lineAt: vi.fn((_pos: number) => ({
            from: 0,
            to: imgText.length,
            text: imgText,
          })),
          // sliceString returns non-matching text so parseImageMarkdown returns null
          sliceString: vi.fn(() => "not-an-image"),
        },
      },
      dispatch: vi.fn(),
    };
    vi.mocked(useMediaPopupStore.getState).mockReturnValue({
      mediaNodePos: 5,
      mediaSrc: "new.png",
      mediaAlt: "alt",
      setSrc: mockSetSrc,
    } as never);

    // getImageMetaFromRange calls parseImageMarkdown on "not-an-image" → returns null
    // → getImageMetaFromRange uses ?? fallbacks: title=null, useAngleBrackets=false
    // This covers branch 10 (line 89) as well
    saveImageChanges(view as never);

    // dispatch is still called because getImageRange found a range
    expect(view.dispatch).toHaveBeenCalled();
  });
});

describe("findImageAtPos — false branch when pos is outside all matches (branch 6, line 67)", () => {
  it("returns null for saveImageChanges when cursor pos is before any image on the line", () => {
    // Line contains an image, but pos=0 (start of line) and the image starts at col 5
    // so pos < matchStart → findImageAtPos returns null → saveImageChanges no-ops
    const imgText = "text ![alt](image.png)";
    const view = {
      state: {
        doc: {
          lineAt: vi.fn((_pos: number) => ({
            from: 0,
            to: imgText.length,
            text: imgText,
          })),
          sliceString: vi.fn((from: number, to: number) => imgText.slice(from, to)),
        },
      },
      dispatch: vi.fn(),
    };
    // mediaNodePos=0 → pos=0, matchStart=5 → 0 < 5, so pos < matchStart → no match
    vi.mocked(useMediaPopupStore.getState).mockReturnValue({
      mediaNodePos: 0,
      mediaSrc: "new.png",
      mediaAlt: "alt",
      setSrc: mockSetSrc,
    } as never);

    saveImageChanges(view as never);

    expect(view.dispatch).not.toHaveBeenCalled();
  });
});

describe("browseImage — tabId null fallback branches (branches 13, 14)", () => {
  it("shows warning when activeTabId has no entry for current window (tabId nullish → null)", async () => {
    // activeTabId[windowLabel] is undefined → ?? null → tabId = null
    // tabId is null → tabId ? ... : undefined → doc = undefined → filePath missing → warning
    mocks.open.mockResolvedValue("/picked/image.png");
    // Restore withReentryGuard so it calls the inner fn (clearAllMocks may have wiped the implementation)
    mocks.withReentryGuard.mockImplementation(
      async (_wl: string, _op: string, fn: () => Promise<unknown>) => fn()
    );
    vi.mocked(useTabStore.getState).mockReturnValue({
      activeTabId: {}, // no "main" key → activeTabId["main"] is undefined → ?? null
    } as never);
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      getDocument: vi.fn(), // never called when tabId is null
    } as never);
    const view = createMockView("![alt](old.png)");

    const result = await browseImage(view as never);

    // filePath is undefined → warning is shown
    expect(result).toBe(false);
    expect(mocks.message).toHaveBeenCalledWith(
      expect.stringContaining("save the document first"),
      expect.objectContaining({ kind: "warning" })
    );
  });
});
