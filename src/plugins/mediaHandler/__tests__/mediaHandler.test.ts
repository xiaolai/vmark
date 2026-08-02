/**
 * Tests for mediaHandler — media type detection, handleDrop, handlePaste, and extension structure.
 */

import { bindHostDocument } from "@/plugins/shared/hostDocument";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { hasVideoExtension, hasAudioExtension, getMediaType } from "@/utils/mediaPathDetection";
import { mediaHandlerError } from "@/utils/debug";
import { mediaHandlerExtension } from "../tiptap";
import type { EditorView } from "@tiptap/pm/view";

// Mock external dependencies
const mockCopyMediaToAssets = vi.fn(() => Promise.resolve("./assets/media.mp4"));
const mockSaveMediaToAssets = vi.fn(() => Promise.resolve("./assets/media.mp4"));
const mockInsertBlockVideoNode = vi.fn();
const mockInsertBlockAudioNode = vi.fn();

vi.mock("@/hooks/useMediaOperations", () => ({
  copyMediaToAssets: (...args: unknown[]) => mockCopyMediaToAssets(...args),
  saveMediaToAssets: (...args: unknown[]) => mockSaveMediaToAssets(...args),
  insertBlockVideoNode: (...args: unknown[]) => mockInsertBlockVideoNode(...args),
  insertBlockAudioNode: (...args: unknown[]) => mockInsertBlockAudioNode(...args),
}));

const mockMessage = vi.fn(() => Promise.resolve());
vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: (...args: unknown[]) => mockMessage(...args),
}));

vi.mock("@/utils/debug", () => ({
  mediaHandlerError: vi.fn(),
}));

vi.mock("@/services/navigation/windowFocus", () => ({
  getWindowLabel: vi.fn(() => "main"),
}));


// The document path arrives through the host seam now (ADR-015). Rebound
// before EVERY case, so a test that overrides it cannot leak into the next.
beforeEach(() => {
  bindHostDocument({ activeFilePath: () => "/test/doc.md" });
});

describe("mediaHandlerExtension", () => {
  it("has the correct name", () => {
    expect(mediaHandlerExtension.name).toBe("mediaHandler");
  });

  it("has lower priority than default (90)", () => {
    expect(mediaHandlerExtension.options).toBeDefined();
    // Priority is set at extension level
    expect(mediaHandlerExtension.config.priority).toBe(90);
  });

  it("is an Extension type", () => {
    expect(mediaHandlerExtension.type).toBe("extension");
  });

  it("defines ProseMirror plugins", () => {
    expect(mediaHandlerExtension.config.addProseMirrorPlugins).toBeDefined();
  });
});

