// @vitest-environment node
/**
 * Tests for imageHandlerToast — toast display for image paste confirmation.
 *
 * Covers:
 *   - tryTextImagePaste (entry point for text-based image paste detection)
 *   - Single image: URL, data URL, absolute path, home path, relative path
 *   - Multiple images: validation and multi-toast display
 *   - Toast callbacks: onConfirm inserts image, onDismiss pastes text
 *   - Edge cases: empty text, non-image text, failed validation, disconnected view
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks (must be before imports) ---

const mockInsertImageFromPath = vi.fn(() => Promise.resolve());
const mockInsertMultipleImages = vi.fn(() => Promise.resolve());
const mockPasteAsText = vi.fn();
vi.mock("./imageHandlerInsert", () => ({
  insertImageFromPath: (...args: unknown[]) => mockInsertImageFromPath(...args),
  insertMultipleImages: (...args: unknown[]) => mockInsertMultipleImages(...args),
  pasteAsText: (...args: unknown[]) => mockPasteAsText(...args),
}));

const mockShowToast = vi.fn();
const mockShowMultiToast = vi.fn();
// One seam member now, dispatching on whether a batch was passed — mirror
// that split here so the two toasts stay separately assertable.
vi.mock("@/plugins/shared/hostPopups", () => ({
  hostPopups: {
    showImagePasteToast: (r: { imageResults?: unknown[] }) =>
      r.imageResults ? mockShowMultiToast(r) : mockShowToast(r),
  },
}));

vi.mock("@/utils/debug", () => ({
  imageHandlerWarn: vi.fn(),
  imageHandlerError: vi.fn(),
}));

const mockIsViewConnected = vi.fn(() => true);
const mockValidateLocalPath = vi.fn(() => Promise.resolve(true));
const mockExpandHomePath = vi.fn((p: string) => Promise.resolve(p));
const mockGetToastAnchorRect = vi.fn(() => ({
  top: 100,
  left: 200,
  bottom: 120,
  right: 220,
}));

vi.mock("./imageHandlerUtils", () => ({
  isViewConnected: (...args: unknown[]) => mockIsViewConnected(...args),
  validateLocalPath: (...args: unknown[]) => mockValidateLocalPath(...args),
  expandHomePath: (...args: unknown[]) => mockExpandHomePath(...args),
  getToastAnchorRect: (...args: unknown[]) => mockGetToastAnchorRect(...args),
}));

// Real implementations for detection/parsing
vi.mock("@/utils/imagePathDetection", async () => {
  const actual = await vi.importActual<typeof import("@/utils/imagePathDetection")>(
    "@/utils/imagePathDetection"
  );
  return actual;
});

vi.mock("@/utils/multiImageParsing", async () => {
  const actual = await vi.importActual<typeof import("@/utils/multiImageParsing")>(
    "@/utils/multiImageParsing"
  );
  return actual;
});

// --- Imports (after mocks) ---

import { tryTextImagePaste } from "./imageHandlerToast";
import type { EditorView } from "@tiptap/pm/view";

// --- Helpers ---

function createMockView(overrides: Record<string, unknown> = {}): EditorView {
  return {
    dom: { isConnected: true },
    state: {
      selection: { from: 0, to: 0 },
      doc: {
        textBetween: vi.fn(() => ""),
      },
    },
    coordsAtPos: vi.fn(() => ({ top: 100, left: 200, bottom: 120, right: 220 })),
    ...overrides,
  } as unknown as EditorView;
}

// --- Tests ---

describe("tryTextImagePaste", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsViewConnected.mockReturnValue(true);
    mockValidateLocalPath.mockResolvedValue(true);
    mockExpandHomePath.mockImplementation((p: string) => Promise.resolve(p));
  });

  // --- Returns false for non-image text ---

  it("returns false for empty text", () => {
    const view = createMockView();
    expect(tryTextImagePaste(view, "")).toBe(false);
  });

  it("returns false for plain text without image extension", () => {
    const view = createMockView();
    expect(tryTextImagePaste(view, "hello world")).toBe(false);
  });

  it("returns false for non-image URL", () => {
    const view = createMockView();
    expect(tryTextImagePaste(view, "https://example.com/page.html")).toBe(false);
  });

  it("returns false for non-image file path", () => {
    const view = createMockView();
    expect(tryTextImagePaste(view, "/Users/test/document.pdf")).toBe(false);
  });

  // --- Single image: URL ---

  it("returns true and shows toast for HTTP image URL", () => {
    const view = createMockView();
    const result = tryTextImagePaste(view, "https://example.com/photo.png");

    expect(result).toBe(true);
    expect(mockShowToast).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({
        imagePath: "https://example.com/photo.png",
        imageType: "url",
      })
    );
  });

  it("returns true and shows toast for data URL image", () => {
    const view = createMockView();
    const result = tryTextImagePaste(view, "data:image/png;base64,abc123");

    expect(result).toBe(true);
    expect(mockShowToast).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({
        imageType: "url",
      })
    );
  });

  // --- Single image: Local paths (async validation) ---

  it("returns true for absolute local path (triggers async validation)", () => {
    const view = createMockView();
    const result = tryTextImagePaste(view, "/Users/test/photo.png");

    expect(result).toBe(true);
    // Toast shown asynchronously after validation
  });

  it("returns true for relative path (no validation needed)", () => {
    const view = createMockView();
    const result = tryTextImagePaste(view, "./assets/photo.png");

    expect(result).toBe(true);
  });

  it("returns true for home path", () => {
    const view = createMockView();
    const result = tryTextImagePaste(view, "~/Pictures/photo.png");

    expect(result).toBe(true);
  });

  // --- Single image: Toast callbacks ---

  it("toast onConfirm calls insertImageFromPath", () => {
    const view = createMockView();
    tryTextImagePaste(view, "https://example.com/photo.png");

    const toastArgs = mockShowToast.mock.calls[0][0];
    toastArgs.onConfirm();

    expect(mockInsertImageFromPath).toHaveBeenCalledWith(
      view,
      expect.objectContaining({ path: "https://example.com/photo.png" }),
      0,
      0,
      ""
    );
  });

  it("toast onDismiss calls pasteAsText", () => {
    const view = createMockView();
    tryTextImagePaste(view, "https://example.com/photo.png");

    const toastArgs = mockShowToast.mock.calls[0][0];
    toastArgs.onDismiss();

    expect(mockPasteAsText).toHaveBeenCalledWith(
      view,
      "https://example.com/photo.png",
      0,
      0
    );
  });

  it("toast onConfirm does nothing when view is disconnected", () => {
    const view = createMockView();
    tryTextImagePaste(view, "https://example.com/photo.png");

    mockIsViewConnected.mockReturnValue(false);
    const toastArgs = mockShowToast.mock.calls[0][0];
    toastArgs.onConfirm();

    expect(mockInsertImageFromPath).not.toHaveBeenCalled();
  });

  it("toast onDismiss does nothing when view is disconnected", () => {
    const view = createMockView();
    tryTextImagePaste(view, "https://example.com/photo.png");

    mockIsViewConnected.mockReturnValue(false);
    const toastArgs = mockShowToast.mock.calls[0][0];
    toastArgs.onDismiss();

    expect(mockPasteAsText).not.toHaveBeenCalled();
  });

  // --- Single image: captures selection state ---

  it("captures selection from/to and alt text at paste time", () => {
    const view = createMockView({
      state: {
        selection: { from: 5, to: 15 },
        doc: { textBetween: vi.fn(() => "selected text") },
      },
    });

    tryTextImagePaste(view, "https://example.com/photo.png");

    const toastArgs = mockShowToast.mock.calls[0][0];
    toastArgs.onConfirm();

    expect(mockInsertImageFromPath).toHaveBeenCalledWith(
      view,
      expect.anything(),
      5,
      15,
      "selected text"
    );
  });

  it("captures empty alt text when no selection", () => {
    const view = createMockView({
      state: {
        selection: { from: 10, to: 10 },
        doc: { textBetween: vi.fn(() => "") },
      },
    });

    tryTextImagePaste(view, "https://example.com/photo.png");

    const toastArgs = mockShowToast.mock.calls[0][0];
    toastArgs.onConfirm();

    expect(mockInsertImageFromPath).toHaveBeenCalledWith(
      view,
      expect.anything(),
      10,
      10,
      ""
    );
  });

  // --- Async validation: absolute path ---

  it("shows toast after successful path validation", async () => {
    mockValidateLocalPath.mockResolvedValue(true);
    const view = createMockView();

    tryTextImagePaste(view, "/Users/test/photo.png");

    // Wait for async validation
    await vi.waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledTimes(1);
    });
  });

  it("pastes as text when path validation fails", async () => {
    mockValidateLocalPath.mockResolvedValue(false);
    const view = createMockView();

    tryTextImagePaste(view, "/Users/test/nonexistent.png");

    await vi.waitFor(() => {
      expect(mockPasteAsText).toHaveBeenCalledWith(
        view,
        "/Users/test/nonexistent.png",
        0,
        0
      );
    });
  });

  it("pastes as text when home path expansion fails", async () => {
    mockExpandHomePath.mockResolvedValue(null);
    const view = createMockView();

    tryTextImagePaste(view, "~/Pictures/photo.png");

    await vi.waitFor(() => {
      expect(mockPasteAsText).toHaveBeenCalledWith(
        view,
        "~/Pictures/photo.png",
        0,
        0
      );
    });
  });

  it("does not show toast if view disconnects during validation", async () => {
    // Start connected, disconnect after validation resolves
    mockValidateLocalPath.mockImplementation(async () => {
      mockIsViewConnected.mockReturnValue(false);
      return true;
    });
    const view = createMockView();

    tryTextImagePaste(view, "/Users/test/photo.png");

    await vi.waitFor(() => {
      expect(mockValidateLocalPath).toHaveBeenCalled();
    });
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  // --- Multiple images ---

  it("returns true for multiple image paths (newline-separated)", () => {
    const view = createMockView();
    const text = "/Users/test/a.png\n/Users/test/b.jpg";
    const result = tryTextImagePaste(view, text);

    expect(result).toBe(true);
  });

  it("shows multi-toast after validating multiple paths", async () => {
    mockValidateLocalPath.mockResolvedValue(true);
    const view = createMockView();
    const text = "/Users/test/a.png\n/Users/test/b.jpg";

    tryTextImagePaste(view, text);

    await vi.waitFor(() => {
      expect(mockShowMultiToast).toHaveBeenCalledTimes(1);
    });

    const toastArgs = mockShowMultiToast.mock.calls[0][0];
    expect(toastArgs.imageResults).toHaveLength(2);
  });

  it("multi-toast onConfirm calls insertMultipleImages", async () => {
    mockValidateLocalPath.mockResolvedValue(true);
    const view = createMockView();
    const text = "/Users/test/a.png\n/Users/test/b.jpg";

    tryTextImagePaste(view, text);

    await vi.waitFor(() => {
      expect(mockShowMultiToast).toHaveBeenCalled();
    });

    const toastArgs = mockShowMultiToast.mock.calls[0][0];
    toastArgs.onConfirm();

    expect(mockInsertMultipleImages).toHaveBeenCalled();
  });

  it("multi-toast onDismiss calls pasteAsText", async () => {
    mockValidateLocalPath.mockResolvedValue(true);
    const view = createMockView();
    const text = "/Users/test/a.png\n/Users/test/b.jpg";

    tryTextImagePaste(view, text);

    await vi.waitFor(() => {
      expect(mockShowMultiToast).toHaveBeenCalled();
    });

    const toastArgs = mockShowMultiToast.mock.calls[0][0];
    toastArgs.onDismiss();

    expect(mockPasteAsText).toHaveBeenCalledWith(view, text, 0, 0);
  });

  it("pastes as text when any path in multi-image is invalid", async () => {
    mockValidateLocalPath
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const view = createMockView();
    const text = "/Users/test/a.png\n/Users/test/nonexistent.jpg";

    tryTextImagePaste(view, text);

    await vi.waitFor(() => {
      expect(mockPasteAsText).toHaveBeenCalledWith(view, text, 0, 0);
    });
    expect(mockShowMultiToast).not.toHaveBeenCalled();
  });

  it("returns false when multi-line text has mixed image and non-image", () => {
    const view = createMockView();
    const text = "/Users/test/a.png\nhello world";

    const result = tryTextImagePaste(view, text);

    expect(result).toBe(false);
  });

  it("does not validate URL paths in multi-image (only local paths)", async () => {
    const view = createMockView();
    const text = "https://example.com/a.png\nhttps://example.com/b.jpg";

    tryTextImagePaste(view, text);

    await vi.waitFor(() => {
      expect(mockShowMultiToast).toHaveBeenCalled();
    });
    expect(mockValidateLocalPath).not.toHaveBeenCalled();
  });

  it("multi-toast onConfirm does nothing when view is disconnected", async () => {
    mockValidateLocalPath.mockResolvedValue(true);
    const view = createMockView();
    const text = "/Users/test/a.png\n/Users/test/b.jpg";

    tryTextImagePaste(view, text);

    await vi.waitFor(() => {
      expect(mockShowMultiToast).toHaveBeenCalled();
    });

    mockIsViewConnected.mockReturnValue(false);
    const toastArgs = mockShowMultiToast.mock.calls[0][0];
    toastArgs.onConfirm();

    expect(mockInsertMultipleImages).not.toHaveBeenCalled();
  });

  // --- Edge cases ---

  it("handles Windows absolute path", () => {
    const view = createMockView();
    const result = tryTextImagePaste(view, "C:\\Users\\test\\photo.png");

    expect(result).toBe(true);
  });

  it("handles image URL with query parameters", () => {
    const view = createMockView();
    const result = tryTextImagePaste(view, "https://example.com/photo.png?width=100");

    expect(result).toBe(true);
    expect(mockShowToast).toHaveBeenCalled();
  });

  it("shows toast with correct imageType for local paths", async () => {
    mockValidateLocalPath.mockResolvedValue(true);
    const view = createMockView();

    tryTextImagePaste(view, "/Users/test/photo.png");

    await vi.waitFor(() => {
      expect(mockShowToast).toHaveBeenCalled();
    });

    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({
        imageType: "localPath",
      })
    );
  });

  it("falls back to pasteAsText on validation error (catch path)", async () => {
    mockValidateLocalPath.mockRejectedValue(new Error("FS error"));
    const view = createMockView();

    tryTextImagePaste(view, "/Users/test/photo.png");

    await vi.waitFor(() => {
      expect(mockPasteAsText).toHaveBeenCalled();
    });
  });

  // --- Relative path (no validation needed for single image) ---

  it("shows toast for relative path without validating", async () => {
    const view = createMockView();
    tryTextImagePaste(view, "./assets/photo.png");

    await vi.waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledTimes(1);
    });
    // Relative paths skip validation entirely
    expect(mockValidateLocalPath).not.toHaveBeenCalled();
    expect(mockExpandHomePath).not.toHaveBeenCalled();
  });

  // --- Home path validation with expand + validate ---

  it("validates expanded home path before showing toast", async () => {
    mockExpandHomePath.mockResolvedValue("/Users/me/Pictures/photo.png");
    mockValidateLocalPath.mockResolvedValue(true);
    const view = createMockView();

    tryTextImagePaste(view, "~/Pictures/photo.png");

    await vi.waitFor(() => {
      expect(mockShowToast).toHaveBeenCalled();
    });
    expect(mockExpandHomePath).toHaveBeenCalledWith("~/Pictures/photo.png");
    expect(mockValidateLocalPath).toHaveBeenCalledWith("/Users/me/Pictures/photo.png");
  });

  it("pastes as text when home path is valid but file does not exist", async () => {
    mockExpandHomePath.mockResolvedValue("/Users/me/Pictures/photo.png");
    mockValidateLocalPath.mockResolvedValue(false);
    const view = createMockView();

    tryTextImagePaste(view, "~/Pictures/photo.png");

    await vi.waitFor(() => {
      expect(mockPasteAsText).toHaveBeenCalled();
    });
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it("does not paste as text when view disconnects during home path validation", async () => {
    mockExpandHomePath.mockImplementation(async () => {
      mockIsViewConnected.mockReturnValue(false);
      return null;
    });
    const view = createMockView();

    tryTextImagePaste(view, "~/Pictures/photo.png");

    await vi.waitFor(() => {
      expect(mockExpandHomePath).toHaveBeenCalled();
    });
    // View disconnected, so pasteAsText should NOT be called
    expect(mockPasteAsText).not.toHaveBeenCalled();
  });

  // --- Multi-image: home path and relative path branches ---

  it("validates home paths in multi-image and shows multi-toast", async () => {
    mockExpandHomePath.mockResolvedValue("/Users/me/a.png");
    mockValidateLocalPath.mockResolvedValue(true);
    const view = createMockView();
    const text = "~/a.png\n~/b.jpg";

    tryTextImagePaste(view, text);

    await vi.waitFor(() => {
      expect(mockShowMultiToast).toHaveBeenCalled();
    });
  });

  it("pastes as text when home path expansion fails in multi-image", async () => {
    mockExpandHomePath.mockResolvedValue(null);
    const view = createMockView();
    const text = "~/a.png\n~/b.jpg";

    tryTextImagePaste(view, text);

    await vi.waitFor(() => {
      expect(mockPasteAsText).toHaveBeenCalled();
    });
    expect(mockShowMultiToast).not.toHaveBeenCalled();
  });

  it("accepts relative paths in multi-image without validation", async () => {
    const view = createMockView();
    const text = "./img/a.png\n./img/b.jpg";

    tryTextImagePaste(view, text);

    await vi.waitFor(() => {
      expect(mockShowMultiToast).toHaveBeenCalled();
    });
    expect(mockValidateLocalPath).not.toHaveBeenCalled();
  });

  it("does not show multi-toast if view disconnects during validation", async () => {
    mockValidateLocalPath.mockImplementation(async () => {
      mockIsViewConnected.mockReturnValue(false);
      return true;
    });
    const view = createMockView();
    const text = "/Users/test/a.png\n/Users/test/b.jpg";

    tryTextImagePaste(view, text);

    await vi.waitFor(() => {
      expect(mockValidateLocalPath).toHaveBeenCalled();
    });
    expect(mockShowMultiToast).not.toHaveBeenCalled();
  });

  it("falls back to pasteAsText on multi-image validation error (catch path)", async () => {
    mockValidateLocalPath.mockRejectedValue(new Error("FS error"));
    const view = createMockView();
    const text = "/Users/test/a.png\n/Users/test/b.jpg";

    tryTextImagePaste(view, text);

    await vi.waitFor(() => {
      expect(mockPasteAsText).toHaveBeenCalled();
    });
  });

  it("does not paste as text on multi-image error when view is disconnected", async () => {
    mockIsViewConnected.mockReturnValue(false);
    mockValidateLocalPath.mockRejectedValue(new Error("FS error"));
    const view = createMockView();
    const text = "/Users/test/a.png\n/Users/test/b.jpg";

    tryTextImagePaste(view, text);

    await vi.waitFor(() => {
      expect(mockValidateLocalPath).toHaveBeenCalled();
    });
    expect(mockPasteAsText).not.toHaveBeenCalled();
  });

  it("multi-toast onDismiss does nothing when view is disconnected", async () => {
    mockValidateLocalPath.mockResolvedValue(true);
    const view = createMockView();
    const text = "/Users/test/a.png\n/Users/test/b.jpg";

    tryTextImagePaste(view, text);

    await vi.waitFor(() => {
      expect(mockShowMultiToast).toHaveBeenCalled();
    });

    mockIsViewConnected.mockReturnValue(false);
    const toastArgs = mockShowMultiToast.mock.calls[0][0];
    toastArgs.onDismiss();

    expect(mockPasteAsText).not.toHaveBeenCalled();
  });

  // --- paths.length === 0 (line 37 true branch) ---

  it("returns false when text has no parseable paths (paths.length === 0)", () => {
    const view = createMockView();
    // A string with only whitespace — parseMultiplePaths produces no paths
    const result = tryTextImagePaste(view, "   \t\n   ");

    expect(result).toBe(false);
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  // --- Single-image catch: view NOT connected (line 61 else branch) ---

  it("does not paste as text on single-image catch when view is disconnected", async () => {
    mockIsViewConnected.mockReturnValue(false);
    mockValidateLocalPath.mockRejectedValue(new Error("FS error"));
    const view = createMockView();

    tryTextImagePaste(view, "/Users/test/photo.png");

    await vi.waitFor(() => {
      expect(mockValidateLocalPath).toHaveBeenCalled();
    });

    // View disconnected → else branch at line 61 → pasteAsText NOT called
    expect(mockPasteAsText).not.toHaveBeenCalled();
  });

  // --- Single-image validation fails + view disconnected (line 109 else branch) ---

  it("does not paste as text when view disconnects before path-not-found paste (line 109 else)", async () => {
    // Path validation succeeds (valid=true → expandHomePath not needed for absolutePath),
    // but for absolutePath the validate resolves false AND view is disconnected.
    mockIsViewConnected.mockReturnValue(false);
    mockValidateLocalPath.mockResolvedValue(false);
    const view = createMockView();

    tryTextImagePaste(view, "/Users/test/nonexistent.png");

    await vi.waitFor(() => {
      expect(mockValidateLocalPath).toHaveBeenCalled();
    });

    // View disconnected → else branch at line 109 → pasteAsText NOT called
    expect(mockPasteAsText).not.toHaveBeenCalled();
  });

  // --- Multi-image: some invalid + view disconnected (line 204 else branch) ---

  it("does not paste as text when view disconnects before multi-image invalid paste (line 204 else)", async () => {
    mockIsViewConnected.mockReturnValue(false);
    // First path valid, second invalid
    mockValidateLocalPath
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const view = createMockView();
    const text = "/Users/test/a.png\n/Users/test/nonexistent.jpg";

    tryTextImagePaste(view, text);

    await vi.waitFor(() => {
      expect(mockValidateLocalPath).toHaveBeenCalled();
    });

    // Some invalid AND view disconnected → else branch at line 204 → pasteAsText NOT called
    expect(mockPasteAsText).not.toHaveBeenCalled();
    expect(mockShowMultiToast).not.toHaveBeenCalled();
  });
});
