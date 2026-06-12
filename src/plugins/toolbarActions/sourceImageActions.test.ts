import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

vi.mock("@/plugins/sourcePopup/sourcePopupUtils", () => ({
  getAnchorRectFromRange: vi.fn(() => ({ top: 0, bottom: 20, left: 0, right: 100 })),
}));

vi.mock("@/services/media/clipboardImagePath", () => ({
  readClipboardImagePath: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@/hooks/useImageOperations", () => ({
  copyImageToAssets: vi.fn(() => Promise.resolve("assets/image.png")),
}));

vi.mock("@/utils/markdownUrl", () => ({
  encodeMarkdownUrl: vi.fn((url: string) => url.replace(/ /g, "%20")),
}));

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: () => ({
      getDocument: () => ({ filePath: "/path/to/doc.md" }),
    }),
  },
}));

const mockOpenPopup = vi.fn();
vi.mock("@/stores/mediaPopupStore", () => ({
  useMediaPopupStore: {
    getState: vi.fn(() => ({
      openPopup: mockOpenPopup,
    })),
  },
}));

vi.mock("@/utils/mediaPathDetection", () => ({
  hasVideoExtension: vi.fn(() => false),
  hasAudioExtension: vi.fn(() => false),
}));

vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: () => ({
      activeTabId: { main: "tab1" },
    }),
  },
}));

vi.mock("@/utils/debug", () => ({
  sourceActionError: vi.fn(),
}));

vi.mock("@/hooks/useWindowFocus", () => ({
  getWindowLabel: vi.fn(() => "main"),
}));

vi.mock("@/utils/markdownLinkPatterns", () => ({
  findMarkdownLinkAtPosition: vi.fn(() => null),
  findWikiLinkAtPosition: vi.fn(() => null),
}));

vi.mock("./sourceAdapterHelpers", () => ({
  insertText: vi.fn((view: EditorView, text: string, cursorOffset?: number) => {
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: {
        anchor: typeof cursorOffset === "number" ? from + cursorOffset : from + text.length,
      },
    });
  }),
}));

vi.mock("./sourceAdapterLinks", () => ({
  findWordAtCursorSource: vi.fn(() => null),
}));

import { sourceActionError } from "@/utils/debug";
import { unlinkAtCursor, insertImage, insertVideoTag, insertAudioTag } from "./sourceImageActions";
import { insertText } from "./sourceAdapterHelpers";
import { findMarkdownLinkAtPosition, findWikiLinkAtPosition } from "@/utils/markdownLinkPatterns";
import { readClipboardImagePath } from "@/services/media/clipboardImagePath";
import { copyImageToAssets } from "@/hooks/useImageOperations";
import { getAnchorRectFromRange } from "@/plugins/sourcePopup/sourcePopupUtils";
import { findWordAtCursorSource } from "./sourceAdapterLinks";
import { hasVideoExtension, hasAudioExtension } from "@/utils/mediaPathDetection";
import { getWindowLabel } from "@/hooks/useWindowFocus";

function createView(doc: string, ranges: Array<{ from: number; to: number }>): EditorView {
  const parent = document.createElement("div");
  const selection = EditorSelection.create(
    ranges.map((r) => EditorSelection.range(r.from, r.to))
  );
  const state = EditorState.create({ doc, selection });
  return new EditorView({ state, parent });
}