describe("mediaHandler handleDrop behavior", () => {
  let mockView: EditorView;

  beforeEach(() => {
    mockView = {
      state: {
        doc: { nodeSize: 10 },
        selection: { from: 0, to: 0 },
      },
      dispatch: vi.fn(),
    } as unknown as EditorView;
  });

  it("returns false when no files are dropped", () => {
    // The handleDrop function checks for dataTransfer.files
    // We test via the plugin props indirectly
    const plugins = mediaHandlerExtension.config.addProseMirrorPlugins!.call({
      name: "mediaHandler",
      options: {},
      storage: {},
      parent: null as never,
      editor: {} as never,
      type: "extension" as never,
    });
    expect(plugins).toHaveLength(1);
    expect(plugins[0].props.handleDrop).toBeDefined();
    expect(plugins[0].props.handlePaste).toBeDefined();
  });

  it("handleDrop returns false for empty file list", () => {
    const plugins = mediaHandlerExtension.config.addProseMirrorPlugins!.call({
      name: "mediaHandler",
      options: {},
      storage: {},
      parent: null as never,
      editor: {} as never,
      type: "extension" as never,
    });
    const handleDrop = plugins[0].props.handleDrop!;
    const event = {
      dataTransfer: { files: [] },
    } as unknown as DragEvent;
    expect(handleDrop(mockView, event, null as never, false)).toBe(false);
  });

  it("handleDrop returns false for non-media files", () => {
    const plugins = mediaHandlerExtension.config.addProseMirrorPlugins!.call({
      name: "mediaHandler",
      options: {},
      storage: {},
      parent: null as never,
      editor: {} as never,
      type: "extension" as never,
    });
    const handleDrop = plugins[0].props.handleDrop!;
    const event = {
      dataTransfer: {
        files: [new File(["content"], "readme.txt", { type: "text/plain" })],
      },
      preventDefault: vi.fn(),
    } as unknown as DragEvent;
    expect(handleDrop(mockView, event, null as never, false)).toBe(false);
  });

  it("handleDrop returns true for video files", () => {
    const plugins = mediaHandlerExtension.config.addProseMirrorPlugins!.call({
      name: "mediaHandler",
      options: {},
      storage: {},
      parent: null as never,
      editor: {} as never,
      type: "extension" as never,
    });
    const handleDrop = plugins[0].props.handleDrop!;
    const event = {
      dataTransfer: {
        files: [new File(["video"], "clip.mp4", { type: "video/mp4" })],
      },
      preventDefault: vi.fn(),
    } as unknown as DragEvent;
    expect(handleDrop(mockView, event, null as never, false)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("handleDrop returns true for audio files", () => {
    const plugins = mediaHandlerExtension.config.addProseMirrorPlugins!.call({
      name: "mediaHandler",
      options: {},
      storage: {},
      parent: null as never,
      editor: {} as never,
      type: "extension" as never,
    });
    const handleDrop = plugins[0].props.handleDrop!;
    const event = {
      dataTransfer: {
        files: [new File(["audio"], "song.mp3", { type: "audio/mpeg" })],
      },
      preventDefault: vi.fn(),
    } as unknown as DragEvent;
    expect(handleDrop(mockView, event, null as never, false)).toBe(true);
  });

  it("handleDrop returns false when no dataTransfer", () => {
    const plugins = mediaHandlerExtension.config.addProseMirrorPlugins!.call({
      name: "mediaHandler",
      options: {},
      storage: {},
      parent: null as never,
      editor: {} as never,
      type: "extension" as never,
    });
    const handleDrop = plugins[0].props.handleDrop!;
    const event = {} as unknown as DragEvent;
    expect(handleDrop(mockView, event, null as never, false)).toBe(false);
  });
});

describe("mediaHandler handlePaste behavior", () => {
  let mockView: EditorView;

  beforeEach(() => {
    mockView = {
      state: {
        doc: { nodeSize: 10 },
        selection: { from: 0, to: 0 },
      },
      dispatch: vi.fn(),
    } as unknown as EditorView;
  });

  it("returns false for non-media text", () => {
    const plugins = mediaHandlerExtension.config.addProseMirrorPlugins!.call({
      name: "mediaHandler",
      options: {},
      storage: {},
      parent: null as never,
      editor: {} as never,
      type: "extension" as never,
    });
    const handlePaste = plugins[0].props.handlePaste!;
    const event = {
      clipboardData: {
        getData: vi.fn((type: string) => (type === "text/plain" ? "just some text" : "")),
      },
    } as unknown as ClipboardEvent;
    expect(handlePaste(mockView, event, null as never)).toBe(false);
  });

  it("returns false when no text in clipboard", () => {
    const plugins = mediaHandlerExtension.config.addProseMirrorPlugins!.call({
      name: "mediaHandler",
      options: {},
      storage: {},
      parent: null as never,
      editor: {} as never,
      type: "extension" as never,
    });
    const handlePaste = plugins[0].props.handlePaste!;
    const event = {
      clipboardData: {
        getData: vi.fn(() => ""),
      },
    } as unknown as ClipboardEvent;
    expect(handlePaste(mockView, event, null as never)).toBe(false);
  });

  it("returns true for video file path", () => {
    const plugins = mediaHandlerExtension.config.addProseMirrorPlugins!.call({
      name: "mediaHandler",
      options: {},
      storage: {},
      parent: null as never,
      editor: {} as never,
      type: "extension" as never,
    });
    const handlePaste = plugins[0].props.handlePaste!;
    const event = {
      clipboardData: {
        getData: vi.fn((type: string) => (type === "text/plain" ? "/path/to/video.mp4" : "")),
      },
      preventDefault: vi.fn(),
    } as unknown as ClipboardEvent;
    expect(handlePaste(mockView, event, null as never)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("returns true for audio file path", () => {
    const plugins = mediaHandlerExtension.config.addProseMirrorPlugins!.call({
      name: "mediaHandler",
      options: {},
      storage: {},
      parent: null as never,
      editor: {} as never,
      type: "extension" as never,
    });
    const handlePaste = plugins[0].props.handlePaste!;
    const event = {
      clipboardData: {
        getData: vi.fn((type: string) => (type === "text/plain" ? "/path/to/audio.mp3" : "")),
      },
      preventDefault: vi.fn(),
    } as unknown as ClipboardEvent;
    expect(handlePaste(mockView, event, null as never)).toBe(true);
  });

  it("returns false for multiline text even with media extension", () => {
    const plugins = mediaHandlerExtension.config.addProseMirrorPlugins!.call({
      name: "mediaHandler",
      options: {},
      storage: {},
      parent: null as never,
      editor: {} as never,
      type: "extension" as never,
    });
    const handlePaste = plugins[0].props.handlePaste!;
    const event = {
      clipboardData: {
        getData: vi.fn((type: string) =>
          type === "text/plain" ? "line1.mp4\nline2.mp4" : ""
        ),
      },
    } as unknown as ClipboardEvent;
    expect(handlePaste(mockView, event, null as never)).toBe(false);
  });

  it("handles external URL for video", () => {
    const plugins = mediaHandlerExtension.config.addProseMirrorPlugins!.call({
      name: "mediaHandler",
      options: {},
      storage: {},
      parent: null as never,
      editor: {} as never,
      type: "extension" as never,
    });
    const handlePaste = plugins[0].props.handlePaste!;
    const event = {
      clipboardData: {
        getData: vi.fn((type: string) =>
          type === "text/plain" ? "https://example.com/video.mp4" : ""
        ),
      },
      preventDefault: vi.fn(),
    } as unknown as ClipboardEvent;
    expect(handlePaste(mockView, event, null as never)).toBe(true);
  });

  it("returns false when no clipboardData", () => {
    const plugins = mediaHandlerExtension.config.addProseMirrorPlugins!.call({
      name: "mediaHandler",
      options: {},
      storage: {},
      parent: null as never,
      editor: {} as never,
      type: "extension" as never,
    });
    const handlePaste = plugins[0].props.handlePaste!;
    const event = {} as unknown as ClipboardEvent;
    expect(handlePaste(mockView, event, null as never)).toBe(false);
  });

  it("returns false for whitespace-only text", () => {
    const plugins = mediaHandlerExtension.config.addProseMirrorPlugins!.call({
      name: "mediaHandler",
      options: {},
      storage: {},
      parent: null as never,
      editor: {} as never,
      type: "extension" as never,
    });
    const handlePaste = plugins[0].props.handlePaste!;
    const event = {
      clipboardData: {
        getData: vi.fn((type: string) => (type === "text/plain" ? "   \t  " : "")),
      },
    } as unknown as ClipboardEvent;
    expect(handlePaste(mockView, event, null as never)).toBe(false);
  });

  it("handles Windows-style local path for video", () => {
    const plugins = mediaHandlerExtension.config.addProseMirrorPlugins!.call({
      name: "mediaHandler",
      options: {},
      storage: {},
      parent: null as never,
      editor: {} as never,
      type: "extension" as never,
    });
    const handlePaste = plugins[0].props.handlePaste!;
    const event = {
      clipboardData: {
        getData: vi.fn((type: string) =>
          type === "text/plain" ? "C:\\Users\\video.mp4" : ""
        ),
      },
      preventDefault: vi.fn(),
    } as unknown as ClipboardEvent;
    expect(handlePaste(mockView, event, null as never)).toBe(true);
  });

  it("handles relative path for audio", () => {
    const plugins = mediaHandlerExtension.config.addProseMirrorPlugins!.call({
      name: "mediaHandler",
      options: {},
      storage: {},
      parent: null as never,
      editor: {} as never,
      type: "extension" as never,
    });
    const handlePaste = plugins[0].props.handlePaste!;
    const event = {
      clipboardData: {
        getData: vi.fn((type: string) =>
          type === "text/plain" ? "./assets/song.mp3" : ""
        ),
      },
      preventDefault: vi.fn(),
    } as unknown as ClipboardEvent;
    expect(handlePaste(mockView, event, null as never)).toBe(true);
  });
});

describe("mediaHandler paste — no document path", () => {
  let mockView: EditorView;

  beforeEach(() => {
    mockView = {
      state: {
        doc: { nodeSize: 10 },
        selection: { from: 0, to: 0 },
      },
      dispatch: vi.fn(),
    } as unknown as EditorView;
  });

  it("returns false when document has no filePath and path is pasted", async () => {
    bindHostDocument({ activeFilePath: () => null });
    // Override documentStore mock to return no filePath

    const plugins = mediaHandlerExtension.config.addProseMirrorPlugins!.call({
      name: "mediaHandler",
      options: {},
      storage: {},
      parent: null as never,
      editor: {} as never,
      type: "extension" as never,
    });
    const handlePaste = plugins[0].props.handlePaste!;
    const event = {
      clipboardData: {
        getData: vi.fn((type: string) =>
          type === "text/plain" ? "/path/to/video.mp4" : ""
        ),
      },
      preventDefault: vi.fn(),
    } as unknown as ClipboardEvent;

    // With no document path, paste should return false
    const result = handlePaste(mockView, event, null as never);
    expect(result).toBe(false);
  });
});

describe("mediaHandler drop — mixed files", () => {
  let mockView: EditorView;

  beforeEach(() => {
    mockView = {
      state: {
        doc: { nodeSize: 10 },
        selection: { from: 0, to: 0 },
      },
      dispatch: vi.fn(),
    } as unknown as EditorView;
  });

  it("handles drop with both media and non-media files", () => {
    const plugins = mediaHandlerExtension.config.addProseMirrorPlugins!.call({
      name: "mediaHandler",
      options: {},
      storage: {},
      parent: null as never,
      editor: {} as never,
      type: "extension" as never,
    });
    const handleDrop = plugins[0].props.handleDrop!;
    const event = {
      dataTransfer: {
        files: [
          new File(["text"], "readme.txt", { type: "text/plain" }),
          new File(["video"], "clip.mp4", { type: "video/mp4" }),
        ],
      },
      preventDefault: vi.fn(),
    } as unknown as DragEvent;

    // Should return true because at least one media file is present
    expect(handleDrop(mockView, event, null as never, false)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("handleDrop detects media by extension fallback", () => {
    const plugins = mediaHandlerExtension.config.addProseMirrorPlugins!.call({
      name: "mediaHandler",
      options: {},
      storage: {},
      parent: null as never,
      editor: {} as never,
      type: "extension" as never,
    });
    const handleDrop = plugins[0].props.handleDrop!;
    // File with empty MIME type but video extension
    const event = {
      dataTransfer: {
        files: [new File(["video"], "clip.mkv", { type: "" })],
      },
      preventDefault: vi.fn(),
    } as unknown as DragEvent;
    expect(handleDrop(mockView, event, null as never, false)).toBe(true);
  });

  it("handlePaste handles external audio URL", () => {
    const plugins = mediaHandlerExtension.config.addProseMirrorPlugins!.call({
      name: "mediaHandler",
      options: {},
      storage: {},
      parent: null as never,
      editor: {} as never,
      type: "extension" as never,
    });
    const handlePaste = plugins[0].props.handlePaste!;
    const event = {
      clipboardData: {
        getData: vi.fn((type: string) =>
          type === "text/plain" ? "https://example.com/song.mp3" : ""
        ),
      },
      preventDefault: vi.fn(),
    } as unknown as ClipboardEvent;
    expect(handlePaste(mockView, event, null as never)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
  });
});

function getPlugins() {
  return mediaHandlerExtension.config.addProseMirrorPlugins!.call({
    name: "mediaHandler",
    options: {},
    storage: {},
    parent: null as never,
    editor: {} as never,
    type: "extension" as never,
  });
}

describe("handleDroppedMediaFile async flow", () => {
  let mockView: EditorView;

  beforeEach(() => {
    vi.clearAllMocks();
    mockView = {
      state: {
        doc: { nodeSize: 10 },
        selection: { from: 0, to: 0 },
      },
      dispatch: vi.fn(),
    } as unknown as EditorView;
  });

  it("saves dropped video file and inserts video node", async () => {
    const file = new File(["video-data"], "clip.mp4", { type: "video/mp4" });
    (file as unknown as Record<string, unknown>).arrayBuffer = vi.fn(() =>
      Promise.resolve(new ArrayBuffer(8))
    );

    const plugins = getPlugins();
    const handleDrop = plugins[0].props.handleDrop!;
    const event = {
      dataTransfer: { files: [file] },
      preventDefault: vi.fn(),
    } as unknown as DragEvent;

    handleDrop(mockView, event, null as never, false);

    await vi.waitFor(() => {
      expect(mockSaveMediaToAssets).toHaveBeenCalled();
    }, { timeout: 200 });

    expect(mockInsertBlockVideoNode).toHaveBeenCalledWith(mockView, "./assets/media.mp4");
  });

  it("saves dropped audio file and inserts audio node", async () => {
    const file = new File(["audio-data"], "song.mp3", { type: "audio/mpeg" });
    (file as unknown as Record<string, unknown>).arrayBuffer = vi.fn(() =>
      Promise.resolve(new ArrayBuffer(8))
    );

    const plugins = getPlugins();
    const handleDrop = plugins[0].props.handleDrop!;
    const event = {
      dataTransfer: { files: [file] },
      preventDefault: vi.fn(),
    } as unknown as DragEvent;

    handleDrop(mockView, event, null as never, false);

    await vi.waitFor(() => {
      expect(mockSaveMediaToAssets).toHaveBeenCalled();
    }, { timeout: 200 });

    expect(mockInsertBlockAudioNode).toHaveBeenCalledWith(mockView, "./assets/media.mp4");
  });

  it("shows warning when file is too large", async () => {
    const file = new File(["x"], "big.mp4", { type: "video/mp4" });
    // Override size to exceed MAX_DROP_FILE_SIZE (500 MB)
    Object.defineProperty(file, "size", { value: 600 * 1024 * 1024 });
    (file as unknown as Record<string, unknown>).arrayBuffer = vi.fn(() =>
      Promise.resolve(new ArrayBuffer(8))
    );

    const plugins = getPlugins();
    const handleDrop = plugins[0].props.handleDrop!;
    const event = {
      dataTransfer: { files: [file] },
      preventDefault: vi.fn(),
    } as unknown as DragEvent;

    handleDrop(mockView, event, null as never, false);

    await vi.waitFor(() => {
      expect(mockMessage).toHaveBeenCalledWith(
        expect.stringContaining("too large"),
        expect.objectContaining({ kind: "warning" })
      );
    }, { timeout: 200 });

    expect(mockSaveMediaToAssets).not.toHaveBeenCalled();
  });

  it("shows save required message when no document path", async () => {
    bindHostDocument({ activeFilePath: () => null });
    // Override to return no filePath

    const file = new File(["v"], "clip.mp4", { type: "video/mp4" });
    (file as unknown as Record<string, unknown>).arrayBuffer = vi.fn(() =>
      Promise.resolve(new ArrayBuffer(4))
    );

    const plugins = getPlugins();
    const handleDrop = plugins[0].props.handleDrop!;
    const event = {
      dataTransfer: { files: [file] },
      preventDefault: vi.fn(),
    } as unknown as DragEvent;

    handleDrop(mockView, event, null as never, false);

    await vi.waitFor(() => {
      expect(mockMessage).toHaveBeenCalledWith(
        expect.stringContaining("save the document"),
        expect.objectContaining({ kind: "info" })
      );
    }, { timeout: 200 });
  });

  it("catches error from saveMediaToAssets and shows error dialog", async () => {
    mockSaveMediaToAssets.mockRejectedValueOnce(new Error("disk full"));

    const file = new File(["v"], "clip.mp4", { type: "video/mp4" });
    (file as unknown as Record<string, unknown>).arrayBuffer = vi.fn(() =>
      Promise.resolve(new ArrayBuffer(4))
    );

    const plugins = getPlugins();
    const handleDrop = plugins[0].props.handleDrop!;
    const event = {
      dataTransfer: { files: [file] },
      preventDefault: vi.fn(),
    } as unknown as DragEvent;

    
    handleDrop(mockView, event, null as never, false);

    await vi.waitFor(() => {
      expect(mockMessage).toHaveBeenCalledWith(
        expect.stringContaining("disk full"),
        expect.objectContaining({ kind: "error" })
      );
    }, { timeout: 200 });

  });

  it("handles getDocumentPath error (catch branch)", async () => {
    // Make getWindowLabel throw to trigger the catch in getDocumentPath
    const { getWindowLabel } = await import("@/services/navigation/windowFocus");
    (getWindowLabel as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("no window");
    });

    const file = new File(["v"], "clip.mp4", { type: "video/mp4" });
    (file as unknown as Record<string, unknown>).arrayBuffer = vi.fn(() =>
      Promise.resolve(new ArrayBuffer(4))
    );

    const plugins = getPlugins();
    const handleDrop = plugins[0].props.handleDrop!;
    const event = {
      dataTransfer: { files: [file] },
      preventDefault: vi.fn(),
    } as unknown as DragEvent;

    handleDrop(mockView, event, null as never, false);

    await vi.waitFor(() => {
      expect(mockMessage).toHaveBeenCalledWith(
        expect.stringContaining("save the document"),
        expect.objectContaining({ kind: "info" })
      );
    }, { timeout: 200 });
  });
});

describe("handlePaste copyMediaToAssets catch fallback", () => {
  let mockView: EditorView;

  beforeEach(() => {
    vi.clearAllMocks();
    mockView = {
      state: {
        doc: { nodeSize: 10 },
        selection: { from: 0, to: 0 },
      },
      dispatch: vi.fn(),
    } as unknown as EditorView;
  });

  it("falls back to original video path when copyMediaToAssets rejects", async () => {
    mockCopyMediaToAssets.mockRejectedValueOnce(new Error("copy failed"));

    const plugins = getPlugins();
    const handlePaste = plugins[0].props.handlePaste!;
    const event = {
      clipboardData: {
        getData: vi.fn((type: string) =>
          type === "text/plain" ? "/path/to/video.mp4" : ""
        ),
      },
      preventDefault: vi.fn(),
    } as unknown as ClipboardEvent;

    
    const result = handlePaste(mockView, event, null as never);
    expect(result).toBe(true);

    await vi.waitFor(() => {
      expect(mediaHandlerError).toHaveBeenCalledWith(
        "Failed to copy media from pasted path:",
        expect.any(Error)
      );
    }, { timeout: 200 });

    expect(mockInsertBlockVideoNode).toHaveBeenCalledWith(mockView, "/path/to/video.mp4");
  });

  it("falls back to original audio path when copyMediaToAssets rejects", async () => {
    mockCopyMediaToAssets.mockRejectedValueOnce(new Error("copy failed"));

    const plugins = getPlugins();
    const handlePaste = plugins[0].props.handlePaste!;
    const event = {
      clipboardData: {
        getData: vi.fn((type: string) =>
          type === "text/plain" ? "/path/to/song.mp3" : ""
        ),
      },
      preventDefault: vi.fn(),
    } as unknown as ClipboardEvent;

    
    handlePaste(mockView, event, null as never);

    await vi.waitFor(() => {
      expect(mockInsertBlockAudioNode).toHaveBeenCalledWith(mockView, "/path/to/song.mp3");
    }, { timeout: 200 });

  });

  it("inserts via copyMediaToAssets success path for local audio", async () => {
    mockCopyMediaToAssets.mockResolvedValueOnce("./assets/copied-song.mp3");

    const plugins = getPlugins();
    const handlePaste = plugins[0].props.handlePaste!;
    const event = {
      clipboardData: {
        getData: vi.fn((type: string) =>
          type === "text/plain" ? "/path/to/song.mp3" : ""
        ),
      },
      preventDefault: vi.fn(),
    } as unknown as ClipboardEvent;

    handlePaste(mockView, event, null as never);

    await vi.waitFor(() => {
      expect(mockInsertBlockAudioNode).toHaveBeenCalledWith(mockView, "./assets/copied-song.mp3");
    }, { timeout: 200 });
  });
});

describe("mediaHandler — getDocumentPath no tabId branch (line 47)", () => {
  let mockView: EditorView;

  beforeEach(() => {
    vi.clearAllMocks();
    mockView = {
      state: { doc: { nodeSize: 10 }, selection: { from: 0, to: 0 } },
      dispatch: vi.fn(),
    } as unknown as EditorView;
  });

  it("returns false for paste when activeTabId has no entry for window label (tabId is undefined)", async () => {
    bindHostDocument({ activeFilePath: () => null });

    const plugins = getPlugins();
    const handlePaste = plugins[0].props.handlePaste!;
    const event = {
      clipboardData: {
        getData: vi.fn((type: string) => (type === "text/plain" ? "/path/to/video.mp4" : "")),
      },
      preventDefault: vi.fn(),
    } as unknown as ClipboardEvent;

    const result = handlePaste(mockView, event, null as never);
    expect(result).toBe(false);
  });
});

describe("mediaHandler — getMediaType extension fallback (line 58)", () => {
  let mockView: EditorView;

  beforeEach(() => {
    vi.clearAllMocks();
    mockView = {
      state: { doc: { nodeSize: 10 }, selection: { from: 0, to: 0 } },
      dispatch: vi.fn(),
    } as unknown as EditorView;
  });

  it("uses video extension fallback when MIME type is empty (e.g. .mkv file)", async () => {
    // File with no MIME type but video extension — isMediaFile uses extension fallback,
    // and getMediaType must also fall through to line 58: hasVideoExtension(file.name)
    const file = new File(["video"], "clip.mkv", { type: "" });
    (file as unknown as Record<string, unknown>).arrayBuffer = vi.fn(() =>
      Promise.resolve(new ArrayBuffer(8))
    );

    const plugins = getPlugins();
    const handleDrop = plugins[0].props.handleDrop!;
    const event = {
      dataTransfer: { files: [file] },
      preventDefault: vi.fn(),
    } as unknown as DragEvent;

    handleDrop(mockView, event, null as never, false);

    await vi.waitFor(() => {
      expect(mockInsertBlockVideoNode).toHaveBeenCalledWith(mockView, "./assets/media.mp4");
    }, { timeout: 200 });
  });
});

describe("mediaHandler — handleDroppedMediaFile non-Error catch branch (line 95)", () => {
  let mockView: EditorView;

  beforeEach(() => {
    vi.clearAllMocks();
    mockView = {
      state: { doc: { nodeSize: 10 }, selection: { from: 0, to: 0 } },
      dispatch: vi.fn(),
    } as unknown as EditorView;
  });

  it("handles non-Error thrown from saveMediaToAssets via String(error) (line 95)", async () => {
    // Throw a non-Error object (string) to exercise the String(error) branch
    mockSaveMediaToAssets.mockRejectedValueOnce("disk quota exceeded");

    const file = new File(["v"], "clip.mp4", { type: "video/mp4" });
    (file as unknown as Record<string, unknown>).arrayBuffer = vi.fn(() =>
      Promise.resolve(new ArrayBuffer(4))
    );

    const plugins = getPlugins();
    const handleDrop = plugins[0].props.handleDrop!;
    const event = {
      dataTransfer: { files: [file] },
      preventDefault: vi.fn(),
    } as unknown as DragEvent;

    
    handleDrop(mockView, event, null as never, false);

    await vi.waitFor(() => {
      expect(mockMessage).toHaveBeenCalledWith(
        expect.stringContaining("disk quota exceeded"),
        expect.objectContaining({ kind: "error" })
      );
    }, { timeout: 200 });

  });
});

describe("media type detection via mediaPathDetection", () => {
  describe("hasVideoExtension", () => {
    it.each([
      ["video.mp4", true],
      ["video.webm", true],
      ["video.mov", true],
      ["video.avi", true],
      ["video.mkv", true],
      ["video.m4v", true],
      ["video.ogv", true],
      ["video.MP4", true],
      ["audio.mp3", false],
      ["image.png", false],
      ["file.txt", false],
      ["", false],
    ])("hasVideoExtension(%s) => %s", (path, expected) => {
      expect(hasVideoExtension(path)).toBe(expected);
    });

    it("handles paths with query params", () => {
      expect(hasVideoExtension("video.mp4?t=123")).toBe(true);
    });

    it("handles paths with hash", () => {
      expect(hasVideoExtension("video.webm#section")).toBe(true);
    });

    it("handles full URLs", () => {
      expect(hasVideoExtension("https://example.com/video.mp4")).toBe(true);
    });
  });

  describe("hasAudioExtension", () => {
    it.each([
      ["audio.mp3", true],
      ["audio.m4a", true],
      ["audio.ogg", true],
      ["audio.wav", true],
      ["audio.flac", true],
      ["audio.aac", true],
      ["audio.opus", true],
      ["audio.MP3", true],
      ["video.mp4", false],
      ["image.png", false],
      ["", false],
    ])("hasAudioExtension(%s) => %s", (path, expected) => {
      expect(hasAudioExtension(path)).toBe(expected);
    });
  });

  describe("getMediaType", () => {
    it.each([
      ["video.mp4", "video"],
      ["audio.mp3", "audio"],
      ["image.png", "image"],
      ["image.jpg", "image"],
      ["image.svg", "image"],
      ["file.txt", null],
      ["", null],
      ["noext", null],
    ])("getMediaType(%s) => %s", (path, expected) => {
      expect(getMediaType(path)).toBe(expected);
    });

    it("handles edge case of dot-only filename", () => {
      expect(getMediaType("file.")).toBeNull();
    });

    it("handles hidden files", () => {
      expect(getMediaType(".gitignore")).toBeNull();
    });
  });
});
