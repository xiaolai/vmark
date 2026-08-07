// @vitest-environment node
/**
 * Tests for imageHandlerInsert — image insertion and text paste operations.
 *
 * Covers:
 *   - resolveImagePath (via insertImageFromPath)
 *   - insertImageFromPath (single image insert with alt text, selection restore)
 *   - insertMultipleImages (multi-image insert with position tracking)
 *   - pasteAsText (plain text fallback)
 *   - Edge cases: disconnected view, null filePath, home path expansion failures
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks (must be before imports) ---

const mockMessage = vi.fn(() => Promise.resolve());
vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: (...args: unknown[]) => mockMessage(...args),
}));

const mockCopyImageToAssets = vi.fn();
const mockInsertBlockImageNode = vi.fn();
vi.mock("@/services/media/imageOperations", () => ({
  copyImageToAssets: (...args: unknown[]) => mockCopyImageToAssets(...args),
  insertBlockImageNode: (...args: unknown[]) => mockInsertBlockImageNode(...args),
}));

const mockGetState = vi.fn();
vi.mock("@/plugins/shared/hostSettings", () => ({
  hostSettings: { copyImagesToAssets: () => mockGetState().image.copyToAssets },
}));

vi.mock("@/utils/debug", () => ({
  imageHandlerWarn: vi.fn(),
  imageHandlerError: vi.fn(),
}));

const mockIsViewConnected = vi.fn(() => true);
const mockGetActiveFilePathForCurrentWindow = vi.fn(() => "/docs/test.md");
const mockShowUnsavedDocWarning = vi.fn(() => Promise.resolve());
const mockExpandHomePath = vi.fn();

vi.mock("./imageHandlerUtils", () => ({
  isViewConnected: (...args: unknown[]) => mockIsViewConnected(...args),
  getActiveFilePathForCurrentWindow: () => mockGetActiveFilePathForCurrentWindow(),
  showUnsavedDocWarning: () => mockShowUnsavedDocWarning(),
  expandHomePath: (...args: unknown[]) => mockExpandHomePath(...args),
}));

// --- Imports (after mocks) ---

import { insertImageFromPath, insertMultipleImages, pasteAsText } from "./imageHandlerInsert";
import type { ImagePathResult } from "@/utils/imagePathDetection";
import type { EditorView } from "@tiptap/pm/view";

// --- Helpers ---

function createMockView(overrides: Record<string, unknown> = {}): EditorView {
  const mockDoc = {
    content: { size: 100 },
    resolve: vi.fn((pos: number) => ({
      depth: 1,
      end: () => pos + 5,
    })),
    textBetween: vi.fn(() => ""),
  };
  const mockState = {
    doc: mockDoc,
    tr: {
      setSelection: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      insertText: vi.fn().mockReturnThis(),
    },
    selection: { from: 0, to: 0, $from: { depth: 1, end: () => 10 } },
    schema: {
      nodes: {
        block_image: {
          create: vi.fn((attrs: Record<string, string>) => ({
            type: { name: "block_image" },
            attrs,
            nodeSize: 1,
          })),
        },
      },
    },
  };
  return {
    dom: { isConnected: true },
    state: mockState,
    dispatch: vi.fn(),
    focus: vi.fn(),
    ...overrides,
  } as unknown as EditorView;
}

function makeDetection(overrides: Partial<ImagePathResult> = {}): ImagePathResult {
  return {
    isImage: true,
    type: "absolutePath",
    path: "/Users/test/photo.png",
    needsCopy: true,
    originalText: "/Users/test/photo.png",
    ...overrides,
  };
}

// --- Tests ---

describe("insertImageFromPath", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetState.mockReturnValue({ image: { copyToAssets: true } });
    mockIsViewConnected.mockReturnValue(true);
    mockGetActiveFilePathForCurrentWindow.mockReturnValue("/docs/test.md");
    mockCopyImageToAssets.mockResolvedValue(".assets/photo.png");
    mockExpandHomePath.mockImplementation((p: string) => Promise.resolve(p));
  });

  it("inserts image after resolving path with copyToAssets", async () => {
    const view = createMockView();
    const detection = makeDetection();

    await insertImageFromPath(view, detection, 0, 0, "");

    expect(mockCopyImageToAssets).toHaveBeenCalledWith("/Users/test/photo.png", "/docs/test.md");
    expect(mockInsertBlockImageNode).toHaveBeenCalledWith(view, ".assets/photo.png", "");
  });

  it("uses captured alt text from selection", async () => {
    const view = createMockView();
    const detection = makeDetection();

    // No selection range means no TextSelection.create call
    await insertImageFromPath(view, detection, 0, 0, "selected text");

    expect(mockInsertBlockImageNode).toHaveBeenCalledWith(
      view,
      ".assets/photo.png",
      "selected text"
    );
  });

  it("restores selection when alt text is present and range differs", async () => {
    // Use a real ProseMirror doc for TextSelection.create
    const { Schema } = await import("@tiptap/pm/model");
    const { EditorState } = await import("@tiptap/pm/state");
    const testSchema = new Schema({
      nodes: {
        doc: { content: "paragraph+" },
        paragraph: { content: "text*" },
        text: { inline: true },
      },
    });
    const doc = testSchema.node("doc", null, [
      testSchema.node("paragraph", null, [testSchema.text("hello world testing")]),
    ]);
    const state = EditorState.create({ doc, schema: testSchema });
    const view = createMockView({
      state: {
        ...state,
        doc: state.doc,
        tr: state.tr,
        selection: state.selection,
      },
      dispatch: vi.fn(),
    });

    const detection = makeDetection();

    await insertImageFromPath(view, detection, 5, 15, "alt text");

    expect(view.dispatch).toHaveBeenCalled();
  });

  it("does not restore selection when no alt text", async () => {
    const view = createMockView();
    const detection = makeDetection();

    await insertImageFromPath(view, detection, 5, 15, "");

    // dispatch should only be called by insertBlockImageNode, not for selection restore
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("aborts when view is disconnected at start", async () => {
    mockIsViewConnected.mockReturnValue(false);
    const view = createMockView();
    const detection = makeDetection();

    await insertImageFromPath(view, detection, 0, 0, "");

    expect(mockCopyImageToAssets).not.toHaveBeenCalled();
    expect(mockInsertBlockImageNode).not.toHaveBeenCalled();
  });

  it("aborts when view disconnects after async operations", async () => {
    let callCount = 0;
    mockIsViewConnected.mockImplementation(() => {
      callCount++;
      // Connected on first check, disconnected on second
      return callCount <= 1;
    });
    const view = createMockView();
    const detection = makeDetection();

    await insertImageFromPath(view, detection, 0, 0, "");

    expect(mockCopyImageToAssets).toHaveBeenCalled();
    expect(mockInsertBlockImageNode).not.toHaveBeenCalled();
  });

  it("shows unsaved doc warning when filePath is null and needsCopy is true", async () => {
    mockGetActiveFilePathForCurrentWindow.mockReturnValue(null);
    const view = createMockView();
    const detection = makeDetection({ needsCopy: true });

    await insertImageFromPath(view, detection, 0, 0, "");

    expect(mockShowUnsavedDocWarning).toHaveBeenCalled();
    expect(mockInsertBlockImageNode).not.toHaveBeenCalled();
  });

  it("inserts URL detection directly without copying", async () => {
    const view = createMockView();
    const detection = makeDetection({
      type: "url",
      path: "https://example.com/photo.png",
      needsCopy: false,
    });

    await insertImageFromPath(view, detection, 0, 0, "");

    expect(mockCopyImageToAssets).not.toHaveBeenCalled();
    expect(mockInsertBlockImageNode).toHaveBeenCalledWith(
      view,
      "https://example.com/photo.png",
      ""
    );
  });

  it("expands home path before copying when type is homePath", async () => {
    const view = createMockView();
    mockExpandHomePath.mockResolvedValue("/Users/test/Pictures/photo.png");
    const detection = makeDetection({
      type: "homePath",
      path: "~/Pictures/photo.png",
      needsCopy: true,
    });

    await insertImageFromPath(view, detection, 0, 0, "");

    expect(mockExpandHomePath).toHaveBeenCalledWith("~/Pictures/photo.png");
    expect(mockCopyImageToAssets).toHaveBeenCalledWith(
      "/Users/test/Pictures/photo.png",
      "/docs/test.md"
    );
  });

  it("aborts when home path expansion fails", async () => {
    const view = createMockView();
    mockExpandHomePath.mockResolvedValue(null);
    const detection = makeDetection({
      type: "homePath",
      path: "~/Pictures/photo.png",
      needsCopy: true,
    });

    await insertImageFromPath(view, detection, 0, 0, "");

    expect(mockMessage).toHaveBeenCalledWith(
      "Failed to resolve home directory path.",
      { kind: "error" }
    );
    expect(mockInsertBlockImageNode).not.toHaveBeenCalled();
  });

  it("shows error when copyImageToAssets fails", async () => {
    const view = createMockView();
    mockCopyImageToAssets.mockRejectedValue(new Error("Disk full"));
    const detection = makeDetection();

    await insertImageFromPath(view, detection, 0, 0, "");

    expect(mockMessage).toHaveBeenCalledWith(
      "Failed to copy image to assets folder.",
      { kind: "error" }
    );
    expect(mockInsertBlockImageNode).not.toHaveBeenCalled();
  });

  it("returns expanded path when copyToAssets is disabled and type is homePath", async () => {
    mockGetState.mockReturnValue({ image: { copyToAssets: false } });
    mockExpandHomePath.mockResolvedValue("/Users/test/Pictures/photo.png");
    const view = createMockView();
    const detection = makeDetection({
      type: "homePath",
      path: "~/Pictures/photo.png",
      needsCopy: true,
    });

    await insertImageFromPath(view, detection, 0, 0, "");

    expect(mockCopyImageToAssets).not.toHaveBeenCalled();
    expect(mockInsertBlockImageNode).toHaveBeenCalledWith(
      view,
      "/Users/test/Pictures/photo.png",
      ""
    );
  });

  it("shows error when copyToAssets is disabled and home path expansion fails (lines 65-66)", async () => {
    mockGetState.mockReturnValue({ image: { copyToAssets: false } });
    mockExpandHomePath.mockResolvedValue(null);
    const view = createMockView();
    const detection = makeDetection({
      type: "homePath",
      path: "~/Pictures/photo.png",
      needsCopy: true,
    });

    await insertImageFromPath(view, detection, 0, 0, "");

    expect(mockMessage).toHaveBeenCalledWith(
      "Failed to resolve home directory path.",
      { kind: "error" }
    );
    expect(mockInsertBlockImageNode).not.toHaveBeenCalled();
  });

  it("clamps selection positions to doc size", async () => {
    // Use a real ProseMirror doc so TextSelection.create works
    const { Schema } = await import("@tiptap/pm/model");
    const { EditorState } = await import("@tiptap/pm/state");
    const testSchema = new Schema({
      nodes: {
        doc: { content: "paragraph+" },
        paragraph: { content: "text*" },
        text: { inline: true },
      },
    });
    // Short doc: "hi" has content size ~4
    const doc = testSchema.node("doc", null, [
      testSchema.node("paragraph", null, [testSchema.text("hi")]),
    ]);
    const state = EditorState.create({ doc, schema: testSchema });
    const mockDispatch = vi.fn();
    const view = createMockView({
      state: {
        ...state,
        doc: state.doc,
        tr: state.tr,
        selection: state.selection,
      },
      dispatch: mockDispatch,
    });

    const detection = makeDetection({ needsCopy: false });

    // capturedFrom=1, capturedTo=3 are within the doc, alt text triggers selection restore
    await insertImageFromPath(view, detection, 1, 3, "alt");

    expect(mockDispatch).toHaveBeenCalled();
  });
});

describe("insertMultipleImages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetState.mockReturnValue({ image: { copyToAssets: true } });
    mockIsViewConnected.mockReturnValue(true);
    mockGetActiveFilePathForCurrentWindow.mockReturnValue("/docs/test.md");
    mockCopyImageToAssets.mockImplementation((src: string) =>
      Promise.resolve(`.assets/${src.split("/").pop()}`)
    );
    mockExpandHomePath.mockImplementation((p: string) => Promise.resolve(p));
  });

  it("inserts multiple images in a single transaction", async () => {
    const view = createMockView();
    const results: ImagePathResult[] = [
      makeDetection({ path: "/Users/test/a.png" }),
      makeDetection({ path: "/Users/test/b.jpg" }),
    ];

    await insertMultipleImages(view, results, 0, 0);

    expect(mockCopyImageToAssets).toHaveBeenCalledTimes(2);
    expect(view.dispatch).toHaveBeenCalledTimes(1);
  });

  it("aborts when view is disconnected", async () => {
    mockIsViewConnected.mockReturnValue(false);
    const view = createMockView();
    const results = [makeDetection()];

    await insertMultipleImages(view, results, 0, 0);

    expect(mockCopyImageToAssets).not.toHaveBeenCalled();
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("aborts all images if any resolveImagePath fails", async () => {
    mockCopyImageToAssets
      .mockResolvedValueOnce(".assets/a.png")
      .mockRejectedValueOnce(new Error("Copy failed"));
    const view = createMockView();
    const results = [
      makeDetection({ path: "/a.png" }),
      makeDetection({ path: "/b.png" }),
    ];

    await insertMultipleImages(view, results, 0, 0);

    // Second copy fails, so no images are inserted
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("does nothing when no images resolve", async () => {
    const view = createMockView();

    await insertMultipleImages(view, [], 0, 0);

    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("aborts when block_image node type is not in schema", async () => {
    const view = createMockView();
    (view.state.schema.nodes as Record<string, unknown>).block_image = undefined;
    const results = [makeDetection({ needsCopy: false })];

    await insertMultipleImages(view, results, 0, 0);

    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("aborts when view disconnects after async resolution", async () => {
    let callCount = 0;
    mockIsViewConnected.mockImplementation(() => {
      callCount++;
      return callCount <= 1;
    });
    const view = createMockView();
    const results = [makeDetection({ needsCopy: false })];

    await insertMultipleImages(view, results, 0, 0);

    expect(view.dispatch).not.toHaveBeenCalled();
  });
});

describe("pasteAsText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsViewConnected.mockReturnValue(true);
  });

  it("inserts text at captured position when selection matches", () => {
    const view = createMockView();
    (view.state.selection as { from: number; to: number }).from = 5;
    (view.state.selection as { from: number; to: number }).to = 10;

    pasteAsText(view, "hello", 5, 10);

    expect(view.state.tr.insertText).toHaveBeenCalledWith("hello", 5, 10);
    expect(view.dispatch).toHaveBeenCalled();
    expect(view.focus).toHaveBeenCalled();
  });

  it("uses current selection when it differs from captured", () => {
    const view = createMockView();
    (view.state.selection as { from: number; to: number }).from = 20;
    (view.state.selection as { from: number; to: number }).to = 25;

    pasteAsText(view, "hello", 5, 10);

    expect(view.state.tr.insertText).toHaveBeenCalledWith("hello", 20, 25);
  });

  it("does nothing when view is disconnected", () => {
    mockIsViewConnected.mockReturnValue(false);
    const view = createMockView();

    pasteAsText(view, "hello", 0, 0);

    expect(view.dispatch).not.toHaveBeenCalled();
    expect(view.focus).not.toHaveBeenCalled();
  });

  it("handles empty text", () => {
    const view = createMockView();

    pasteAsText(view, "", 0, 0);

    expect(view.state.tr.insertText).toHaveBeenCalledWith("", 0, 0);
    expect(view.dispatch).toHaveBeenCalled();
  });

  it("handles collapsed selection (from === to)", () => {
    const view = createMockView();
    (view.state.selection as { from: number; to: number }).from = 10;
    (view.state.selection as { from: number; to: number }).to = 10;

    pasteAsText(view, "inserted", 10, 10);

    expect(view.state.tr.insertText).toHaveBeenCalledWith("inserted", 10, 10);
  });
});

describe("resolveImagePath — needsCopy && !copyToAssets branch for non-homePath type (line 62)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetState.mockReturnValue({ image: { copyToAssets: false } });
    mockIsViewConnected.mockReturnValue(true);
    mockGetActiveFilePathForCurrentWindow.mockReturnValue("/docs/test.md");
  });

  it("returns detection.path directly when needsCopy=true, copyToAssets=false, type is absolutePath", async () => {
    const view = createMockView();
    const detection = makeDetection({
      type: "absolutePath",
      path: "/Users/test/photo.png",
      needsCopy: true,
    });

    await insertImageFromPath(view, detection, 0, 0, "");

    // copyToAssets is false and type is not homePath — goes straight to return detection.path
    expect(mockCopyImageToAssets).not.toHaveBeenCalled();
    expect(mockInsertBlockImageNode).toHaveBeenCalledWith(
      view,
      "/Users/test/photo.png",
      ""
    );
  });
});

describe("insertImageFromPath — safeFrom >= safeTo branch (line 112)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetState.mockReturnValue({ image: { copyToAssets: false } });
    mockIsViewConnected.mockReturnValue(true);
    mockGetActiveFilePathForCurrentWindow.mockReturnValue("/docs/test.md");
  });

  it("skips selection restore when both captured positions clamp to the same maxPos value", async () => {
    const { Schema } = await import("@tiptap/pm/model");
    const { EditorState } = await import("@tiptap/pm/state");
    const testSchema = new Schema({
      nodes: {
        doc: { content: "paragraph+" },
        paragraph: { content: "text*" },
        text: { inline: true },
      },
    });
    // Short doc: content.size is small (e.g. 4 for "hi" in a paragraph)
    const doc = testSchema.node("doc", null, [
      testSchema.node("paragraph", null, [testSchema.text("hi")]),
    ]);
    const state = EditorState.create({ doc, schema: testSchema });
    const mockDispatch = vi.fn();
    const view = createMockView({
      state: { ...state, doc: state.doc, tr: state.tr, selection: state.selection },
      dispatch: mockDispatch,
    });

    const detection = makeDetection({ needsCopy: false });

    // capturedFrom=100 and capturedTo=200: they differ, so outer if is entered.
    // Both > maxPos (doc size ~4), so both clamp to maxPos → safeFrom === safeTo → line 112 is false.
    await insertImageFromPath(view, detection, 100, 200, "alt text");

    // No selection restore dispatch since safeFrom === safeTo after clamping
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
