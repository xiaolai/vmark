/**
 * Media Popup Actions Tests
 *
 * Tests for file-system operations: browse, copy to assets, update node.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
const mockOpen = vi.fn();
const mockMessage = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => mockOpen(...args),
  message: (...args: unknown[]) => mockMessage(...args),
}));

const mockCopyMediaToAssets = vi.fn();
vi.mock("@/hooks/useMediaOperations", () => ({
  copyMediaToAssets: (...args: unknown[]) => mockCopyMediaToAssets(...args),
}));

const mockCopyImageToAssets = vi.fn();
vi.mock("@/hooks/useImageOperations", () => ({
  copyImageToAssets: (...args: unknown[]) => mockCopyImageToAssets(...args),
}));

vi.mock("@/utils/reentryGuard", () => ({
  withReentryGuard: vi.fn(
    async (_windowLabel: string, _operation: string, fn: () => Promise<unknown>) => {
      return fn();
    }
  ),
}));

vi.mock("@/hooks/useWindowFocus", () => ({
  getWindowLabel: () => "main",
}));

const mockClosePopup = vi.fn();
const mockSetSrc = vi.fn();
let storeState = {
  isOpen: true,
  mediaSrc: "/old-video.mp4",
  mediaTitle: "",
  mediaNodePos: 10,
  mediaNodeType: "block_video" as const,
  mediaPoster: "",
  anchorRect: null,
  closePopup: mockClosePopup,
  setSrc: mockSetSrc,
  setTitle: vi.fn(),
  setPoster: vi.fn(),
};

vi.mock("@/stores/mediaPopupStore", () => ({
  useMediaPopupStore: {
    getState: () => storeState,
    subscribe: () => () => {},
  },
}));

// Mutable state for document/tab store to allow per-test overrides
let mockActiveTabId: Record<string, string | null> = { main: "tab-1" };
let mockGetDocument: (id: string) => { filePath: string } | undefined = (id) =>
  id === "tab-1" ? { filePath: "/docs/my-doc.md" } : undefined;

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: () => ({
      getDocument: (id: string) => mockGetDocument(id),
    }),
  },
}));

vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: () => ({
      activeTabId: mockActiveTabId,
    }),
  },
}));

import { browseAndReplaceMedia } from "../mediaPopupActions";

function createMockView(nodeType = "block_video") {
  return {
    state: {
      doc: {
        nodeAt: vi.fn(() => ({
          type: { name: nodeType },
          attrs: { src: "/old.mp4", title: "", poster: "" },
          nodeSize: 1,
        })),
      },
      tr: {
        setNodeMarkup: vi.fn().mockReturnThis(),
      },
    },
    dispatch: vi.fn(),
  } as unknown as Parameters<typeof browseAndReplaceMedia>[0];
}

describe("browseAndReplaceMedia", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState = {
      ...storeState,
      mediaNodeType: "block_video",
      mediaNodePos: 10,
    };
    mockActiveTabId = { main: "tab-1" };
    mockGetDocument = (id) =>
      id === "tab-1" ? { filePath: "/docs/my-doc.md" } : undefined;
  });

  it("opens dialog with video filters for block_video", async () => {
    mockOpen.mockResolvedValue("/new-video.mp4");
    mockCopyMediaToAssets.mockResolvedValue("assets/new-video.mp4");

    const view = createMockView();
    await browseAndReplaceMedia(view, 10, "block_video");

    expect(mockOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [
          expect.objectContaining({
            name: "Videos",
            extensions: expect.arrayContaining(["mp4", "webm", "mov"]),
          }),
        ],
      })
    );
  });

  it("opens dialog with audio filters for block_audio", async () => {
    mockOpen.mockResolvedValue("/music.mp3");
    mockCopyMediaToAssets.mockResolvedValue("assets/music.mp3");

    storeState.mediaNodeType = "block_audio" as "block_video";
    const view = createMockView("block_audio");
    await browseAndReplaceMedia(view, 10, "block_audio");

    expect(mockOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [
          expect.objectContaining({
            name: "Audio",
            extensions: expect.arrayContaining(["mp3", "ogg", "wav"]),
          }),
        ],
      })
    );
  });

  it("returns true on successful browse + replace", async () => {
    mockOpen.mockResolvedValue("/new-video.mp4");
    mockCopyMediaToAssets.mockResolvedValue("assets/new-video.mp4");

    const view = createMockView();
    const result = await browseAndReplaceMedia(view, 10, "block_video");

    expect(result).toBe(true);
    expect(view.dispatch).toHaveBeenCalled();
    expect(mockSetSrc).toHaveBeenCalledWith("assets/new-video.mp4");
  });

  it("returns false when user cancels dialog", async () => {
    mockOpen.mockResolvedValue(null);

    const view = createMockView();
    const result = await browseAndReplaceMedia(view, 10, "block_video");

    expect(result).toBe(false);
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("returns false when document is unsaved and shows warning", async () => {
    mockActiveTabId = { main: null };
    mockGetDocument = () => undefined;

    mockOpen.mockResolvedValue("/new-video.mp4");

    const view = createMockView();
    const result = await browseAndReplaceMedia(view, 10, "block_video");

    expect(result).toBe(false);
    expect(mockMessage).toHaveBeenCalledWith(
      expect.stringContaining("save the document"),
      expect.objectContaining({ kind: "warning" })
    );
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("updates node attributes via setNodeMarkup on success", async () => {
    mockOpen.mockResolvedValue("/new-video.mp4");
    mockCopyMediaToAssets.mockResolvedValue("assets/new-video.mp4");

    const view = createMockView();
    await browseAndReplaceMedia(view, 10, "block_video");

    expect(view.state.tr.setNodeMarkup).toHaveBeenCalledWith(
      10,
      null,
      expect.objectContaining({ src: "assets/new-video.mp4" })
    );
  });

  // --- Image browse tests ---

  it("opens dialog with image filters for image type", async () => {
    mockOpen.mockResolvedValue("/photo.png");
    mockCopyImageToAssets.mockResolvedValue("images/photo.png");

    storeState = { ...storeState, mediaNodeType: "image" as "block_video", mediaNodePos: 5 };
    const view = createMockView("image");
    await browseAndReplaceMedia(view, 5, "image");

    expect(mockOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [
          expect.objectContaining({
            name: "Images",
            extensions: expect.arrayContaining(["png", "jpg", "jpeg", "gif", "webp", "svg"]),
          }),
        ],
      })
    );
  });

  it("uses copyImageToAssets for image types", async () => {
    mockOpen.mockResolvedValue("/photo.png");
    mockCopyImageToAssets.mockResolvedValue("images/photo.png");

    storeState = { ...storeState, mediaNodeType: "image" as "block_video", mediaNodePos: 5 };
    const view = createMockView("image");
    const result = await browseAndReplaceMedia(view, 5, "image");

    expect(result).toBe(true);
    expect(mockCopyImageToAssets).toHaveBeenCalledWith("/photo.png", "/docs/my-doc.md");
    expect(mockCopyMediaToAssets).not.toHaveBeenCalled();
  });

  it("uses copyMediaToAssets for video types", async () => {
    mockOpen.mockResolvedValue("/clip.mp4");
    mockCopyMediaToAssets.mockResolvedValue("media/clip.mp4");

    const view = createMockView();
    await browseAndReplaceMedia(view, 10, "block_video");

    expect(mockCopyMediaToAssets).toHaveBeenCalledWith("/clip.mp4", "/docs/my-doc.md");
    expect(mockCopyImageToAssets).not.toHaveBeenCalled();
  });

  it("opens dialog with image filters for block_image type", async () => {
    mockOpen.mockResolvedValue("/photo.png");
    mockCopyImageToAssets.mockResolvedValue("images/photo.png");

    storeState = { ...storeState, mediaNodeType: "block_image" as "block_video", mediaNodePos: 5 };
    const view = createMockView("block_image");
    await browseAndReplaceMedia(view, 5, "block_image");

    expect(mockOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [expect.objectContaining({ name: "Images" })],
      })
    );
  });
});
