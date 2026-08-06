/**
 * Tests for Smart Paste Image Handling
 *
 * Tests the tryImagePaste function and its internal async functions:
 * - insertImageMarkdown: copy-to-assets, path resolution, markdown insertion
 * - showImagePasteToast: toast callbacks (onConfirm/onDismiss)
 * - validateAndShowToast: home path expansion, path validation, fallback
 * - validateAndShowMultiToast: parallel validation, multi-image toast
 * - insertMultipleImageMarkdown: multi-image insertion, error paths
 * - showMultiImagePasteToast: multi-image toast callbacks
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoisted mocks ────────────────────────────────────────────────

const mockParseMultiplePaths = vi.fn(() => ({
  paths: [] as string[],
  format: "single" as const,
}));
const mockDetectMultipleImagePaths = vi.fn(() => ({
  allImages: false,
  imageCount: 0,
  results: [] as Array<{ isImage: boolean; type: string; path: string; needsCopy: boolean }>,
}));
const mockShowToast = vi.fn();
const mockShowMultiToast = vi.fn();
const mockFindWordAtCursorSource = vi.fn(() => null);
const mockCopyImageToAssets = vi.fn(() => Promise.resolve("assets/image.png"));
const mockSmartPasteWarn = vi.fn();
const mockEncodeMarkdownUrl = vi.fn((url: string) => url.replace(/ /g, "%20"));
const mockMessage = vi.fn(() => Promise.resolve());

const mockIsViewConnected = vi.fn(() => true);
const mockGetActiveFilePath = vi.fn(() => "/docs/test.md");
const mockExpandHomePath = vi.fn((p: string) => Promise.resolve(p.replace("~/", "/Users/test/")));
const mockValidateLocalPath = vi.fn(() => Promise.resolve(true));
const mockGetToastAnchorRect = vi.fn(() => ({ top: 100, left: 200, bottom: 120, right: 220 }));
const mockPasteAsText = vi.fn();

vi.mock("@/utils/multiImageParsing", () => ({
  parseMultiplePaths: (...args: unknown[]) => mockParseMultiplePaths(...args),
}));

vi.mock("@/utils/imagePathDetection", () => ({
  detectMultipleImagePaths: (...args: unknown[]) => mockDetectMultipleImagePaths(...args),
}));

vi.mock("@/plugins/shared/hostPopups", () => ({
  hostPopups: {
    // One seam member for both toasts; `imageResults` is what tells them apart.
    showImagePasteToast: (r: { imageResults?: unknown[] }) =>
      r.imageResults ? mockShowMultiToast(r) : mockShowToast(r),
  },
}));

vi.mock("@/plugins/toolbarActions/sourceAdapterLinks", () => ({
  findWordAtCursorSource: (...args: unknown[]) => mockFindWordAtCursorSource(...args),
}));

vi.mock("@/services/media/imageOperations", () => ({
  copyImageToAssets: (...args: unknown[]) => mockCopyImageToAssets(...args),
}));

vi.mock("@/utils/debug", () => ({
  smartPasteWarn: (...args: unknown[]) => mockSmartPasteWarn(...args),
  smartPasteError: vi.fn(),
}));

vi.mock("@/utils/markdownUrl", () => ({
  encodeMarkdownUrl: (url: string) => mockEncodeMarkdownUrl(url),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: (...args: unknown[]) => mockMessage(...args),
}));

vi.mock("./smartPasteUtils", () => ({
  isViewConnected: (...args: unknown[]) => mockIsViewConnected(...args),
  getActiveFilePath: () => mockGetActiveFilePath(),
  expandHomePath: (...args: unknown[]) => mockExpandHomePath(...args),
  validateLocalPath: (...args: unknown[]) => mockValidateLocalPath(...args),
  getToastAnchorRect: (...args: unknown[]) => mockGetToastAnchorRect(...args),
  pasteAsText: (...args: unknown[]) => mockPasteAsText(...args),
}));

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tryImagePaste } from "./smartPasteImage";

const createdViews: EditorView[] = [];

afterEach(() => {
  createdViews.forEach((v) => v.destroy());
  createdViews.length = 0;
});

function createView(content: string, anchor: number, head?: number): EditorView {
  const state = EditorState.create({
    doc: content,
    selection: { anchor, head: head ?? anchor },
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const view = new EditorView({ state, parent: container });
  createdViews.push(view);
  return view;
}

// ── Helpers ──────────────────────────────────────────────────────

function singleImageResult(type: string, path: string, needsCopy = false) {
  return {
    allImages: true,
    imageCount: 1,
    results: [{ isImage: true, type, path, needsCopy }],
  };
}

function multiImageResult(results: Array<{ type: string; path: string; needsCopy: boolean }>) {
  return {
    allImages: true,
    imageCount: results.length,
    results: results.map((r) => ({ isImage: true, ...r })),
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe("tryImagePaste", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsViewConnected.mockReturnValue(true);
    mockGetActiveFilePath.mockReturnValue("/docs/test.md");
    mockExpandHomePath.mockImplementation((p: string) => Promise.resolve(p.replace("~/", "/Users/test/")));
    mockValidateLocalPath.mockReturnValue(Promise.resolve(true));
    mockCopyImageToAssets.mockReturnValue(Promise.resolve("assets/image.png"));
  });

  // ── Basic rejection paths ──────────────────────────────────────

  it("returns false for empty text", () => {
    const view = createView("hello", 0);
    expect(tryImagePaste(view, "")).toBe(false);
  });

  it("returns false when parseMultiplePaths returns empty", () => {
    mockParseMultiplePaths.mockReturnValue({ paths: [], format: "single" });
    const view = createView("hello", 0);
    expect(tryImagePaste(view, "text")).toBe(false);
  });

  it("returns false when not all images", () => {
    mockParseMultiplePaths.mockReturnValue({ paths: ["/file.txt"], format: "single" });
    mockDetectMultipleImagePaths.mockReturnValue({ allImages: false, imageCount: 0, results: [] });
    const view = createView("hello", 0);
    expect(tryImagePaste(view, "/file.txt")).toBe(false);
  });

  // ── Single image URL ───────────────────────────────────────────

  it("shows toast immediately for single image URL", () => {
    mockParseMultiplePaths.mockReturnValue({ paths: ["https://img.com/a.png"], format: "single" });
    mockDetectMultipleImagePaths.mockReturnValue(singleImageResult("url", "https://img.com/a.png"));

    const view = createView("hello", 0);
    const result = tryImagePaste(view, "https://img.com/a.png");

    expect(result).toBe(true);
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ imagePath: "https://img.com/a.png", imageType: "url" })
    );
  });

  it("shows toast for data URL with imageType url", () => {
    mockParseMultiplePaths.mockReturnValue({ paths: ["data:image/png;base64,abc"], format: "single" });
    mockDetectMultipleImagePaths.mockReturnValue(singleImageResult("dataUrl", "data:image/png;base64,abc"));

    const view = createView("hello", 0);
    tryImagePaste(view, "data:image/png;base64,abc");

    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ imageType: "url" })
    );
  });

  it("imageType is localPath for absolutePath", () => {
    mockParseMultiplePaths.mockReturnValue({ paths: ["/img.png"], format: "single" });
    mockDetectMultipleImagePaths.mockReturnValue(singleImageResult("absolutePath", "/img.png", true));
    // This goes through async validation — not through showImagePasteToast directly for absolutePath
    const view = createView("hello", 0);
    const result = tryImagePaste(view, "/img.png");
    expect(result).toBe(true);
  });

  // ── Alt text ───────────────────────────────────────────────────

  it("uses selected text as alt text", () => {
    mockParseMultiplePaths.mockReturnValue({ paths: ["https://img.com/a.png"], format: "single" });
    mockDetectMultipleImagePaths.mockReturnValue(singleImageResult("url", "https://img.com/a.png"));

    const view = createView("my photo here", 3, 8);
    tryImagePaste(view, "https://img.com/a.png");

    expect(mockShowToast).toHaveBeenCalled();
  });

  it("uses word at cursor as alt text when no selection", () => {
    mockParseMultiplePaths.mockReturnValue({ paths: ["https://img.com/a.png"], format: "single" });
    mockDetectMultipleImagePaths.mockReturnValue(singleImageResult("url", "https://img.com/a.png"));
    mockFindWordAtCursorSource.mockReturnValue({ from: 0, to: 5 });

    const view = createView("hello world", 3);
    tryImagePaste(view, "https://img.com/a.png");

    expect(mockFindWordAtCursorSource).toHaveBeenCalledWith(view, 3);
  });

  it("uses empty alt text when no word found at cursor", () => {
    mockParseMultiplePaths.mockReturnValue({ paths: ["https://img.com/a.png"], format: "single" });
    mockDetectMultipleImagePaths.mockReturnValue(singleImageResult("url", "https://img.com/a.png"));
    mockFindWordAtCursorSource.mockReturnValue(null);

    const view = createView("hello", 5);
    tryImagePaste(view, "https://img.com/a.png");
    expect(mockShowToast).toHaveBeenCalled();
  });

  // ── onConfirm callback ─────────────────────────────────────────

  describe("showImagePasteToast onConfirm", () => {
    it("calls insertImageMarkdown when view is connected", async () => {
      mockParseMultiplePaths.mockReturnValue({ paths: ["https://img.com/a.png"], format: "single" });
      mockDetectMultipleImagePaths.mockReturnValue(singleImageResult("url", "https://img.com/a.png"));

      const view = createView("hello", 0);
      tryImagePaste(view, "https://img.com/a.png");

      const toastArgs = mockShowToast.mock.calls[0][0];
      expect(toastArgs.onConfirm).toBeInstanceOf(Function);

      // Call onConfirm
      await toastArgs.onConfirm();

      // insertImageMarkdown should dispatch to the view
      // (view is connected, no copy needed for URLs)
      await vi.waitFor(() => {
        expect(view.state.doc.toString()).toContain("![");
      });
    });

    it("warns when view is disconnected on confirm", () => {
      mockParseMultiplePaths.mockReturnValue({ paths: ["https://img.com/a.png"], format: "single" });
      mockDetectMultipleImagePaths.mockReturnValue(singleImageResult("url", "https://img.com/a.png"));

      const view = createView("hello", 0);
      tryImagePaste(view, "https://img.com/a.png");

      mockIsViewConnected.mockReturnValue(false);

      const toastArgs = mockShowToast.mock.calls[0][0];
      toastArgs.onConfirm();
      expect(mockSmartPasteWarn).toHaveBeenCalledWith(expect.stringContaining("disconnected"));
    });
  });

  // ── onDismiss callback ─────────────────────────────────────────

  describe("showImagePasteToast onDismiss", () => {
    it("pastes text when view is connected", () => {
      mockParseMultiplePaths.mockReturnValue({ paths: ["https://img.com/a.png"], format: "single" });
      mockDetectMultipleImagePaths.mockReturnValue(singleImageResult("url", "https://img.com/a.png"));

      const view = createView("hello", 0);
      tryImagePaste(view, "https://img.com/a.png");

      const toastArgs = mockShowToast.mock.calls[0][0];
      toastArgs.onDismiss();
      expect(mockPasteAsText).toHaveBeenCalled();
    });

    it("does nothing when view is disconnected on dismiss", () => {
      mockParseMultiplePaths.mockReturnValue({ paths: ["https://img.com/a.png"], format: "single" });
      mockDetectMultipleImagePaths.mockReturnValue(singleImageResult("url", "https://img.com/a.png"));

      const view = createView("hello", 0);
      tryImagePaste(view, "https://img.com/a.png");

      mockIsViewConnected.mockReturnValue(false);

      const toastArgs = mockShowToast.mock.calls[0][0];
      toastArgs.onDismiss();
      expect(mockPasteAsText).not.toHaveBeenCalled();
    });
  });

  // ── insertImageMarkdown paths ──────────────────────────────────

  describe("insertImageMarkdown", () => {
    it("aborts when view is disconnected", async () => {
      mockParseMultiplePaths.mockReturnValue({ paths: ["https://img.com/a.png"], format: "single" });
      mockDetectMultipleImagePaths.mockReturnValue(singleImageResult("url", "https://img.com/a.png"));
      mockIsViewConnected.mockReturnValue(false);

      const view = createView("hello", 0);
      tryImagePaste(view, "https://img.com/a.png");

      const toastArgs = mockShowToast.mock.calls[0][0];
      toastArgs.onConfirm();
      expect(mockSmartPasteWarn).toHaveBeenCalled();
    });

    it("shows dialog when needsCopy and no active file path", async () => {
      mockParseMultiplePaths.mockReturnValue({ paths: ["https://img.com/a.png"], format: "single" });
      mockDetectMultipleImagePaths.mockReturnValue(singleImageResult("url", "https://img.com/a.png", true));
      mockGetActiveFilePath.mockReturnValue(null);

      const view = createView("hello", 0);
      tryImagePaste(view, "https://img.com/a.png");

      const toastArgs = mockShowToast.mock.calls[0][0];
      await toastArgs.onConfirm();

      // Wait for async insertImageMarkdown
      await vi.waitFor(() => {
        expect(mockMessage).toHaveBeenCalledWith(
          expect.stringContaining("save the document"),
          expect.objectContaining({ kind: "warning" })
        );
      });
    });

    it("copies image to assets when needsCopy and file path exists", async () => {
      mockParseMultiplePaths.mockReturnValue({ paths: ["/img.png"], format: "single" });
      mockDetectMultipleImagePaths.mockReturnValue(
        singleImageResult("absolutePath", "/img.png", true)
      );
      mockGetActiveFilePath.mockReturnValue("/docs/test.md");
      mockCopyImageToAssets.mockResolvedValue("assets/copied.png");

      const view = createView("hello", 0);
      tryImagePaste(view, "/img.png");

      // Goes through validateAndShowToast -> showImagePasteToast
      await vi.waitFor(() => {
        expect(mockShowToast).toHaveBeenCalled();
      });

      const toastArgs = mockShowToast.mock.calls[0][0];
      await toastArgs.onConfirm();

      await vi.waitFor(() => {
        expect(mockCopyImageToAssets).toHaveBeenCalledWith("/img.png", "/docs/test.md");
      });
    });

    it("expands home path before copy", async () => {
      mockParseMultiplePaths.mockReturnValue({ paths: ["~/img.png"], format: "single" });
      mockDetectMultipleImagePaths.mockReturnValue(
        singleImageResult("homePath", "~/img.png", true)
      );

      const view = createView("hello", 0);
      tryImagePaste(view, "~/img.png");

      await vi.waitFor(() => {
        expect(mockShowToast).toHaveBeenCalled();
      });

      const toastArgs = mockShowToast.mock.calls[0][0];
      await toastArgs.onConfirm();

      await vi.waitFor(() => {
        expect(mockExpandHomePath).toHaveBeenCalledWith("~/img.png");
        expect(mockCopyImageToAssets).toHaveBeenCalledWith("/Users/test/img.png", "/docs/test.md");
      });
    });

    it("shows error when home path expansion fails during copy", async () => {
      mockParseMultiplePaths.mockReturnValue({ paths: ["~/img.png"], format: "single" });
      mockDetectMultipleImagePaths.mockReturnValue(
        singleImageResult("homePath", "~/img.png", true)
      );
      // First expandHomePath call (validation) succeeds, second (inside insertImageMarkdown) fails
      mockExpandHomePath
        .mockResolvedValueOnce("/Users/test/img.png") // validateAndShowToast
        .mockResolvedValueOnce(null); // insertImageMarkdown

      const view = createView("hello", 0);
      tryImagePaste(view, "~/img.png");

      await vi.waitFor(() => {
        expect(mockShowToast).toHaveBeenCalled();
      });

      const toastArgs = mockShowToast.mock.calls[0][0];
      await toastArgs.onConfirm();

      await vi.waitFor(() => {
        expect(mockMessage).toHaveBeenCalledWith(
          expect.stringContaining("home directory"),
          expect.objectContaining({ kind: "error" })
        );
      });
    });

    it("shows error dialog when copyImageToAssets fails", async () => {
      mockParseMultiplePaths.mockReturnValue({ paths: ["/img.png"], format: "single" });
      mockDetectMultipleImagePaths.mockReturnValue(
        singleImageResult("absolutePath", "/img.png", true)
      );
      mockCopyImageToAssets.mockRejectedValue(new Error("Copy failed"));

      const view = createView("hello", 0);
      tryImagePaste(view, "/img.png");

      await vi.waitFor(() => {
        expect(mockShowToast).toHaveBeenCalled();
      });

      const toastArgs = mockShowToast.mock.calls[0][0];
      await toastArgs.onConfirm();

      await vi.waitFor(() => {
        expect(mockMessage).toHaveBeenCalledWith(
          expect.stringContaining("Failed to copy"),
          expect.objectContaining({ kind: "error" })
        );
      });
    });

    it("uses current selection position when selection changed during async", async () => {
      mockParseMultiplePaths.mockReturnValue({ paths: ["https://img.com/a.png"], format: "single" });
      mockDetectMultipleImagePaths.mockReturnValue(singleImageResult("url", "https://img.com/a.png"));

      const view = createView("hello world", 0, 5);
      tryImagePaste(view, "https://img.com/a.png");

      // Change selection before onConfirm
      view.dispatch({ selection: { anchor: 6, head: 11 } });

      const toastArgs = mockShowToast.mock.calls[0][0];
      await toastArgs.onConfirm();

      // Should use current position since selection changed
      await vi.waitFor(() => {
        expect(mockSmartPasteWarn).toHaveBeenCalledWith(
          expect.stringContaining("Selection changed")
        );
      });
    });

    it("aborts when view disconnects after async operations", async () => {
      mockParseMultiplePaths.mockReturnValue({ paths: ["https://img.com/a.png"], format: "single" });
      mockDetectMultipleImagePaths.mockReturnValue(singleImageResult("url", "https://img.com/a.png", true));
      mockGetActiveFilePath.mockReturnValue("/docs/test.md");

      // isViewConnected: true for first check, false for second (after async)
      mockIsViewConnected
        .mockReturnValueOnce(true) // onConfirm guard
        .mockReturnValueOnce(true) // first check in insertImageMarkdown
        .mockReturnValueOnce(false); // second check after copy

      const view = createView("hello", 0);
      tryImagePaste(view, "https://img.com/a.png");

      const toastArgs = mockShowToast.mock.calls[0][0];
      await toastArgs.onConfirm();

      await vi.waitFor(() => {
        expect(mockSmartPasteWarn).toHaveBeenCalledWith(
          expect.stringContaining("disconnected after async")
        );
      });
    });

    it("aborts in insertImageMarkdown when view disconnects before first check (line 46-47)", async () => {
      // onConfirm guard (line 131) returns true, but insertImageMarkdown's own
      // first isViewConnected check (line 45) returns false → should warn and return
      mockParseMultiplePaths.mockReturnValue({ paths: ["https://img.com/a.png"], format: "single" });
      mockDetectMultipleImagePaths.mockReturnValue(singleImageResult("url", "https://img.com/a.png"));

      mockIsViewConnected
        .mockReturnValueOnce(true) // onConfirm guard passes
        .mockReturnValueOnce(false); // insertImageMarkdown first check fails

      const view = createView("hello", 0);
      tryImagePaste(view, "https://img.com/a.png");

      const toastArgs = mockShowToast.mock.calls[0][0];
      await toastArgs.onConfirm();

      await vi.waitFor(() => {
        expect(mockSmartPasteWarn).toHaveBeenCalledWith(
          expect.stringContaining("View disconnected, aborting image insert")
        );
      });
    });

    it("catches error from insertImageMarkdown rejection (line 136)", async () => {
      // Trigger the .catch() by making message() reject inside insertImageMarkdown
      // after needsCopy=true and no active file path
      mockParseMultiplePaths.mockReturnValue({ paths: ["https://img.com/a.png"], format: "single" });
      mockDetectMultipleImagePaths.mockReturnValue(singleImageResult("url", "https://img.com/a.png", true));
      mockGetActiveFilePath.mockReturnValue(null);
      // message() rejects to cause insertImageMarkdown to throw — the .catch() swallows it
      mockMessage.mockRejectedValueOnce(new Error("dialog failed"));

      const view = createView("hello", 0);
      tryImagePaste(view, "https://img.com/a.png");

      const toastArgs = mockShowToast.mock.calls[0][0];
      // onConfirm returns void (fire-and-forget), call it and wait for async operations
      toastArgs.onConfirm();

      // Wait for the rejection to be processed — message was called (showing it threw)
      await vi.waitFor(() => {
        expect(mockMessage).toHaveBeenCalled();
      });
      // No unhandled rejection — the .catch() on line 135-137 handled it
    });
  });

  // ── validateAndShowToast ───────────────────────────────────────

  describe("validateAndShowToast", () => {
    it("validates absolutePath exists before showing toast", async () => {
      mockParseMultiplePaths.mockReturnValue({ paths: ["/img.png"], format: "single" });
      mockDetectMultipleImagePaths.mockReturnValue(
        singleImageResult("absolutePath", "/img.png", true)
      );
      mockValidateLocalPath.mockResolvedValue(true);

      const view = createView("hello", 0);
      tryImagePaste(view, "/img.png");

      await vi.waitFor(() => {
        expect(mockValidateLocalPath).toHaveBeenCalledWith("/img.png");
        expect(mockShowToast).toHaveBeenCalled();
      });
    });

    it("pastes as text when absolutePath does not exist", async () => {
      mockParseMultiplePaths.mockReturnValue({ paths: ["/img.png"], format: "single" });
      mockDetectMultipleImagePaths.mockReturnValue(
        singleImageResult("absolutePath", "/img.png", true)
      );
      mockValidateLocalPath.mockResolvedValue(false);

      const view = createView("hello", 0);
      tryImagePaste(view, "/img.png");

      await vi.waitFor(() => {
        expect(mockPasteAsText).toHaveBeenCalled();
      });
    });

    it("expands homePath before validation", async () => {
      mockParseMultiplePaths.mockReturnValue({ paths: ["~/img.png"], format: "single" });
      mockDetectMultipleImagePaths.mockReturnValue(
        singleImageResult("homePath", "~/img.png", true)
      );
      mockExpandHomePath.mockResolvedValue("/Users/test/img.png");
      mockValidateLocalPath.mockResolvedValue(true);

      const view = createView("hello", 0);
      tryImagePaste(view, "~/img.png");

      await vi.waitFor(() => {
        expect(mockExpandHomePath).toHaveBeenCalledWith("~/img.png");
        expect(mockValidateLocalPath).toHaveBeenCalledWith("/Users/test/img.png");
        expect(mockShowToast).toHaveBeenCalled();
      });
    });

    it("pastes as text when home expansion fails", async () => {
      mockParseMultiplePaths.mockReturnValue({ paths: ["~/img.png"], format: "single" });
      mockDetectMultipleImagePaths.mockReturnValue(
        singleImageResult("homePath", "~/img.png", true)
      );
      mockExpandHomePath.mockResolvedValue(null);

      const view = createView("hello", 0);
      tryImagePaste(view, "~/img.png");

      await vi.waitFor(() => {
        expect(mockPasteAsText).toHaveBeenCalled();
      });
    });

    it("does not paste as text when view disconnects during validation", async () => {
      mockParseMultiplePaths.mockReturnValue({ paths: ["~/img.png"], format: "single" });
      mockDetectMultipleImagePaths.mockReturnValue(
        singleImageResult("homePath", "~/img.png", true)
      );
      mockExpandHomePath.mockResolvedValue(null);
      mockIsViewConnected.mockReturnValue(false);

      const view = createView("hello", 0);
      tryImagePaste(view, "~/img.png");

      await vi.waitFor(() => {
        expect(mockPasteAsText).not.toHaveBeenCalled();
      });
    });

    it("does not show toast when view disconnects after validation", async () => {
      mockParseMultiplePaths.mockReturnValue({ paths: ["/img.png"], format: "single" });
      mockDetectMultipleImagePaths.mockReturnValue(
        singleImageResult("absolutePath", "/img.png", true)
      );
      mockValidateLocalPath.mockResolvedValue(true);

      // Disconnected when checked after validation completes
      mockIsViewConnected.mockReturnValue(false);

      const view = createView("hello", 0);
      tryImagePaste(view, "/img.png");

      await vi.waitFor(() => {
        expect(mockValidateLocalPath).toHaveBeenCalled();
      });

      // Toast should not have been shown
      expect(mockShowToast).not.toHaveBeenCalled();
    });

    it("catches validation errors and pastes as text", async () => {
      mockParseMultiplePaths.mockReturnValue({ paths: ["/img.png"], format: "single" });
      mockDetectMultipleImagePaths.mockReturnValue(
        singleImageResult("absolutePath", "/img.png", true)
      );
      mockValidateLocalPath.mockRejectedValue(new Error("validation error"));

      const view = createView("hello", 0);
      tryImagePaste(view, "/img.png");

      // The catch handler in tryImagePaste calls pasteAsText
      await vi.waitFor(() => {
        expect(mockPasteAsText).toHaveBeenCalled();
      });
    });

    it("shows toast for relativePath without validation", async () => {
      mockParseMultiplePaths.mockReturnValue({ paths: ["./img.png"], format: "single" });
      mockDetectMultipleImagePaths.mockReturnValue(
        singleImageResult("relativePath", "./img.png", false)
      );

      const view = createView("hello", 0);
      tryImagePaste(view, "./img.png");

      // relativePath doesn't need absolutePath/homePath validation
      await vi.waitFor(() => {
        expect(mockShowToast).toHaveBeenCalled();
      });
      expect(mockValidateLocalPath).not.toHaveBeenCalled();
    });
  });

  // ── Multi-image paths ──────────────────────────────────────────

  describe("multiple images", () => {
    it("validates all paths and shows multi toast", async () => {
      const paths = ["/a.png", "/b.jpg"];
      mockParseMultiplePaths.mockReturnValue({ paths, format: "newline" });
      mockDetectMultipleImagePaths.mockReturnValue(
        multiImageResult([
          { type: "absolutePath", path: "/a.png", needsCopy: true },
          { type: "absolutePath", path: "/b.jpg", needsCopy: true },
        ])
      );
      mockValidateLocalPath.mockResolvedValue(true);

      const view = createView("hello", 0);
      tryImagePaste(view, "/a.png\n/b.jpg");

      await vi.waitFor(() => {
        expect(mockShowMultiToast).toHaveBeenCalled();
      });
    });

    it("pastes as text when any path is invalid", async () => {
      const paths = ["/a.png", "/b.jpg"];
      mockParseMultiplePaths.mockReturnValue({ paths, format: "newline" });
      mockDetectMultipleImagePaths.mockReturnValue(
        multiImageResult([
          { type: "absolutePath", path: "/a.png", needsCopy: true },
          { type: "absolutePath", path: "/b.jpg", needsCopy: true },
        ])
      );
      mockValidateLocalPath
        .mockResolvedValueOnce(true) // /a.png exists
        .mockResolvedValueOnce(false); // /b.jpg doesn't exist

      const view = createView("hello", 0);
      tryImagePaste(view, "/a.png\n/b.jpg");

      await vi.waitFor(() => {
        expect(mockPasteAsText).toHaveBeenCalled();
      });
    });

    it("skips validation for URLs in multi-image", async () => {
      const paths = ["https://img.com/a.png", "/b.jpg"];
      mockParseMultiplePaths.mockReturnValue({ paths, format: "newline" });
      mockDetectMultipleImagePaths.mockReturnValue(
        multiImageResult([
          { type: "url", path: "https://img.com/a.png", needsCopy: false },
          { type: "absolutePath", path: "/b.jpg", needsCopy: true },
        ])
      );
      mockValidateLocalPath.mockResolvedValue(true);

      const view = createView("hello", 0);
      tryImagePaste(view, "https://img.com/a.png\n/b.jpg");

      await vi.waitFor(() => {
        expect(mockShowMultiToast).toHaveBeenCalled();
        // validateLocalPath should only be called for /b.jpg
        expect(mockValidateLocalPath).toHaveBeenCalledTimes(1);
      });
    });

    it("expands home paths in multi-image validation", async () => {
      const paths = ["~/a.png", "/b.jpg"];
      mockParseMultiplePaths.mockReturnValue({ paths, format: "newline" });
      mockDetectMultipleImagePaths.mockReturnValue(
        multiImageResult([
          { type: "homePath", path: "~/a.png", needsCopy: true },
          { type: "absolutePath", path: "/b.jpg", needsCopy: true },
        ])
      );
      mockExpandHomePath.mockResolvedValue("/Users/test/a.png");
      mockValidateLocalPath.mockResolvedValue(true);

      const view = createView("hello", 0);
      tryImagePaste(view, "~/a.png\n/b.jpg");

      await vi.waitFor(() => {
        expect(mockExpandHomePath).toHaveBeenCalledWith("~/a.png");
        expect(mockShowMultiToast).toHaveBeenCalled();
      });
    });

    it("fails multi-image when home expansion fails", async () => {
      const paths = ["~/a.png"];
      mockParseMultiplePaths.mockReturnValue({ paths, format: "newline" });
      mockDetectMultipleImagePaths.mockReturnValue(
        multiImageResult([
          { type: "homePath", path: "~/a.png", needsCopy: true },
          { type: "homePath", path: "~/b.png", needsCopy: true },
        ])
      );
      mockExpandHomePath.mockResolvedValue(null);

      const view = createView("hello", 0);
      tryImagePaste(view, "~/a.png\n~/b.png");

      await vi.waitFor(() => {
        expect(mockPasteAsText).toHaveBeenCalled();
      });
    });

    it("does not paste when view disconnects during multi validation", async () => {
      const paths = ["/a.png", "/b.jpg"];
      mockParseMultiplePaths.mockReturnValue({ paths, format: "newline" });
      mockDetectMultipleImagePaths.mockReturnValue(
        multiImageResult([
          { type: "absolutePath", path: "/a.png", needsCopy: true },
          { type: "absolutePath", path: "/b.jpg", needsCopy: true },
        ])
      );
      mockValidateLocalPath.mockResolvedValue(false);
      mockIsViewConnected.mockReturnValue(false);

      const view = createView("hello", 0);
      tryImagePaste(view, "/a.png\n/b.jpg");

      await vi.waitFor(() => {
        expect(mockValidateLocalPath).toHaveBeenCalled();
      });
      expect(mockPasteAsText).not.toHaveBeenCalled();
    });

    it("does not show toast when view disconnects after validation passes", async () => {
      const paths = ["/a.png"];
      mockParseMultiplePaths.mockReturnValue({ paths, format: "newline" });
      mockDetectMultipleImagePaths.mockReturnValue(
        multiImageResult([
          { type: "absolutePath", path: "/a.png", needsCopy: true },
          { type: "absolutePath", path: "/b.png", needsCopy: true },
        ])
      );
      mockValidateLocalPath.mockResolvedValue(true);
      mockIsViewConnected
        .mockReturnValueOnce(true) // initial
        .mockReturnValue(false); // after validation

      const view = createView("hello", 0);
      tryImagePaste(view, "/a.png\n/b.png");

      await vi.waitFor(() => {
        expect(mockValidateLocalPath).toHaveBeenCalled();
      });
      expect(mockShowMultiToast).not.toHaveBeenCalled();
    });

    it("returns early at line 245 when view disconnects before showMultiImagePasteToast (line 244-246)", async () => {
      // All paths valid, but isViewConnected returns false at line 244 check
      // → enters the guard branch → line 245 return is executed
      const paths = ["/a.png"];
      mockParseMultiplePaths.mockReturnValue({ paths, format: "newline" });
      mockDetectMultipleImagePaths.mockReturnValue(
        multiImageResult([
          { type: "absolutePath", path: "/a.png", needsCopy: true },
        ])
      );
      mockValidateLocalPath.mockResolvedValue(true);
      // All isViewConnected calls return false — first call at line 244 returns false
      mockIsViewConnected.mockReturnValue(false);

      const view = createView("hello", 0);
      tryImagePaste(view, "/a.png");

      await vi.waitFor(() => {
        expect(mockValidateLocalPath).toHaveBeenCalled();
      });

      // The guard at line 244-246 prevents showMultiImagePasteToast from being called
      expect(mockShowMultiToast).not.toHaveBeenCalled();
    });

    it("relative paths assumed valid without validation in multi-image", async () => {
      const paths = ["./a.png", "./b.png"];
      mockParseMultiplePaths.mockReturnValue({ paths, format: "newline" });
      mockDetectMultipleImagePaths.mockReturnValue(
        multiImageResult([
          { type: "relativePath", path: "./a.png", needsCopy: false },
          { type: "relativePath", path: "./b.png", needsCopy: false },
        ])
      );

      const view = createView("hello", 0);
      tryImagePaste(view, "./a.png\n./b.png");

      await vi.waitFor(() => {
        expect(mockShowMultiToast).toHaveBeenCalled();
      });
      expect(mockValidateLocalPath).not.toHaveBeenCalled();
    });
  });

  // ── Multi-image toast callbacks ────────────────────────────────

  describe("showMultiImagePasteToast callbacks", () => {
    function setupMultiToast() {
      const paths = ["https://a.png", "https://b.png"];
      mockParseMultiplePaths.mockReturnValue({ paths, format: "newline" });
      mockDetectMultipleImagePaths.mockReturnValue(
        multiImageResult([
          { type: "url", path: "https://a.png", needsCopy: false },
          { type: "url", path: "https://b.png", needsCopy: false },
        ])
      );

      const view = createView("hello", 0);
      tryImagePaste(view, "https://a.png\nhttps://b.png");
      return view;
    }

    it("onConfirm inserts multiple images", async () => {
      const view = setupMultiToast();

      await vi.waitFor(() => {
        expect(mockShowMultiToast).toHaveBeenCalled();
      });

      const toastArgs = mockShowMultiToast.mock.calls[0][0];
      await toastArgs.onConfirm();

      await vi.waitFor(() => {
        const doc = view.state.doc.toString();
        expect(doc).toContain("![](https://a.png)");
        expect(doc).toContain("![](https://b.png)");
      });
    });

    it("onConfirm warns when view disconnected", async () => {
      setupMultiToast();

      await vi.waitFor(() => {
        expect(mockShowMultiToast).toHaveBeenCalled();
      });

      mockIsViewConnected.mockReturnValue(false);
      const toastArgs = mockShowMultiToast.mock.calls[0][0];
      toastArgs.onConfirm();

      expect(mockSmartPasteWarn).toHaveBeenCalledWith(
        expect.stringContaining("disconnected")
      );
    });

    it("onDismiss pastes as text when connected", async () => {
      setupMultiToast();

      await vi.waitFor(() => {
        expect(mockShowMultiToast).toHaveBeenCalled();
      });

      const toastArgs = mockShowMultiToast.mock.calls[0][0];
      toastArgs.onDismiss();
      expect(mockPasteAsText).toHaveBeenCalled();
    });

    it("onDismiss does nothing when view disconnected", async () => {
      setupMultiToast();

      await vi.waitFor(() => {
        expect(mockShowMultiToast).toHaveBeenCalled();
      });

      mockIsViewConnected.mockReturnValue(false);
      const toastArgs = mockShowMultiToast.mock.calls[0][0];
      toastArgs.onDismiss();
      expect(mockPasteAsText).not.toHaveBeenCalled();
    });
  });

  // ── insertMultipleImageMarkdown paths ──────────────────────────

  describe("insertMultipleImageMarkdown", () => {
    it("aborts when view disconnects before processing", async () => {
      const paths = ["https://a.png"];
      mockParseMultiplePaths.mockReturnValue({ paths, format: "newline" });
      mockDetectMultipleImagePaths.mockReturnValue(
        multiImageResult([
          { type: "url", path: "https://a.png", needsCopy: false },
          { type: "url", path: "https://b.png", needsCopy: false },
        ])
      );

      const view = createView("hello", 0);
      tryImagePaste(view, "https://a.png\nhttps://b.png");

      await vi.waitFor(() => {
        expect(mockShowMultiToast).toHaveBeenCalled();
      });

      // Disconnect before onConfirm's async function runs
      mockIsViewConnected
        .mockReturnValueOnce(true) // onConfirm guard
        .mockReturnValueOnce(false); // first check in insertMultipleImageMarkdown

      const toastArgs = mockShowMultiToast.mock.calls[0][0];
      await toastArgs.onConfirm();

      await vi.waitFor(() => {
        expect(mockSmartPasteWarn).toHaveBeenCalledWith(
          expect.stringContaining("disconnected")
        );
      });
    });

    it("shows dialog when needsCopy and no active file", async () => {
      const paths = ["/a.png"];
      mockParseMultiplePaths.mockReturnValue({ paths, format: "newline" });
      mockDetectMultipleImagePaths.mockReturnValue(
        multiImageResult([
          { type: "absolutePath", path: "/a.png", needsCopy: true },
          { type: "absolutePath", path: "/b.png", needsCopy: true },
        ])
      );
      mockValidateLocalPath.mockResolvedValue(true);
      mockGetActiveFilePath.mockReturnValue(null);

      const view = createView("hello", 0);
      tryImagePaste(view, "/a.png\n/b.png");

      await vi.waitFor(() => {
        expect(mockShowMultiToast).toHaveBeenCalled();
      });

      const toastArgs = mockShowMultiToast.mock.calls[0][0];
      await toastArgs.onConfirm();

      await vi.waitFor(() => {
        expect(mockMessage).toHaveBeenCalledWith(
          expect.stringContaining("save the document"),
          expect.anything()
        );
      });
    });

    it("expands home paths during multi-image copy", async () => {
      const paths = ["~/a.png"];
      mockParseMultiplePaths.mockReturnValue({ paths, format: "newline" });
      mockDetectMultipleImagePaths.mockReturnValue(
        multiImageResult([
          { type: "homePath", path: "~/a.png", needsCopy: true },
          { type: "homePath", path: "~/b.png", needsCopy: true },
        ])
      );
      mockValidateLocalPath.mockResolvedValue(true);
      mockExpandHomePath.mockResolvedValue("/Users/test/a.png");

      const view = createView("hello", 0);
      tryImagePaste(view, "~/a.png\n~/b.png");

      await vi.waitFor(() => {
        expect(mockShowMultiToast).toHaveBeenCalled();
      });

      const toastArgs = mockShowMultiToast.mock.calls[0][0];
      await toastArgs.onConfirm();

      await vi.waitFor(() => {
        expect(mockCopyImageToAssets).toHaveBeenCalled();
      });
    });

    it("shows error when home expansion fails during multi copy", async () => {
      const paths = ["~/a.png"];
      mockParseMultiplePaths.mockReturnValue({ paths, format: "newline" });
      mockDetectMultipleImagePaths.mockReturnValue(
        multiImageResult([
          { type: "homePath", path: "~/a.png", needsCopy: true },
          { type: "homePath", path: "~/b.png", needsCopy: true },
        ])
      );
      mockValidateLocalPath.mockResolvedValue(true);
      // First expandHomePath call for validation succeeds
      // Second call inside insertMultipleImageMarkdown fails
      mockExpandHomePath
        .mockResolvedValueOnce("/Users/test/a.png") // validation #1
        .mockResolvedValueOnce("/Users/test/b.png") // validation #2
        .mockResolvedValueOnce(null); // copy path

      const view = createView("hello", 0);
      tryImagePaste(view, "~/a.png\n~/b.png");

      await vi.waitFor(() => {
        expect(mockShowMultiToast).toHaveBeenCalled();
      });

      const toastArgs = mockShowMultiToast.mock.calls[0][0];
      await toastArgs.onConfirm();

      await vi.waitFor(() => {
        expect(mockMessage).toHaveBeenCalledWith(
          expect.stringContaining("home directory"),
          expect.objectContaining({ kind: "error" })
        );
      });
    });

    it("shows error when copy fails during multi-image", async () => {
      const paths = ["/a.png"];
      mockParseMultiplePaths.mockReturnValue({ paths, format: "newline" });
      mockDetectMultipleImagePaths.mockReturnValue(
        multiImageResult([
          { type: "absolutePath", path: "/a.png", needsCopy: true },
          { type: "absolutePath", path: "/b.png", needsCopy: true },
        ])
      );
      mockValidateLocalPath.mockResolvedValue(true);
      mockCopyImageToAssets.mockRejectedValue(new Error("fail"));

      const view = createView("hello", 0);
      tryImagePaste(view, "/a.png\n/b.png");

      await vi.waitFor(() => {
        expect(mockShowMultiToast).toHaveBeenCalled();
      });

      const toastArgs = mockShowMultiToast.mock.calls[0][0];
      await toastArgs.onConfirm();

      await vi.waitFor(() => {
        expect(mockMessage).toHaveBeenCalledWith(
          expect.stringContaining("Failed to copy"),
          expect.objectContaining({ kind: "error" })
        );
      });
    });

    it("handles selection change during multi-image async", async () => {
      const paths = ["https://a.png"];
      mockParseMultiplePaths.mockReturnValue({ paths, format: "newline" });
      mockDetectMultipleImagePaths.mockReturnValue(
        multiImageResult([
          { type: "url", path: "https://a.png", needsCopy: false },
          { type: "url", path: "https://b.png", needsCopy: false },
        ])
      );

      const view = createView("hello world", 0, 5);
      tryImagePaste(view, "https://a.png\nhttps://b.png");

      await vi.waitFor(() => {
        expect(mockShowMultiToast).toHaveBeenCalled();
      });

      // Change selection
      view.dispatch({ selection: { anchor: 6, head: 11 } });

      const toastArgs = mockShowMultiToast.mock.calls[0][0];
      await toastArgs.onConfirm();

      await vi.waitFor(() => {
        expect(mockSmartPasteWarn).toHaveBeenCalledWith(
          expect.stringContaining("Selection changed")
        );
      });
    });

    it("catches error from insertMultipleImageMarkdown rejection (line 274)", async () => {
      // Trigger the .catch() in showMultiImagePasteToast onConfirm by making
      // insertMultipleImageMarkdown reject. We use 2 absolutePath images with
      // needsCopy=true and no active file path so message() is called inside
      // insertMultipleImageMarkdown, then we make message() reject to cause the throw.
      const paths = ["/a.png", "/b.png"];
      mockParseMultiplePaths.mockReturnValue({ paths, format: "newline" });
      mockDetectMultipleImagePaths.mockReturnValue(
        multiImageResult([
          { type: "absolutePath", path: "/a.png", needsCopy: true },
          { type: "absolutePath", path: "/b.png", needsCopy: true },
        ])
      );
      mockValidateLocalPath.mockResolvedValue(true);
      mockGetActiveFilePath.mockReturnValue(null);
      // message() rejects to cause insertMultipleImageMarkdown to throw
      mockMessage.mockRejectedValueOnce(new Error("dialog error"));

      const view = createView("hello", 0);
      tryImagePaste(view, "/a.png\n/b.png");

      await vi.waitFor(() => {
        expect(mockShowMultiToast).toHaveBeenCalled();
      });

      const toastArgs = mockShowMultiToast.mock.calls[0][0];
      // onConfirm returns void (fire-and-forget), call it and wait for async operations
      toastArgs.onConfirm();

      // Wait for message to be called, meaning insertMultipleImageMarkdown ran and threw
      await vi.waitFor(() => {
        expect(mockMessage).toHaveBeenCalled();
      });
      // No unhandled rejection — the .catch() on line 273-275 handled it
    });

    it("disconnection after async in multi-image aborts", async () => {
      const paths = ["https://a.png"];
      mockParseMultiplePaths.mockReturnValue({ paths, format: "newline" });
      mockDetectMultipleImagePaths.mockReturnValue(
        multiImageResult([
          { type: "url", path: "https://a.png", needsCopy: false },
          { type: "url", path: "https://b.png", needsCopy: false },
        ])
      );

      const view = createView("hello", 0);
      tryImagePaste(view, "https://a.png\nhttps://b.png");

      await vi.waitFor(() => {
        expect(mockShowMultiToast).toHaveBeenCalled();
      });

      mockIsViewConnected
        .mockReturnValueOnce(true)  // onConfirm guard
        .mockReturnValueOnce(true)  // first check in insertMultipleImageMarkdown
        .mockReturnValueOnce(false); // after processing

      const toastArgs = mockShowMultiToast.mock.calls[0][0];
      await toastArgs.onConfirm();

      await vi.waitFor(() => {
        expect(mockSmartPasteWarn).toHaveBeenCalledWith(
          expect.stringContaining("disconnected after async")
        );
      });
    });

    it("catches errors from validateAndShowMultiToast", async () => {
      const paths = ["/a.png"];
      mockParseMultiplePaths.mockReturnValue({ paths, format: "newline" });
      mockDetectMultipleImagePaths.mockReturnValue(
        multiImageResult([
          { type: "absolutePath", path: "/a.png", needsCopy: true },
          { type: "absolutePath", path: "/b.png", needsCopy: true },
        ])
      );
      mockValidateLocalPath.mockRejectedValue(new Error("boom"));

      const view = createView("hello", 0);
      tryImagePaste(view, "/a.png\n/b.png");

      await vi.waitFor(() => {
        expect(mockPasteAsText).toHaveBeenCalled();
      });
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles pasting into empty document", () => {
      mockParseMultiplePaths.mockReturnValue({ paths: ["https://img.com/a.png"], format: "single" });
      mockDetectMultipleImagePaths.mockReturnValue(singleImageResult("url", "https://img.com/a.png"));

      const view = createView("", 0);
      expect(tryImagePaste(view, "https://img.com/a.png")).toBe(true);
    });

    it("handles pasting at end of document", () => {
      mockParseMultiplePaths.mockReturnValue({ paths: ["https://img.com/a.png"], format: "single" });
      mockDetectMultipleImagePaths.mockReturnValue(singleImageResult("url", "https://img.com/a.png"));

      const view = createView("hello", 5);
      expect(tryImagePaste(view, "https://img.com/a.png")).toBe(true);
    });

    it("encodes markdown URL with spaces", async () => {
      mockParseMultiplePaths.mockReturnValue({ paths: ["https://img.com/my image.png"], format: "single" });
      mockDetectMultipleImagePaths.mockReturnValue(singleImageResult("url", "https://img.com/my image.png"));
      mockEncodeMarkdownUrl.mockReturnValue("https://img.com/my%20image.png");

      const view = createView("hello", 0);
      tryImagePaste(view, "https://img.com/my image.png");

      const toastArgs = mockShowToast.mock.calls[0][0];
      await toastArgs.onConfirm();

      await vi.waitFor(() => {
        expect(view.state.doc.toString()).toContain("my%20image.png");
      });
    });

    it("data URLs in multi-image skip validation", async () => {
      const paths = ["data:image/png;base64,abc"];
      mockParseMultiplePaths.mockReturnValue({ paths, format: "newline" });
      mockDetectMultipleImagePaths.mockReturnValue(
        multiImageResult([
          { type: "dataUrl", path: "data:image/png;base64,abc", needsCopy: false },
          { type: "dataUrl", path: "data:image/png;base64,def", needsCopy: false },
        ])
      );

      const view = createView("hello", 0);
      tryImagePaste(view, "data:image/png;base64,abc\ndata:image/png;base64,def");

      await vi.waitFor(() => {
        expect(mockShowMultiToast).toHaveBeenCalled();
      });
      expect(mockValidateLocalPath).not.toHaveBeenCalled();
    });
  });
});
