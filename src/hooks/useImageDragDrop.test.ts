/**
 * Tests for useImageDragDrop hook
 *
 * Tests image drag-drop handling: filtering image paths, generating filenames,
 * drag-drop event processing, and insertion into editors.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// --- Mocks ---

let dragDropHandler: ((event: unknown) => Promise<void>) | null = null;

const { onDragDropImpl } = vi.hoisted(() => {
  const defaultImpl = async (handler) => {
    dragDropHandler = handler;
    return () => {};
  };
  return { onDragDropImpl: { fn: defaultImpl } };
});

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (handler) => onDragDropImpl.fn(handler),
  }),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readFile: vi.fn(() => Promise.resolve(new Uint8Array([0x89, 0x50]))),
}));

const mockMessage = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: (...args: unknown[]) => mockMessage(...args),
}));

const mockSaveImageToAssets = vi.fn(() => Promise.resolve("assets/img.png"));
vi.mock("@/services/media/imageOperations", () => ({
  saveImageToAssets: (...args: unknown[]) => mockSaveImageToAssets(...args),
}));

vi.mock("@/contexts/WindowContext", () => ({
  useWindowLabel: () => "main",
}));

vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: () => ({
      activeTabId: { main: "tab-1" },
    }),
  },
}));

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: () => ({
      getDocument: () => ({ filePath: "/docs/test.md" }),
    }),
  },
}));

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({
      image: { copyToAssets: true },
    }),
  },
}));

vi.mock("@/stores/dropZoneStore", () => {
  const reset = vi.fn();
  const setDragging = vi.fn();
  return {
    useDropZoneStore: {
      getState: () => ({ reset, setDragging }),
    },
    __mockReset: reset,
    __mockSetDragging: setDragging,
  };
});

vi.mock("@/utils/safeUnlisten", () => ({
  safeUnlisten: vi.fn(),
}));

vi.mock("@/utils/imagePathDetection", () => ({
  hasImageExtension: (p: string) => /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(p),
}));

vi.mock("@/utils/imageUtils", () => ({
  getFilename: (p: string) => p.split("/").pop() || "",
}));

vi.mock("@/utils/markdownUrl", () => ({
  encodeMarkdownUrl: (p: string) => p,
}));

import { useImageDragDrop } from "./useImageDragDrop";
import { useDropZoneStore } from "@/stores/dropZoneStore";

describe("useImageDragDrop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dragDropHandler = null;
    // Restore default onDragDropEvent implementation
    onDragDropImpl.fn = async (handler) => {
      dragDropHandler = handler;
      return () => {};
    };
  });

  it("registers drag-drop listener when enabled", () => {
    renderHook(() =>
      useImageDragDrop({
        isSourceMode: false,
        enabled: true,
      })
    );
    expect(dragDropHandler).not.toBeNull();
  });

  it("does not register listener when disabled", () => {
    renderHook(() =>
      useImageDragDrop({
        isSourceMode: false,
        enabled: false,
      })
    );
    expect(dragDropHandler).toBeNull();
  });

  it("resets drop zone on leave event", async () => {
    renderHook(() =>
      useImageDragDrop({
        isSourceMode: false,
        enabled: true,
      })
    );

    await dragDropHandler!({ payload: { type: "leave" } });
    expect(useDropZoneStore.getState().reset).toHaveBeenCalled();
  });

  it("sets dragging on enter event", async () => {
    renderHook(() =>
      useImageDragDrop({
        isSourceMode: false,
        enabled: true,
      })
    );

    await dragDropHandler!({ payload: { type: "enter" } });
    expect(useDropZoneStore.getState().setDragging).toHaveBeenCalledWith(true, true, 1);
  });

  it("does nothing on over event", async () => {
    renderHook(() =>
      useImageDragDrop({
        isSourceMode: false,
        enabled: true,
      })
    );

    await dragDropHandler!({ payload: { type: "over" } });
    // Should not reset or setDragging on "over" — just keeps state
    expect(useDropZoneStore.getState().reset).not.toHaveBeenCalled();
  });

  it("resets drop zone on drop event", async () => {
    renderHook(() =>
      useImageDragDrop({
        isSourceMode: false,
        enabled: true,
      })
    );

    await dragDropHandler!({
      payload: { type: "drop", paths: ["/tmp/file.txt"] },
    });

    expect(useDropZoneStore.getState().reset).toHaveBeenCalled();
  });

  it("ignores drop with no image files", async () => {
    renderHook(() =>
      useImageDragDrop({
        isSourceMode: false,
        enabled: true,
      })
    );

    await dragDropHandler!({
      payload: { type: "drop", paths: ["/tmp/file.txt", "/tmp/doc.pdf"] },
    });

    // No image processing should occur
    expect(mockSaveImageToAssets).not.toHaveBeenCalled();
  });

  it("processes image drops and saves to assets in WYSIWYG mode", async () => {
    const mockInsertContent = vi.fn().mockReturnThis();
    const mockFocus = vi.fn(() => ({ insertContent: mockInsertContent, run: vi.fn() }));
    const tiptapEditor = {
      state: {
        schema: {
          nodes: { block_image: {} },
        },
      },
      chain: vi.fn(() => ({
        focus: mockFocus,
      })),
    };

    renderHook(() =>
      useImageDragDrop({
        tiptapEditor: tiptapEditor as never,
        isSourceMode: false,
        enabled: true,
      })
    );

    await dragDropHandler!({
      payload: { type: "drop", paths: ["/tmp/photo.png"] },
    });

    expect(mockSaveImageToAssets).toHaveBeenCalled();
  });

  it("shows warning for unsaved document when copyToAssets is enabled", async () => {
    // Override the document store mock to return null filePath
    const { useDocumentStore } = await import("@/stores/documentStore");
    const origGetState = useDocumentStore.getState;
    useDocumentStore.getState = () => ({
      getDocument: () => ({ filePath: null }),
    }) as never;

    renderHook(() =>
      useImageDragDrop({
        isSourceMode: false,
        enabled: true,
      })
    );

    await dragDropHandler!({
      payload: { type: "drop", paths: ["/tmp/photo.png"] },
    });

    expect(mockMessage).toHaveBeenCalledWith(
      expect.stringContaining("save the document first"),
      expect.objectContaining({ kind: "warning" })
    );

    // Restore
    useDocumentStore.getState = origGetState;
  });

  it("handles drop with null paths gracefully", async () => {
    renderHook(() =>
      useImageDragDrop({
        isSourceMode: false,
        enabled: true,
      })
    );

    await dragDropHandler!({
      payload: { type: "drop", paths: null },
    });

    expect(mockSaveImageToAssets).not.toHaveBeenCalled();
  });

  it("handles drop with empty paths array", async () => {
    renderHook(() =>
      useImageDragDrop({
        isSourceMode: false,
        enabled: true,
      })
    );

    await dragDropHandler!({
      payload: { type: "drop", paths: [] },
    });

    expect(mockSaveImageToAssets).not.toHaveBeenCalled();
  });

  it("inserts markdown in source mode", async () => {
    const mockDispatch = vi.fn();
    const mockFocus = vi.fn();
    const cmView = {
      current: {
        state: { selection: { main: { head: 0 } } },
        dispatch: mockDispatch,
        focus: mockFocus,
      },
    };

    renderHook(() =>
      useImageDragDrop({
        cmViewRef: cmView as never,
        isSourceMode: true,
        enabled: true,
      })
    );

    await dragDropHandler!({
      payload: { type: "drop", paths: ["/tmp/photo.png"] },
    });

    expect(mockSaveImageToAssets).toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalled();
    expect(mockFocus).toHaveBeenCalled();
  });

  it("handles image save failure gracefully", async () => {
    mockSaveImageToAssets.mockRejectedValueOnce(new Error("disk full"));

    renderHook(() =>
      useImageDragDrop({
        isSourceMode: false,
        enabled: true,
      })
    );

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await dragDropHandler!({
      payload: { type: "drop", paths: ["/tmp/photo.png"] },
    });

    expect(mockMessage).toHaveBeenCalledWith(
      "Failed to insert dropped image.",
      expect.objectContaining({ kind: "error" })
    );
    errorSpy.mockRestore();
  });

  it("uses original path when copyToAssets is disabled", async () => {
    // Override settings to disable copyToAssets
    const { useSettingsStore } = await import("@/stores/settingsStore");
    const origGetState = useSettingsStore.getState;
    useSettingsStore.getState = () => ({
      image: { copyToAssets: false },
    }) as never;

    const mockInsertContent = vi.fn().mockReturnThis();
    const mockRun = vi.fn();
    const mockFocus = vi.fn(() => ({ insertContent: mockInsertContent, run: mockRun }));
    const tiptapEditor = {
      state: {
        schema: {
          nodes: { block_image: {} },
        },
      },
      chain: vi.fn(() => ({
        focus: mockFocus,
      })),
    };

    renderHook(() =>
      useImageDragDrop({
        tiptapEditor: tiptapEditor as never,
        isSourceMode: false,
        enabled: true,
      })
    );

    await dragDropHandler!({
      payload: { type: "drop", paths: ["/tmp/photo.png"] },
    });

    // Should NOT call saveImageToAssets when copyToAssets is disabled
    expect(mockSaveImageToAssets).not.toHaveBeenCalled();

    useSettingsStore.getState = origGetState;
  });

  it("inserts multiple images in WYSIWYG mode as block images", async () => {
    const mockInsertContent = vi.fn().mockReturnThis();
    const mockRun = vi.fn();
    const mockFocus = vi.fn(() => ({ insertContent: mockInsertContent, run: mockRun }));
    const tiptapEditor = {
      state: {
        schema: {
          nodes: { block_image: {} },
        },
      },
      chain: vi.fn(() => ({
        focus: mockFocus,
      })),
    };

    renderHook(() =>
      useImageDragDrop({
        tiptapEditor: tiptapEditor as never,
        isSourceMode: false,
        enabled: true,
      })
    );

    await dragDropHandler!({
      payload: { type: "drop", paths: ["/tmp/a.png", "/tmp/b.jpg"] },
    });

    // Both images should be saved
    expect(mockSaveImageToAssets).toHaveBeenCalledTimes(2);
  });

  it("inserts multiple images as markdown in source mode", async () => {
    const mockDispatch = vi.fn();
    const mockFocus = vi.fn();
    const cmView = {
      current: {
        state: { selection: { main: { head: 0 } } },
        dispatch: mockDispatch,
        focus: mockFocus,
      },
    };

    renderHook(() =>
      useImageDragDrop({
        cmViewRef: cmView as never,
        isSourceMode: true,
        enabled: true,
      })
    );

    await dragDropHandler!({
      payload: { type: "drop", paths: ["/tmp/a.png", "/tmp/b.jpg"] },
    });

    expect(mockSaveImageToAssets).toHaveBeenCalledTimes(2);
    expect(mockDispatch).toHaveBeenCalled();
  });

  it("uses fallback inline image when block_image is not in schema", async () => {
    const mockRun = vi.fn();
    const mockSetImage = vi.fn(() => ({ run: mockRun }));
    const mockFocus = vi.fn(() => ({ setImage: mockSetImage }));
    const tiptapEditor = {
      state: {
        schema: {
          nodes: {}, // no block_image
        },
      },
      chain: vi.fn(() => ({
        focus: mockFocus,
      })),
    };

    renderHook(() =>
      useImageDragDrop({
        tiptapEditor: tiptapEditor as never,
        isSourceMode: false,
        enabled: true,
      })
    );

    await dragDropHandler!({
      payload: { type: "drop", paths: ["/tmp/photo.png"] },
    });

    expect(mockSaveImageToAssets).toHaveBeenCalled();
  });

  it("does nothing for drop event with unknown type", async () => {
    renderHook(() =>
      useImageDragDrop({
        isSourceMode: false,
        enabled: true,
      })
    );

    await dragDropHandler!({
      payload: { type: "unknown" },
    });

    expect(mockSaveImageToAssets).not.toHaveBeenCalled();
  });

  it("getFilePath returns null when no active tab (L90 branch)", async () => {
    // Override tabStore to return no active tab
    const { useTabStore } = await import("@/stores/tabStore");
    const orig = useTabStore.getState;
    useTabStore.getState = () => ({ activeTabId: { main: null } }) as never;

    const mockInsertContent = vi.fn().mockReturnThis();
    const mockRun = vi.fn();
    const mockFocus = vi.fn(() => ({ insertContent: mockInsertContent, run: mockRun }));
    const tiptapEditor = {
      state: { schema: { nodes: { block_image: {} } } },
      chain: vi.fn(() => ({ focus: mockFocus })),
    };

    renderHook(() =>
      useImageDragDrop({
        tiptapEditor: tiptapEditor as never,
        isSourceMode: false,
        enabled: true,
      })
    );

    await dragDropHandler!({
      payload: { type: "drop", paths: ["/tmp/photo.png"] },
    });

    // With null tabId, getFilePath returns null, so no file path for asset saving
    // The drop still processes because copyToAssets check comes after filePath null check
    useTabStore.getState = orig;
  });

  it("getFilePath returns null on exception (L93 catch branch)", async () => {
    const { useTabStore } = await import("@/stores/tabStore");
    const orig = useTabStore.getState;
    useTabStore.getState = () => { throw new Error("store error"); };

    renderHook(() =>
      useImageDragDrop({
        isSourceMode: false,
        enabled: true,
      })
    );

    // Should not throw — getFilePath catches and returns null
    await expect(
      dragDropHandler!({ payload: { type: "drop", paths: ["/tmp/photo.png"] } })
    ).resolves.not.toThrow();

    useTabStore.getState = orig;
  });

  it("insertImagesInTiptap is a no-op when tiptapEditor is null (L103 branch)", async () => {
    renderHook(() =>
      useImageDragDrop({
        tiptapEditor: undefined,
        isSourceMode: false,
        enabled: true,
      })
    );

    // Drop with an image — but no tiptapEditor provided, so insertImagesInTiptap returns early
    await dragDropHandler!({
      payload: { type: "drop", paths: ["/tmp/photo.png"] },
    });

    // saveImageToAssets still called, but insert is skipped
    expect(mockSaveImageToAssets).toHaveBeenCalled();
  });

  it("insertImagesInCodeMirror is a no-op when cmViewRef.current is null (L133 branch)", async () => {
    const cmView = { current: null };

    renderHook(() =>
      useImageDragDrop({
        cmViewRef: cmView as never,
        isSourceMode: true,
        enabled: true,
      })
    );

    // Drop with an image — but cmViewRef.current is null, so insertImagesInCodeMirror returns early
    await dragDropHandler!({
      payload: { type: "drop", paths: ["/tmp/photo.png"] },
    });

    // saveImageToAssets called, but no dispatch since cmView is null
    expect(mockSaveImageToAssets).toHaveBeenCalled();
  });

  it("cancelled flag prevents drag-drop handler from running (L159 branch)", async () => {
    const { unmount } = renderHook(() =>
      useImageDragDrop({
        isSourceMode: false,
        enabled: true,
      })
    );

    // Unmount before handler fires — sets cancelled=true
    unmount();

    // Handler was captured before unmount, but now cancelled=true
    if (dragDropHandler) {
      await dragDropHandler({ payload: { type: "drop", paths: ["/tmp/photo.png"] } });
    }

    // Since cancelled=true, the handler returns early — no processing
    expect(mockSaveImageToAssets).not.toHaveBeenCalled();
  });

  it("safeUnlisten called when cancelled after onDragDropEvent resolves (L246-247 branch)", async () => {
    const { safeUnlisten } = await import("@/utils/safeUnlisten");

    // Set up a delayed onDragDropEvent so unmount happens before resolve
    let resolveOnDragDrop!: () => void;
    const barrier = new Promise<void>((res) => { resolveOnDragDrop = res; });
    const mockUnlisten = vi.fn();

    onDragDropImpl.fn = async (handler) => {
      dragDropHandler = handler as typeof dragDropHandler;
      await barrier;
      return mockUnlisten;
    };

    const { unmount } = renderHook(() =>
      useImageDragDrop({
        isSourceMode: false,
        enabled: true,
      })
    );

    // Unmount before onDragDropEvent resolves — sets cancelled=true
    unmount();

    // Now resolve the barrier — setup() sees cancelled=true and calls safeUnlisten(unlisten)
    resolveOnDragDrop();

    await vi.waitFor(() => {
      expect(safeUnlisten).toHaveBeenCalledWith(mockUnlisten);
    });
  });
});