describe("unlinkAtCursor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes regular markdown link preserving text", () => {
    const view = createView("[hello](https://example.com)", [{ from: 3, to: 3 }]);
    vi.mocked(findMarkdownLinkAtPosition).mockReturnValue({
      from: 0,
      to: 28,
      text: "hello",
      href: "https://example.com",
    });

    const result = unlinkAtCursor(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("hello");
    view.destroy();
  });

  it("removes wiki link preserving target", () => {
    const view = createView("[[my-page]]", [{ from: 5, to: 5 }]);
    vi.mocked(findMarkdownLinkAtPosition).mockReturnValue(null);
    vi.mocked(findWikiLinkAtPosition).mockReturnValue({
      from: 0,
      to: 11,
      target: "my-page",
    });

    const result = unlinkAtCursor(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("my-page");
    view.destroy();
  });

  it("removes wiki link preserving alias over target", () => {
    const view = createView("[[page|display text]]", [{ from: 10, to: 10 }]);
    vi.mocked(findMarkdownLinkAtPosition).mockReturnValue(null);
    vi.mocked(findWikiLinkAtPosition).mockReturnValue({
      from: 0,
      to: 21,
      target: "page",
      alias: "display text",
    });

    const result = unlinkAtCursor(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("display text");
    view.destroy();
  });

  it("returns false when cursor is not in a link", () => {
    const view = createView("plain text", [{ from: 5, to: 5 }]);
    vi.mocked(findMarkdownLinkAtPosition).mockReturnValue(null);
    vi.mocked(findWikiLinkAtPosition).mockReturnValue(null);

    const result = unlinkAtCursor(view);
    expect(result).toBe(false);
    expect(view.state.doc.toString()).toBe("plain text");
    view.destroy();
  });

  it("handles link with empty text", () => {
    const view = createView("[](https://example.com)", [{ from: 1, to: 1 }]);
    vi.mocked(findMarkdownLinkAtPosition).mockReturnValue({
      from: 0,
      to: 23,
      text: "",
      href: "https://example.com",
    });

    const result = unlinkAtCursor(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("");
    view.destroy();
  });

  it("wiki link without alias uses target", () => {
    const view = createView("[[target]]", [{ from: 4, to: 4 }]);
    vi.mocked(findMarkdownLinkAtPosition).mockReturnValue(null);
    vi.mocked(findWikiLinkAtPosition).mockReturnValue({
      from: 0,
      to: 10,
      target: "target",
    });

    const result = unlinkAtCursor(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("target");
    view.destroy();
  });
});

describe("insertImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true immediately (async fire-and-forget)", () => {
    const view = createView("hello", [{ from: 0, to: 0 }]);
    const result = insertImage(view);
    expect(result).toBe(true);
    view.destroy();
  });
});

describe("insertVideoTag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts video HTML tag with cursor in src", () => {
    const view = createView("", [{ from: 0, to: 0 }]);
    insertVideoTag(view);
    expect(insertText).toHaveBeenCalledWith(
      view,
      '<video src="" controls></video>',
      12
    );
    view.destroy();
  });
});

describe("insertAudioTag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts audio HTML tag with cursor in src", () => {
    const view = createView("", [{ from: 0, to: 0 }]);
    insertAudioTag(view);
    expect(insertText).toHaveBeenCalledWith(
      view,
      '<audio src="" controls></audio>',
      12
    );
    view.destroy();
  });
});

