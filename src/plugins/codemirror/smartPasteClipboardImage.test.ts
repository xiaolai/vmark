/**
 * Tests for Clipboard Image Paste in Source Mode
 *
 * Covers handleClipboardImagePaste and the disconnected-view guard in
 * saveAndInsertImages: if the view becomes detached during the async save
 * (closed tab, mode switch, unmount), no dispatch is performed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoisted mocks ────────────────────────────────────────────────

const mockSaveImageToAssets = vi.fn(() => Promise.resolve("assets/image.png"));
const mockSmartPasteWarn = vi.fn();
const mockEncodeMarkdownUrl = vi.fn((url: string) => url.replace(/ /g, "%20"));
const mockMessage = vi.fn(() => Promise.resolve());
const mockGenerateClipboardImageFilename = vi.fn(() => "img-123.png");
const mockGetWindowLabel = vi.fn(() => "main");
const mockGetDocument = vi.fn(() => ({ filePath: "/docs/test.md" }));
const mockIsViewConnected = vi.fn(() => true);

vi.mock("@/hooks/useImageOperations", () => ({
  saveImageToAssets: (...args: unknown[]) => mockSaveImageToAssets(...args),
}));

vi.mock("@/utils/debug", () => ({
  smartPasteWarn: (...args: unknown[]) => mockSmartPasteWarn(...args),
}));

vi.mock("@/utils/markdownUrl", () => ({
  encodeMarkdownUrl: (url: string) => mockEncodeMarkdownUrl(url),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: (...args: unknown[]) => mockMessage(...args),
}));

vi.mock("@/plugins/imageHandler/imageHandlerUtils", () => ({
  generateClipboardImageFilename: (...args: unknown[]) => mockGenerateClipboardImageFilename(...args),
}));

vi.mock("@/hooks/useWindowFocus", () => ({
  getWindowLabel: () => mockGetWindowLabel(),
}));

vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: () => ({ activeTabId: { main: "tab-1" } }),
  },
}));

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: () => ({ getDocument: mockGetDocument }),
  },
}));

vi.mock("@/i18n", () => ({
  default: { t: (key: string) => key },
}));

vi.mock("./smartPasteUtils", () => ({
  isViewConnected: (...args: unknown[]) => mockIsViewConnected(...args),
}));

import type { EditorView } from "@codemirror/view";
import { handleClipboardImagePaste } from "./smartPasteClipboardImage";

// ── Helpers ──────────────────────────────────────────────────────

interface FakeView {
  dispatch: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  state: { selection: { main: { from: number; to: number } } };
}

function createFakeView(from = 0, to = 0): FakeView {
  return {
    dispatch: vi.fn(),
    focus: vi.fn(),
    state: { selection: { main: { from, to } } },
  };
}

function createImageFile(): File {
  const buffer = new Uint8Array([1, 2, 3]).buffer;
  const file = {
    name: "image.png",
    type: "image/png",
    arrayBuffer: () => Promise.resolve(buffer),
  };
  return file as unknown as File;
}

function createClipboardEvent(files: File[]): ClipboardEvent {
  const items = files.map((file) => ({
    kind: "file" as const,
    type: file.type,
    getAsFile: () => file,
  }));
  return {
    clipboardData: { items },
  } as unknown as ClipboardEvent;
}

// ── Tests ────────────────────────────────────────────────────────

describe("handleClipboardImagePaste", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsViewConnected.mockReturnValue(true);
    mockGetDocument.mockReturnValue({ filePath: "/docs/test.md" });
    mockSaveImageToAssets.mockResolvedValue("assets/image.png");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when clipboard has no items", () => {
    const view = createFakeView();
    const event = { clipboardData: null } as unknown as ClipboardEvent;
    expect(handleClipboardImagePaste(view as unknown as EditorView, event)).toBe(false);
  });

  it("returns false when no image items present", () => {
    const view = createFakeView();
    const event = {
      clipboardData: {
        items: [{ kind: "string", type: "text/plain", getAsFile: () => null }],
      },
    } as unknown as ClipboardEvent;
    expect(handleClipboardImagePaste(view as unknown as EditorView, event)).toBe(false);
  });

  it("returns true and dispatches markdown when image is pasted with connected view", async () => {
    const view = createFakeView(0, 0);
    const event = createClipboardEvent([createImageFile()]);

    const result = handleClipboardImagePaste(view as unknown as EditorView, event);
    expect(result).toBe(true);

    await vi.waitFor(() => {
      expect(view.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: expect.objectContaining({ from: 0, to: 0, insert: expect.stringContaining("![](assets/image.png)") }),
        }),
      );
      expect(view.focus).toHaveBeenCalled();
    });
  });

  it("does NOT dispatch when view disconnects after async save", async () => {
    const view = createFakeView(0, 0);
    const event = createClipboardEvent([createImageFile()]);

    // View is connected at handler entry, but disconnects before final dispatch.
    mockIsViewConnected.mockReturnValueOnce(false);

    const result = handleClipboardImagePaste(view as unknown as EditorView, event);
    expect(result).toBe(true);

    await vi.waitFor(() => {
      expect(mockSaveImageToAssets).toHaveBeenCalled();
      expect(mockSmartPasteWarn).toHaveBeenCalledWith(
        expect.stringContaining("View disconnected after async save"),
      );
    });

    expect(view.dispatch).not.toHaveBeenCalled();
    expect(view.focus).not.toHaveBeenCalled();
  });

  it("shows warning dialog and skips insert when no active document file path", async () => {
    mockGetDocument.mockReturnValue({ filePath: undefined } as unknown as { filePath: string });
    const view = createFakeView();
    const event = createClipboardEvent([createImageFile()]);

    handleClipboardImagePaste(view as unknown as EditorView, event);

    await vi.waitFor(() => {
      expect(mockMessage).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ kind: "warning" }),
      );
    });
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("logs and skips insert when all saves fail", async () => {
    mockSaveImageToAssets.mockRejectedValue(new Error("disk full"));
    const view = createFakeView();
    const event = createClipboardEvent([createImageFile()]);

    handleClipboardImagePaste(view as unknown as EditorView, event);

    await vi.waitFor(() => {
      expect(mockSmartPasteWarn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to save clipboard image"),
        expect.any(String),
      );
    });
    expect(view.dispatch).not.toHaveBeenCalled();
  });
});