describe("insertImage (async paths)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-establish default mock implementations after clearAllMocks
    vi.mocked(readClipboardImagePath).mockResolvedValue(null);
    vi.mocked(getAnchorRectFromRange).mockReturnValue({ top: 0, bottom: 20, left: 0, right: 100 });
    vi.mocked(findWordAtCursorSource).mockReturnValue(null);
    vi.mocked(findMarkdownLinkAtPosition).mockReturnValue(null);
    vi.mocked(findWikiLinkAtPosition).mockReturnValue(null);
    vi.mocked(hasVideoExtension).mockReturnValue(false);
    vi.mocked(hasAudioExtension).mockReturnValue(false);
  });

  it("shows popup for existing image at cursor", async () => {
    const doc = "![alt](image.png)";
    const view = createView(doc, [{ from: 5, to: 5 }]);

    insertImage(view);

    await vi.waitFor(() => {
      expect(mockOpenPopup).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaSrc: "image.png",
          mediaAlt: "alt",
          mediaNodeType: "image",
        })
      );
    });
    view.destroy();
  });

  it("detects video extension for existing image popup", async () => {
    const doc = "![video](clip.mp4)";
    const view = createView(doc, [{ from: 5, to: 5 }]);
    vi.mocked(hasVideoExtension).mockReturnValue(true);

    insertImage(view);

    await vi.waitFor(() => {
      expect(mockOpenPopup).toHaveBeenCalledWith(
        expect.objectContaining({ mediaNodeType: "block_video" })
      );
    });
    view.destroy();
  });

  it("detects audio extension for existing image popup", async () => {
    const doc = "![audio](song.mp3)";
    const view = createView(doc, [{ from: 5, to: 5 }]);
    vi.mocked(hasAudioExtension).mockReturnValue(true);

    insertImage(view);

    await vi.waitFor(() => {
      expect(mockOpenPopup).toHaveBeenCalledWith(
        expect.objectContaining({ mediaNodeType: "block_audio" })
      );
    });
    view.destroy();
  });

  it("returns early when cursor is inside a link", async () => {
    const doc = "[text](https://example.com)";
    const view = createView(doc, [{ from: 3, to: 3 }]);
    vi.mocked(findMarkdownLinkAtPosition).mockReturnValue({
      from: 0,
      to: 26,
      text: "text",
      href: "https://example.com",
    });

    insertImage(view);

    await new Promise((r) => setTimeout(r, 10));
    expect(readClipboardImagePath).not.toHaveBeenCalled();
    view.destroy();
  });

  it("inserts template when no clipboard image and no selection", async () => {
    const view = createView("", [{ from: 0, to: 0 }]);

    insertImage(view);

    await vi.waitFor(() => {
      expect(view.state.doc.toString()).toBe("![](url)");
    });
    view.destroy();
  });

  it("uses selection text as alt text in template", async () => {
    const view = createView("hello world", [{ from: 0, to: 5 }]);

    insertImage(view);

    await vi.waitFor(() => {
      expect(view.state.doc.toString()).toContain("![hello]");
    });
    view.destroy();
  });

  it("uses word at cursor as alt text when no selection", async () => {
    const view = createView("hello world", [{ from: 2, to: 2 }]);
    vi.mocked(findWordAtCursorSource).mockReturnValue({ from: 0, to: 5 });

    insertImage(view);

    await vi.waitFor(() => {
      expect(view.state.doc.toString()).toContain("![hello]");
    });
    view.destroy();
  });

  it("inserts clipboard image URL directly", async () => {
    const view = createView("", [{ from: 0, to: 0 }]);
    vi.mocked(readClipboardImagePath).mockResolvedValue({
      isImage: true,
      validated: true,
      path: "https://example.com/image.png",
      needsCopy: false,
    } as never);

    insertImage(view);

    await vi.waitFor(() => {
      expect(view.state.doc.toString()).toBe("![](https://example.com/image.png)");
    });
    view.destroy();
  });

  it("copies local image to assets when needsCopy is true", async () => {
    const view = createView("", [{ from: 0, to: 0 }]);
    vi.mocked(readClipboardImagePath).mockResolvedValue({
      isImage: true,
      validated: true,
      path: "/absolute/path/to/image.png",
      needsCopy: true,
      resolvedPath: "/absolute/path/to/image.png",
    } as never);
    vi.mocked(copyImageToAssets).mockResolvedValue("assets/image.png");

    insertImage(view);

    await vi.waitFor(() => {
      expect(copyImageToAssets).toHaveBeenCalled();
      expect(view.state.doc.toString()).toBe("![](assets/image.png)");
    });
    view.destroy();
  });

  it("falls back to template when copy fails", async () => {
    const view = createView("", [{ from: 0, to: 0 }]);
    vi.mocked(readClipboardImagePath).mockResolvedValue({
      isImage: true,
      validated: true,
      path: "/path/image.png",
      needsCopy: true,
      resolvedPath: "/path/image.png",
    } as never);
    vi.mocked(copyImageToAssets).mockRejectedValue(new Error("copy failed"));

    insertImage(view);

    await vi.waitFor(() => {
      expect(view.state.doc.toString()).toBe("![](url)");
    });
    view.destroy();
  });

  it("does not show popup when getAnchorRectFromRange returns null", async () => {
    const doc = "![alt](image.png)";
    const view = createView(doc, [{ from: 5, to: 5 }]);
    vi.mocked(getAnchorRectFromRange).mockReturnValue(null);

    insertImage(view);

    await vi.waitFor(() => {
      expect(readClipboardImagePath).toHaveBeenCalled();
    });
    view.destroy();
  });

  it("handles image with angle bracket path syntax", async () => {
    const doc = "![alt](<path with spaces.png>)";
    const view = createView(doc, [{ from: 5, to: 5 }]);

    insertImage(view);

    await vi.waitFor(() => {
      expect(mockOpenPopup).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaSrc: "path with spaces.png",
        })
      );
    });
    view.destroy();
  });

  it("handles clipboard image with selection as alt text", async () => {
    const view = createView("hello world", [{ from: 0, to: 5 }]);
    vi.mocked(readClipboardImagePath).mockResolvedValue({
      isImage: true,
      validated: true,
      path: "https://example.com/img.png",
      needsCopy: false,
    } as never);

    insertImage(view);

    await vi.waitFor(() => {
      expect(view.state.doc.toString()).toContain("![hello](https://example.com/img.png)");
    });
    view.destroy();
  });

  it("falls back to template when needsCopy=true but getActiveFilePath returns null (line 247)", async () => {
    // getWindowLabel returns a label with no active tab → tabId is null → getActiveFilePath returns null
    vi.mocked(getWindowLabel).mockReturnValue("window-with-no-tab");

    const view = createView("", [{ from: 0, to: 0 }]);
    vi.mocked(readClipboardImagePath).mockResolvedValue({
      isImage: true,
      validated: true,
      path: "/local/image.png",
      needsCopy: true,
      resolvedPath: "/local/image.png",
    } as never);

    insertImage(view);

    await vi.waitFor(() => {
      // Template inserted since getActiveFilePath returned null
      expect(view.state.doc.toString()).toBe("![](url)");
    });
    view.destroy();

    // Restore
    vi.mocked(getWindowLabel).mockReturnValue("main");
  });

  it("logs error when insertImageAsync throws (line 310)", async () => {
    

    const view = createView("", [{ from: 0, to: 0 }]);
    // Make readClipboardImagePath reject (throw) → insertImageAsync rejects → catch at line 309
    vi.mocked(readClipboardImagePath).mockRejectedValue(new Error("clipboard error"));

    insertImage(view);

    await vi.waitFor(() => {
      expect(sourceActionError).toHaveBeenCalledWith(
        "insertImage failed:",
        expect.any(Error)
      );
    });
    view.destroy();
      });
});

describe("getActiveFilePath — error path (line 42)", () => {
  it("returns null when getWindowLabel throws", async () => {
    // getWindowLabel throws → catch block returns null → getActiveFilePath returns null
    vi.mocked(getWindowLabel).mockImplementation(() => {
      throw new Error("focus error");
    });

    const view = createView("", [{ from: 0, to: 0 }]);
    vi.mocked(readClipboardImagePath).mockResolvedValue({
      isImage: true,
      validated: true,
      path: "/local/image.png",
      needsCopy: true,
      resolvedPath: "/local/image.png",
    } as never);

    insertImage(view);

    // getActiveFilePath returns null → falls back to template
    await vi.waitFor(() => {
      expect(view.state.doc.toString()).toBe("![](url)");
    });
    view.destroy();

    // Restore
    vi.mocked(getWindowLabel).mockReturnValue("main");
  });
});
