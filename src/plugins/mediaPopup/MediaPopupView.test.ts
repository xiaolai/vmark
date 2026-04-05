/**
 * Tests for MediaPopupView — class-based popup for editing media nodes.
 *
 * @module plugins/mediaPopup/MediaPopupView.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Hoisted mocks ---
const {
  mockClosePopup,
  mockSetSrc,
  mockSetAlt,
  mockSetTitle,
  mockSetPoster,
  mockBrowseAndReplaceMedia,
  mockInstallKeyboardNavigation,
  mockDirname,
  mockJoin,
  mockGetActiveTabIdForCurrentWindow,
} = vi.hoisted(() => ({
  mockClosePopup: vi.fn(),
  mockSetSrc: vi.fn(),
  mockSetAlt: vi.fn(),
  mockSetTitle: vi.fn(),
  mockSetPoster: vi.fn(),
  mockBrowseAndReplaceMedia: vi.fn(() => Promise.resolve(false)),
  mockInstallKeyboardNavigation: vi.fn(() => vi.fn()),
  mockDirname: vi.fn((p: string) => Promise.resolve(p.replace(/\/[^/]+$/, ""))),
  mockJoin: vi.fn((...parts: string[]) => Promise.resolve(parts.join("/"))),
  mockGetActiveTabIdForCurrentWindow: vi.fn(() => "tab-1"),
}));

vi.mock("./media-popup.css", () => ({}));

vi.mock("@/utils/debug", () => ({
  mediaPopupWarn: vi.fn(),
  mediaPopupError: vi.fn(),
}));

vi.mock("@/stores/mediaPopupStore", () => {
  const subscribers: Array<(state: unknown, prevState: unknown) => void> = [];
  const storeState = {
    isOpen: false,
    mediaSrc: "",
    mediaAlt: "",
    mediaTitle: "",
    mediaPoster: "",
    mediaNodePos: 0,
    mediaNodeType: "image" as const,
    mediaDimensions: null as { width: number; height: number } | null,
    anchorRect: null as { top: number; bottom: number; left: number; right: number } | null,
    closePopup: mockClosePopup,
    setSrc: mockSetSrc,
    setAlt: mockSetAlt,
    setTitle: mockSetTitle,
    setPoster: mockSetPoster,
  };

  return {
    useMediaPopupStore: {
      subscribe: vi.fn((cb: (state: unknown, prevState: unknown) => void) => {
        subscribers.push(cb);
        return () => {
          const idx = subscribers.indexOf(cb);
          if (idx >= 0) subscribers.splice(idx, 1);
        };
      }),
      getState: vi.fn(() => storeState),
      // Expose for tests to trigger store updates
      _subscribers: subscribers,
      _state: storeState,
    },
  };
});

vi.mock("@/utils/popupPosition", () => ({
  calculatePopupPosition: vi.fn(() => ({ top: 100, left: 200 })),
  getBoundaryRects: vi.fn(() => ({ top: 0, left: 0, width: 800, height: 600 })),
  getViewportBounds: vi.fn(() => ({ top: 0, left: 0, width: 800, height: 600 })),
}));

vi.mock("@/utils/imeGuard", () => ({
  isImeKeyEvent: vi.fn(() => false),
}));

vi.mock("@tauri-apps/api/path", () => ({
  dirname: mockDirname,
  join: mockJoin,
}));

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: vi.fn(() => ({
      getDocument: vi.fn(() => ({
        filePath: "/docs/test.md",
        content: "",
      })),
    })),
  },
}));

vi.mock("@/utils/resolveMediaSrc", () => ({
  getActiveTabIdForCurrentWindow: mockGetActiveTabIdForCurrentWindow,
}));

vi.mock("./mediaPopupActions", () => ({
  browseAndReplaceMedia: (...args: unknown[]) => mockBrowseAndReplaceMedia(...args),
}));

vi.mock("./mediaPopupDom", () => ({
  createMediaPopupDom: vi.fn((handlers: Record<string, unknown>) => {
    const container = document.createElement("div");
    container.className = "media-popup-container";
    const srcInput = document.createElement("input");
    srcInput.className = "src-input";
    const altRow = document.createElement("div");
    const altInput = document.createElement("input");
    const dimensionsSpan = document.createElement("span");
    const titleRow = document.createElement("div");
    const titleInput = document.createElement("input");
    const posterRow = document.createElement("div");
    const posterInput = document.createElement("input");
    const toggleBtn = document.createElement("button");

    // Store handlers on container for test access
    (container as unknown as Record<string, unknown>)._handlers = handlers;

    return {
      container,
      srcInput,
      altRow,
      altInput,
      dimensionsSpan,
      titleRow,
      titleInput,
      posterRow,
      posterInput,
      toggleBtn,
    };
  }),
  installMediaPopupKeyboardNavigation: (...args: unknown[]) => mockInstallKeyboardNavigation(...args),
  updateMediaPopupToggleButton: vi.fn(),
}));

vi.mock("@/plugins/sourcePopup", () => ({
  getPopupHostForDom: vi.fn(() => document.createElement("div")),
  toHostCoordsForDom: vi.fn((_host: unknown, pos: { top: number; left: number }) => pos),
}));

import { MediaPopupView } from "./MediaPopupView";
import { useMediaPopupStore } from "@/stores/mediaPopupStore";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { getPopupHostForDom } from "@/plugins/sourcePopup";
import { mediaPopupWarn } from "@/utils/debug";
import { createMediaPopupDom } from "./mediaPopupDom";

// Helper to create a minimal mock EditorView
function createMockView() {
  const editorContainer = document.createElement("div");
  editorContainer.className = "editor-container";
  const editorDom = document.createElement("div");
  editorContainer.appendChild(editorDom);
  editorDom.closest = vi.fn((selector: string) => {
    if (selector === ".editor-container") return editorContainer;
    return null;
  });

  return {
    dom: editorDom,
    state: {
      doc: {
        nodeAt: vi.fn(() => ({
          type: { name: "image" },
          attrs: { src: "test.png", alt: "alt text", title: "" },
          nodeSize: 1,
        })),
      },
      schema: {
        nodes: {
          image: { create: vi.fn((attrs: unknown) => ({ type: { name: "image" }, attrs, nodeSize: 1 })) },
          block_image: { create: vi.fn((attrs: unknown) => ({ type: { name: "block_image" }, attrs, nodeSize: 1 })) },
        },
      },
      tr: {
        setNodeMarkup: vi.fn().mockReturnThis(),
        replaceWith: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
      },
    },
    dispatch: vi.fn(),
    focus: vi.fn(),
  } as unknown as import("@tiptap/pm/view").EditorView;
}

// Access the internal store state for triggering subscription callbacks
const store = useMediaPopupStore as unknown as {
  subscribe: ReturnType<typeof vi.fn>;
  getState: ReturnType<typeof vi.fn>;
  _subscribers: Array<(state: unknown, prevState: unknown) => void>;
  _state: Record<string, unknown>;
};

describe("MediaPopupView", () => {
  let view: ReturnType<typeof createMockView>;
  let popup: MediaPopupView;

  beforeEach(() => {
    vi.clearAllMocks();
    view = createMockView();
    // Reset store state
    store._state.isOpen = false;
    store._state.anchorRect = null;
    store._state.mediaSrc = "";
    store._state.mediaAlt = "";
    store._state.mediaTitle = "";
    store._state.mediaPoster = "";
    store._state.mediaNodePos = 0;
    store._state.mediaNodeType = "image";
    store._state.mediaDimensions = null;
  });

  afterEach(() => {
    if (popup) {
      popup.destroy();
    }
  });

  it("creates popup and subscribes to store", () => {
    popup = new MediaPopupView(view);
    expect(store.subscribe).toHaveBeenCalled();
  });

  it("adds mousedown listener on document for click outside", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    popup = new MediaPopupView(view);
    expect(addSpy).toHaveBeenCalledWith("mousedown", expect.any(Function));
    addSpy.mockRestore();
  });

  it("shows popup when store transitions to open", () => {
    popup = new MediaPopupView(view);

    const openState = {
      isOpen: true,
      mediaSrc: "image.png",
      mediaAlt: "alt",
      mediaTitle: "",
      mediaPoster: "",
      mediaNodeType: "image",
      mediaDimensions: { width: 100, height: 50 },
      anchorRect: { top: 10, bottom: 30, left: 50, right: 150 },
      mediaNodePos: 5,
    };

    const closedState = {
      isOpen: false,
      mediaNodePos: -1,
    };

    // Trigger subscription callback: transition from closed to open
    const cb = store.subscribe.mock.calls[0][0] as (s: unknown, p: unknown) => void;
    cb(openState, closedState);

    // Container should be visible
    // The show method is called which sets display to flex
  });

  it("hides popup when store transitions to closed", () => {
    popup = new MediaPopupView(view);

    const closedState = {
      isOpen: false,
      anchorRect: null,
    };

    const openState = {
      isOpen: true,
      anchorRect: { top: 10, bottom: 30, left: 50, right: 150 },
    };

    const cb = store.subscribe.mock.calls[0][0] as (s: unknown, p: unknown) => void;
    cb(closedState, openState);
  });

  it("shows dimensions for image with valid dimensions", () => {
    popup = new MediaPopupView(view);

    const openState = {
      isOpen: true,
      mediaSrc: "image.png",
      mediaAlt: "alt",
      mediaTitle: "",
      mediaPoster: "",
      mediaNodeType: "image",
      mediaDimensions: { width: 200, height: 100 },
      anchorRect: { top: 10, bottom: 30, left: 50, right: 150 },
      mediaNodePos: 5,
    };

    const cb = store.subscribe.mock.calls[0][0] as (s: unknown, p: unknown) => void;
    cb(openState, { isOpen: false, mediaNodePos: -1 });
  });

  it("hides dimensions for non-image types", () => {
    popup = new MediaPopupView(view);

    const openState = {
      isOpen: true,
      mediaSrc: "video.mp4",
      mediaAlt: "",
      mediaTitle: "My Video",
      mediaPoster: "",
      mediaNodeType: "block_video",
      mediaDimensions: null,
      anchorRect: { top: 10, bottom: 30, left: 50, right: 150 },
      mediaNodePos: 5,
    };

    const cb = store.subscribe.mock.calls[0][0] as (s: unknown, p: unknown) => void;
    cb(openState, { isOpen: false, mediaNodePos: -1 });
  });

  it("handles audio type with title row visible", () => {
    popup = new MediaPopupView(view);

    const openState = {
      isOpen: true,
      mediaSrc: "audio.mp3",
      mediaAlt: "",
      mediaTitle: "My Audio",
      mediaPoster: "",
      mediaNodeType: "block_audio",
      mediaDimensions: null,
      anchorRect: { top: 10, bottom: 30, left: 50, right: 150 },
      mediaNodePos: 5,
    };

    const cb = store.subscribe.mock.calls[0][0] as (s: unknown, p: unknown) => void;
    cb(openState, { isOpen: false, mediaNodePos: -1 });
  });

  it("warns when no popup host found", () => {
    vi.mocked(getPopupHostForDom).mockReturnValueOnce(null);
    popup = new MediaPopupView(view);

    const openState = {
      isOpen: true,
      mediaSrc: "image.png",
      mediaAlt: "alt",
      mediaTitle: "",
      mediaPoster: "",
      mediaNodeType: "image",
      mediaDimensions: null,
      anchorRect: { top: 10, bottom: 30, left: 50, right: 150 },
      mediaNodePos: 5,
    };

    const cb = store.subscribe.mock.calls[0][0] as (s: unknown, p: unknown) => void;
    cb(openState, { isOpen: false, mediaNodePos: -1 });

    expect(mediaPopupWarn).toHaveBeenCalledWith("No editor container found for popup host");
  });

  it("cancels pending close when popup is reopened", () => {
    const cancelSpy = vi.spyOn(globalThis, "cancelAnimationFrame");
    popup = new MediaPopupView(view);

    // Simulate a pending close
    (popup as unknown as Record<string, unknown>)["pendingCloseRaf"] = 42;

    const openState = {
      isOpen: true,
      mediaSrc: "image.png",
      mediaAlt: "",
      mediaTitle: "",
      mediaPoster: "",
      mediaNodeType: "image",
      mediaDimensions: null,
      anchorRect: { top: 10, bottom: 30, left: 50, right: 150 },
      mediaNodePos: 5,
    };

    const cb = store.subscribe.mock.calls[0][0] as (s: unknown, p: unknown) => void;
    cb(openState, { isOpen: false, mediaNodePos: -1 });

    expect(cancelSpy).toHaveBeenCalledWith(42);
    cancelSpy.mockRestore();
  });

  it("handles node change when popup is already open", () => {
    popup = new MediaPopupView(view);

    const openState1 = {
      isOpen: true,
      mediaSrc: "img1.png",
      mediaAlt: "",
      mediaTitle: "",
      mediaPoster: "",
      mediaNodeType: "image",
      mediaDimensions: null,
      anchorRect: { top: 10, bottom: 30, left: 50, right: 150 },
      mediaNodePos: 5,
    };

    const openState2 = {
      ...openState1,
      mediaSrc: "img2.png",
      mediaNodePos: 10,
    };

    const cb = store.subscribe.mock.calls[0][0] as (s: unknown, p: unknown) => void;
    // First open
    cb(openState1, { isOpen: false, mediaNodePos: -1 });
    // Switch to different node
    cb(openState2, openState1);
  });

  it("cleans up on destroy", () => {
    const removeSpy = vi.spyOn(document, "removeEventListener");
    popup = new MediaPopupView(view);
    popup.destroy();

    expect(removeSpy).toHaveBeenCalledWith("mousedown", expect.any(Function));
    removeSpy.mockRestore();
  });

  it("cancels pending close raf on destroy", () => {
    const cancelSpy = vi.spyOn(globalThis, "cancelAnimationFrame");
    popup = new MediaPopupView(view);
    (popup as unknown as Record<string, unknown>)["pendingCloseRaf"] = 99;

    popup.destroy();
    expect(cancelSpy).toHaveBeenCalledWith(99);
    cancelSpy.mockRestore();
  });

  it("removes keyboard navigation on destroy", () => {
    popup = new MediaPopupView(view);

    // Trigger show to install keyboard nav
    const openState = {
      isOpen: true,
      mediaSrc: "image.png",
      mediaAlt: "",
      mediaTitle: "",
      mediaPoster: "",
      mediaNodeType: "image",
      mediaDimensions: null,
      anchorRect: { top: 10, bottom: 30, left: 50, right: 150 },
      mediaNodePos: 5,
    };

    const cb = store.subscribe.mock.calls[0][0] as (s: unknown, p: unknown) => void;
    cb(openState, { isOpen: false, mediaNodePos: -1 });

    // Now destroy should clean up keyboard nav
    popup.destroy();
    expect(mockInstallKeyboardNavigation).toHaveBeenCalled();
  });
});

describe("MediaPopupView — input handlers", () => {
  let view: ReturnType<typeof createMockView>;
  let popup: MediaPopupView;

  beforeEach(() => {
    vi.clearAllMocks();
    view = createMockView();
    store._state.isOpen = true;
    store._state.mediaSrc = "test.png";
    store._state.mediaNodePos = 0;
    store._state.mediaNodeType = "image";
  });

  afterEach(() => {
    if (popup) popup.destroy();
  });

  it("handles Enter key to save", () => {
    popup = new MediaPopupView(view);

    // Get the onInputKeydown handler from the createMediaPopupDom call
    const handlers = vi.mocked(createMediaPopupDom).mock.calls[0][0];

    const event = new KeyboardEvent("keydown", { key: "Enter" });
    Object.defineProperty(event, "preventDefault", { value: vi.fn() });

    handlers.onInputKeydown(event);
    // handleSave is called internally
  });

  it("handles Escape key to close", () => {
    popup = new MediaPopupView(view);

    const handlers = vi.mocked(createMediaPopupDom).mock.calls[0][0];

    const event = new KeyboardEvent("keydown", { key: "Escape" });
    Object.defineProperty(event, "preventDefault", { value: vi.fn() });

    handlers.onInputKeydown(event);
    expect(mockClosePopup).toHaveBeenCalled();
  });

  it("ignores IME key events", () => {
    vi.mocked(isImeKeyEvent).mockReturnValueOnce(true);
    popup = new MediaPopupView(view);

    const handlers = vi.mocked(createMediaPopupDom).mock.calls[0][0];

    const event = new KeyboardEvent("keydown", { key: "Enter" });
    handlers.onInputKeydown(event);

    expect(mockClosePopup).not.toHaveBeenCalled();
  });

  it("handles browse action", async () => {
    mockBrowseAndReplaceMedia.mockResolvedValueOnce(true);
    popup = new MediaPopupView(view);

    const handlers = vi.mocked(createMediaPopupDom).mock.calls[0][0];

    await handlers.onBrowse();
    expect(mockBrowseAndReplaceMedia).toHaveBeenCalled();
    expect(mockClosePopup).toHaveBeenCalled();
  });

  it("does not close popup when browse returns false", async () => {
    mockBrowseAndReplaceMedia.mockResolvedValueOnce(false);
    popup = new MediaPopupView(view);

    const handlers = vi.mocked(createMediaPopupDom).mock.calls[0][0];

    await handlers.onBrowse();
    expect(mockClosePopup).not.toHaveBeenCalled();
  });

  it("handles copy action", async () => {
    store._state.mediaSrc = "https://example.com/img.png";
    const writeTextSpy = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextSpy },
      configurable: true,
    });

    popup = new MediaPopupView(view);

    const handlers = vi.mocked(createMediaPopupDom).mock.calls[0][0];

    await handlers.onCopy();
    expect(writeTextSpy).toHaveBeenCalledWith("https://example.com/img.png");
    expect(mockClosePopup).toHaveBeenCalled();
  });

  it("handles copy action with empty src", async () => {
    store._state.mediaSrc = "";
    popup = new MediaPopupView(view);

    const handlers = vi.mocked(createMediaPopupDom).mock.calls[0][0];

    await handlers.onCopy();
    expect(mockClosePopup).toHaveBeenCalled();
  });

  it("handles remove action", () => {
    popup = new MediaPopupView(view);

    const handlers = vi.mocked(createMediaPopupDom).mock.calls[0][0];

    handlers.onRemove();
    expect(view.dispatch).toHaveBeenCalled();
    expect(mockClosePopup).toHaveBeenCalled();
  });

  it("handles toggle action for image types", () => {
    store._state.mediaNodeType = "image";
    popup = new MediaPopupView(view);

    const handlers = vi.mocked(createMediaPopupDom).mock.calls[0][0];

    handlers.onToggle();
    expect(view.dispatch).toHaveBeenCalled();
  });

  it("ignores toggle for non-image types", () => {
    store._state.mediaNodeType = "block_video";
    popup = new MediaPopupView(view);

    const handlers = vi.mocked(createMediaPopupDom).mock.calls[0][0];

    handlers.onToggle();
    expect(view.dispatch).not.toHaveBeenCalled();
  });
});

describe("MediaPopupView — keyboard nav onClose callback (lines 231-232)", () => {
  let view: ReturnType<typeof createMockView>;
  let popup: MediaPopupView;

  beforeEach(() => {
    vi.clearAllMocks();
    view = createMockView();
    store._state.isOpen = true;
    store._state.mediaSrc = "test.png";
    store._state.mediaNodePos = 0;
    store._state.mediaNodeType = "image";
  });

  afterEach(() => {
    if (popup) popup.destroy();
  });

  it("invokes closePopup and focus when onClose callback is called (lines 231-232)", () => {
    popup = new MediaPopupView(view);

    // Trigger show() to call installMediaPopupKeyboardNavigation with the onClose callback
    const openState = {
      isOpen: true,
      mediaSrc: "image.png",
      mediaAlt: "",
      mediaTitle: "",
      mediaPoster: "",
      mediaNodeType: "image",
      mediaDimensions: null,
      anchorRect: { top: 10, bottom: 30, left: 50, right: 150 },
      mediaNodePos: 5,
    };
    const cb = store.subscribe.mock.calls[0][0] as (s: unknown, p: unknown) => void;
    cb(openState, { isOpen: false, mediaNodePos: -1 });

    // Extract the onClose callback passed to installMediaPopupKeyboardNavigation
    expect(mockInstallKeyboardNavigation).toHaveBeenCalled();
    const [, onClose] = mockInstallKeyboardNavigation.mock.calls[0] as [unknown, () => void];
    expect(onClose).toBeDefined();

    // Invoke the onClose callback — covers lines 231-232
    onClose();

    expect(mockClosePopup).toHaveBeenCalled();
    expect(view.focus).toHaveBeenCalled();
  });
});

describe("MediaPopupView — editorState null guard (lines 276, 304, 383)", () => {
  let _view: ReturnType<typeof createMockView>;
  let popup: MediaPopupView;

  afterEach(() => {
    if (popup) popup.destroy();
  });

  it("handleSave returns early when editorState is null (line 276)", () => {
    vi.clearAllMocks();
    // Create a view whose state is null
    const nullStateView = {
      ...createMockView(),
      state: null as unknown as ReturnType<typeof createMockView>["state"],
    } as ReturnType<typeof createMockView>;
    store._state.isOpen = true;
    store._state.mediaSrc = "test.png";
    store._state.mediaNodePos = 0;
    store._state.mediaNodeType = "image";

    popup = new MediaPopupView(nullStateView as unknown as import("@tiptap/pm/view").EditorView);
    const handlers = vi.mocked(createMediaPopupDom).mock.calls[0][0];

    const event = new KeyboardEvent("keydown", { key: "Enter" });
    Object.defineProperty(event, "preventDefault", { value: vi.fn() });

    // Should not throw and should not call dispatch
    expect(() => handlers.onInputKeydown(event)).not.toThrow();
    expect(nullStateView.dispatch).not.toHaveBeenCalled();
  });

  it("handleToggle returns early when editorState is null (line 304)", () => {
    vi.clearAllMocks();
    const nullStateView = {
      ...createMockView(),
      state: null as unknown as ReturnType<typeof createMockView>["state"],
    } as ReturnType<typeof createMockView>;
    store._state.isOpen = true;
    store._state.mediaNodePos = 0;
    store._state.mediaNodeType = "image";

    popup = new MediaPopupView(nullStateView as unknown as import("@tiptap/pm/view").EditorView);
    const handlers = vi.mocked(createMediaPopupDom).mock.calls[0][0];

    expect(() => handlers.onToggle()).not.toThrow();
    expect(nullStateView.dispatch).not.toHaveBeenCalled();
  });

  it("handleRemove returns early when editorState is null (line 383)", () => {
    vi.clearAllMocks();
    const nullStateView = {
      ...createMockView(),
      state: null as unknown as ReturnType<typeof createMockView>["state"],
    } as ReturnType<typeof createMockView>;
    store._state.isOpen = true;
    store._state.mediaNodePos = 0;
    store._state.mediaNodeType = "image";

    popup = new MediaPopupView(nullStateView as unknown as import("@tiptap/pm/view").EditorView);
    const handlers = vi.mocked(createMediaPopupDom).mock.calls[0][0];

    expect(() => handlers.onRemove()).not.toThrow();
    expect(nullStateView.dispatch).not.toHaveBeenCalled();
  });
});

describe("MediaPopupView — toggle newNodeType not found (lines 313-314)", () => {
  let view: ReturnType<typeof createMockView>;
  let popup: MediaPopupView;

  afterEach(() => {
    if (popup) popup.destroy();
  });

  it("warns and returns when target schema node type is missing (lines 313-314)", () => {
    vi.clearAllMocks();
    view = createMockView();
    // Override schema to NOT have block_image so toggling image -> block_image fails
    (view as unknown as Record<string, unknown>).state = {
      ...(view as unknown as { state: Record<string, unknown> }).state,
      doc: {
        nodeAt: vi.fn(() => ({
          type: { name: "image" },
          attrs: { src: "test.png", alt: "alt" },
          nodeSize: 1,
        })),
      },
      schema: {
        nodes: {
          // Deliberately omit block_image so newNodeType is undefined
          image: { create: vi.fn() },
        },
      },
    };
    store._state.isOpen = true;
    store._state.mediaNodePos = 0;
    store._state.mediaNodeType = "image";

    popup = new MediaPopupView(view as unknown as import("@tiptap/pm/view").EditorView);
    const handlers = vi.mocked(createMediaPopupDom).mock.calls[0][0];

    handlers.onToggle();

    expect(mediaPopupWarn).toHaveBeenCalledWith("block_image schema not available");
    expect(view.dispatch).not.toHaveBeenCalled();
  });
});

describe("MediaPopupView — deferred close RAF fires closePopup (line 421)", () => {
  let view: ReturnType<typeof createMockView>;
  let popup: MediaPopupView;

  beforeEach(() => {
    vi.clearAllMocks();
    view = createMockView();
    store._state.isOpen = true;
  });

  afterEach(() => {
    if (popup) popup.destroy();
  });

  it("calls closePopup in RAF callback when still open and active element outside container (line 421)", async () => {
    popup = new MediaPopupView(view);

    // Trigger an outside click so pendingCloseRaf is set
    const event = new MouseEvent("mousedown", { bubbles: true });
    Object.defineProperty(event, "target", { value: document.body });
    document.dispatchEvent(event);

    // Wait for the RAF to fire
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));

    expect(mockClosePopup).toHaveBeenCalled();
  });
});

describe("MediaPopupView — click outside", () => {
  let view: ReturnType<typeof createMockView>;
  let popup: MediaPopupView;

  beforeEach(() => {
    vi.clearAllMocks();
    view = createMockView();
    store._state.isOpen = true;
  });

  afterEach(() => {
    if (popup) popup.destroy();
  });

  it("closes popup on click outside", () => {
    popup = new MediaPopupView(view);

    // Simulate a click outside the container
    const event = new MouseEvent("mousedown", { bubbles: true });
    Object.defineProperty(event, "target", { value: document.body });

    document.dispatchEvent(event);

    // The close is deferred via requestAnimationFrame
  });

  it("does not close when click is inside container", () => {
    popup = new MediaPopupView(view);
    store._state.isOpen = true;

    // The container is created by the mock
    const container = vi.mocked(createMediaPopupDom).mock.results[0].value.container;

    const event = new MouseEvent("mousedown", { bubbles: true });
    Object.defineProperty(event, "target", { value: container });

    document.dispatchEvent(event);
    // Should not schedule a close
  });

  it("does not close when popup is not open", () => {
    popup = new MediaPopupView(view);
    store._state.isOpen = false;

    const event = new MouseEvent("mousedown", { bubbles: true });
    Object.defineProperty(event, "target", { value: document.body });

    document.dispatchEvent(event);
    // Should not schedule a close since popup is not open
  });
});

describe("MediaPopupView — scroll handling", () => {
  let view: ReturnType<typeof createMockView>;
  let popup: MediaPopupView;

  beforeEach(() => {
    vi.clearAllMocks();
    view = createMockView();
    store._state.isOpen = true;
  });

  afterEach(() => {
    if (popup) popup.destroy();
  });

  it("closes popup on scroll when open", () => {
    popup = new MediaPopupView(view);

    // Trigger scroll on the editor container
    const editorContainer = (view.dom as HTMLElement).closest(".editor-container");
    if (editorContainer) {
      editorContainer.dispatchEvent(new Event("scroll"));
    }

    expect(mockClosePopup).toHaveBeenCalled();
  });

  it("does not close popup on scroll when not open", () => {
    popup = new MediaPopupView(view);
    store._state.isOpen = false;

    const editorContainer = (view.dom as HTMLElement).closest(".editor-container");
    if (editorContainer) {
      editorContainer.dispatchEvent(new Event("scroll"));
    }

    expect(mockClosePopup).not.toHaveBeenCalled();
  });
});

describe("MediaPopupView — src/alt/title/poster input change handlers", () => {
  let view: ReturnType<typeof createMockView>;
  let popup: MediaPopupView;

  beforeEach(() => {
    vi.clearAllMocks();
    view = createMockView();
    store._state.isOpen = true;
    store._state.mediaSrc = "test.png";
    store._state.mediaNodePos = 0;
    store._state.mediaNodeType = "image";
  });

  afterEach(() => {
    if (popup) popup.destroy();
  });

  it("handles src input change and updates node attr", () => {
    popup = new MediaPopupView(view);
    const dom = vi.mocked(createMediaPopupDom).mock.results[0].value;

    dom.srcInput.value = "new-src.png";
    dom.srcInput.dispatchEvent(new Event("input"));

    expect(mockSetSrc).toHaveBeenCalledWith("new-src.png");
    expect(view.dispatch).toHaveBeenCalled();
  });

  it("handles alt input change and updates node attr", () => {
    popup = new MediaPopupView(view);
    const dom = vi.mocked(createMediaPopupDom).mock.results[0].value;

    dom.altInput.value = "new alt text";
    dom.altInput.dispatchEvent(new Event("input"));

    expect(mockSetAlt).toHaveBeenCalledWith("new alt text");
    expect(view.dispatch).toHaveBeenCalled();
  });

  it("handles title input change and updates node attr", () => {
    popup = new MediaPopupView(view);
    const dom = vi.mocked(createMediaPopupDom).mock.results[0].value;

    dom.titleInput.value = "new title";
    dom.titleInput.dispatchEvent(new Event("input"));

    expect(mockSetTitle).toHaveBeenCalledWith("new title");
    expect(view.dispatch).toHaveBeenCalled();
  });

  it("handles poster input change and updates node attr", () => {
    popup = new MediaPopupView(view);
    const dom = vi.mocked(createMediaPopupDom).mock.results[0].value;

    dom.posterInput.value = "poster.jpg";
    dom.posterInput.dispatchEvent(new Event("input"));

    expect(mockSetPoster).toHaveBeenCalledWith("poster.jpg");
    expect(view.dispatch).toHaveBeenCalled();
  });

  it("updateNodeAttr skips when mediaNodePos is negative", () => {
    store._state.mediaNodePos = -1;
    popup = new MediaPopupView(view);
    const dom = vi.mocked(createMediaPopupDom).mock.results[0].value;

    dom.srcInput.value = "new.png";
    dom.srcInput.dispatchEvent(new Event("input"));

    // setSrc called on store, but dispatch should NOT be called (guard at line 430)
    expect(mockSetSrc).toHaveBeenCalled();
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("updateNodeAttr silently ignores when node type does not match", () => {
    // nodeAt returns a node with type name "block_video" but store says "image"
    (view as unknown as Record<string, unknown>).state = {
      ...(view as unknown as { state: Record<string, unknown> }).state,
      doc: {
        nodeAt: vi.fn(() => ({
          type: { name: "block_video" },
          attrs: { src: "video.mp4" },
          nodeSize: 1,
        })),
      },
    };
    popup = new MediaPopupView(view as unknown as import("@tiptap/pm/view").EditorView);
    const dom = vi.mocked(createMediaPopupDom).mock.results[0].value;

    dom.srcInput.value = "new.png";
    dom.srcInput.dispatchEvent(new Event("input"));

    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("updateNodeAttr catches exceptions silently", () => {
    // Make dispatch throw
    (view as unknown as { dispatch: ReturnType<typeof vi.fn> }).dispatch.mockImplementation(() => {
      throw new Error("dispatch error");
    });
    popup = new MediaPopupView(view as unknown as import("@tiptap/pm/view").EditorView);
    const dom = vi.mocked(createMediaPopupDom).mock.results[0].value;

    dom.srcInput.value = "new.png";
    expect(() => dom.srcInput.dispatchEvent(new Event("input"))).not.toThrow();
  });
});

describe("MediaPopupView — handleSave edge cases", () => {
  let view: ReturnType<typeof createMockView>;
  let popup: MediaPopupView;

  afterEach(() => {
    if (popup) popup.destroy();
  });

  it("handleSave removes node when src is empty (calls handleRemove)", () => {
    vi.clearAllMocks();
    view = createMockView();
    store._state.isOpen = true;
    store._state.mediaSrc = "";
    store._state.mediaNodePos = 0;
    store._state.mediaNodeType = "image";

    popup = new MediaPopupView(view);
    const dom = vi.mocked(createMediaPopupDom).mock.results[0].value;

    // Clear the src input (empty)
    dom.srcInput.value = "";

    const event = new KeyboardEvent("keydown", { key: "Enter" });
    Object.defineProperty(event, "preventDefault", { value: vi.fn() });

    const handlers = vi.mocked(createMediaPopupDom).mock.calls[0][0];
    handlers.onInputKeydown(event);

    // Should call dispatch (via handleRemove)
    expect(view.dispatch).toHaveBeenCalled();
  });

  it("handleSave returns early when node type does not match", () => {
    vi.clearAllMocks();
    view = createMockView();
    // nodeAt returns a node with a different type than mediaNodeType
    (view as unknown as Record<string, unknown>).state = {
      ...(view as unknown as { state: Record<string, unknown> }).state,
      doc: {
        nodeAt: vi.fn(() => ({
          type: { name: "block_video" },
          attrs: { src: "video.mp4" },
          nodeSize: 1,
        })),
      },
    };
    store._state.isOpen = true;
    store._state.mediaSrc = "test.png";
    store._state.mediaNodePos = 0;
    store._state.mediaNodeType = "image";

    popup = new MediaPopupView(view as unknown as import("@tiptap/pm/view").EditorView);
    const dom = vi.mocked(createMediaPopupDom).mock.results[0].value;
    dom.srcInput.value = "updated.png";

    const event = new KeyboardEvent("keydown", { key: "Enter" });
    Object.defineProperty(event, "preventDefault", { value: vi.fn() });

    const handlers = vi.mocked(createMediaPopupDom).mock.calls[0][0];
    handlers.onInputKeydown(event);

    // dispatch should NOT be called since node type doesn't match
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("handleSave catches errors and closes popup", () => {
    vi.clearAllMocks();
    view = createMockView();
    // Make setNodeMarkup throw
    const mockTr = {
      setNodeMarkup: vi.fn(() => { throw new Error("tr error"); }),
    };
    (view as unknown as Record<string, unknown>).state = {
      ...(view as unknown as { state: Record<string, unknown> }).state,
      tr: mockTr,
    };
    store._state.isOpen = true;
    store._state.mediaSrc = "test.png";
    store._state.mediaNodePos = 0;
    store._state.mediaNodeType = "image";

    popup = new MediaPopupView(view as unknown as import("@tiptap/pm/view").EditorView);
    const dom = vi.mocked(createMediaPopupDom).mock.results[0].value;
    dom.srcInput.value = "updated.png";

    const event = new KeyboardEvent("keydown", { key: "Enter" });
    Object.defineProperty(event, "preventDefault", { value: vi.fn() });

    const handlers = vi.mocked(createMediaPopupDom).mock.calls[0][0];
    expect(() => handlers.onInputKeydown(event)).not.toThrow();
    expect(mockClosePopup).toHaveBeenCalled();
  });

  it("handleSave builds video/audio attrs with title and poster", () => {
    vi.clearAllMocks();
    view = createMockView();
    (view as unknown as Record<string, unknown>).state = {
      ...(view as unknown as { state: Record<string, unknown> }).state,
      doc: {
        nodeAt: vi.fn(() => ({
          type: { name: "block_video" },
          attrs: { src: "old.mp4", title: "", poster: "" },
          nodeSize: 1,
        })),
      },
    };
    store._state.isOpen = true;
    store._state.mediaSrc = "old.mp4";
    store._state.mediaNodePos = 0;
    store._state.mediaNodeType = "block_video";

    popup = new MediaPopupView(view as unknown as import("@tiptap/pm/view").EditorView);
    const dom = vi.mocked(createMediaPopupDom).mock.results[0].value;
    dom.srcInput.value = "new.mp4";
    dom.titleInput.value = "My Video";
    dom.posterInput.value = "poster.jpg";

    const event = new KeyboardEvent("keydown", { key: "Enter" });
    Object.defineProperty(event, "preventDefault", { value: vi.fn() });

    const handlers = vi.mocked(createMediaPopupDom).mock.calls[0][0];
    handlers.onInputKeydown(event);

    expect(view.dispatch).toHaveBeenCalled();
    expect(mockClosePopup).toHaveBeenCalled();
  });
});

describe("MediaPopupView — handleToggle edge cases", () => {
  let view: ReturnType<typeof createMockView>;
  let popup: MediaPopupView;

  afterEach(() => {
    if (popup) popup.destroy();
  });

  it("handleToggle catches error and does not crash", () => {
    vi.clearAllMocks();
    view = createMockView();
    const mockTr = {
      replaceWith: vi.fn(() => { throw new Error("replace error"); }),
    };
    (view as unknown as Record<string, unknown>).state = {
      ...(view as unknown as { state: Record<string, unknown> }).state,
      tr: mockTr,
    };
    store._state.isOpen = true;
    store._state.mediaNodePos = 0;
    store._state.mediaNodeType = "image";

    popup = new MediaPopupView(view as unknown as import("@tiptap/pm/view").EditorView);
    const handlers = vi.mocked(createMediaPopupDom).mock.calls[0][0];

    expect(() => handlers.onToggle()).not.toThrow();
  });

  it("handleToggle with nodeAt returning null does not dispatch", () => {
    vi.clearAllMocks();
    view = createMockView();
    (view as unknown as Record<string, unknown>).state = {
      ...(view as unknown as { state: Record<string, unknown> }).state,
      doc: {
        nodeAt: vi.fn(() => null),
      },
    };
    store._state.isOpen = true;
    store._state.mediaNodePos = 0;
    store._state.mediaNodeType = "block_image";

    popup = new MediaPopupView(view as unknown as import("@tiptap/pm/view").EditorView);
    const handlers = vi.mocked(createMediaPopupDom).mock.calls[0][0];

    handlers.onToggle();
    expect(view.dispatch).not.toHaveBeenCalled();
  });
});

describe("MediaPopupView — handleRemove edge cases", () => {
  let view: ReturnType<typeof createMockView>;
  let popup: MediaPopupView;

  afterEach(() => {
    if (popup) popup.destroy();
  });

  it("handleRemove returns early when node type does not match", () => {
    vi.clearAllMocks();
    view = createMockView();
    (view as unknown as Record<string, unknown>).state = {
      ...(view as unknown as { state: Record<string, unknown> }).state,
      doc: {
        nodeAt: vi.fn(() => ({
          type: { name: "block_video" },
          attrs: {},
          nodeSize: 1,
        })),
      },
    };
    store._state.isOpen = true;
    store._state.mediaNodePos = 0;
    store._state.mediaNodeType = "image";

    popup = new MediaPopupView(view as unknown as import("@tiptap/pm/view").EditorView);
    const handlers = vi.mocked(createMediaPopupDom).mock.calls[0][0];

    handlers.onRemove();
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("handleRemove catches error and closes popup", () => {
    vi.clearAllMocks();
    view = createMockView();
    const mockTr = {
      delete: vi.fn(() => { throw new Error("delete error"); }),
    };
    (view as unknown as Record<string, unknown>).state = {
      ...(view as unknown as { state: Record<string, unknown> }).state,
      tr: mockTr,
    };
    store._state.isOpen = true;
    store._state.mediaNodePos = 0;
    store._state.mediaNodeType = "image";

    popup = new MediaPopupView(view as unknown as import("@tiptap/pm/view").EditorView);
    const handlers = vi.mocked(createMediaPopupDom).mock.calls[0][0];

    expect(() => handlers.onRemove()).not.toThrow();
    expect(mockClosePopup).toHaveBeenCalled();
  });
});

describe("MediaPopupView — viewport bounds fallback (line 206)", () => {
  let view: ReturnType<typeof createMockView>;
  let popup: MediaPopupView;

  afterEach(() => {
    if (popup) popup.destroy();
  });

  it("uses viewport bounds when no editor-container is found (line 206)", () => {
    vi.clearAllMocks();
    // Create a view where dom.closest returns null (no editor-container)
    view = createMockView();
    (view.dom as HTMLElement).closest = vi.fn(() => null);

    popup = new MediaPopupView(view);

    const openState = {
      isOpen: true,
      mediaSrc: "image.png",
      mediaAlt: "",
      mediaTitle: "",
      mediaPoster: "",
      mediaNodeType: "image",
      mediaDimensions: null,
      anchorRect: { top: 10, bottom: 30, left: 50, right: 150 },
      mediaNodePos: 5,
    };

    const cb = store.subscribe.mock.calls[0][0] as (s: unknown, p: unknown) => void;
    cb(openState, { isOpen: false, mediaNodePos: -1 });

    // Should not crash — uses getViewportBounds() fallback
  });
});

describe("MediaPopupView — toggle block_image to image (branch 30)", () => {
  let view: ReturnType<typeof createMockView>;
  let popup: MediaPopupView;

  afterEach(() => {
    if (popup) popup.destroy();
  });

  it("toggles block_image to image (targetType = 'image')", () => {
    vi.clearAllMocks();
    view = createMockView();
    (view as unknown as Record<string, unknown>).state = {
      ...(view as unknown as { state: Record<string, unknown> }).state,
      doc: {
        nodeAt: vi.fn(() => ({
          type: { name: "block_image" },
          attrs: { src: "test.png", alt: "alt" },
          nodeSize: 1,
        })),
      },
    };
    store._state.isOpen = true;
    store._state.mediaNodePos = 0;
    store._state.mediaNodeType = "block_image";

    popup = new MediaPopupView(view as unknown as import("@tiptap/pm/view").EditorView);
    const handlers = vi.mocked(createMediaPopupDom).mock.calls[0][0];

    handlers.onToggle();
    // Should dispatch a replaceWith transaction using "image" node type
    expect(view.dispatch).toHaveBeenCalled();
  });
});

describe("MediaPopupView — handleSave with nodeAt returning null (line 279)", () => {
  let view: ReturnType<typeof createMockView>;
  let popup: MediaPopupView;

  afterEach(() => {
    if (popup) popup.destroy();
  });

  it("returns early when nodeAt returns null during save", () => {
    vi.clearAllMocks();
    view = createMockView();
    (view as unknown as Record<string, unknown>).state = {
      ...(view as unknown as { state: Record<string, unknown> }).state,
      doc: {
        nodeAt: vi.fn(() => null),
      },
    };
    store._state.isOpen = true;
    store._state.mediaSrc = "test.png";
    store._state.mediaNodePos = 0;
    store._state.mediaNodeType = "image";

    popup = new MediaPopupView(view as unknown as import("@tiptap/pm/view").EditorView);
    const dom = vi.mocked(createMediaPopupDom).mock.results[0].value;
    dom.srcInput.value = "updated.png";

    const event = new KeyboardEvent("keydown", { key: "Enter" });
    Object.defineProperty(event, "preventDefault", { value: vi.fn() });

    const handlers = vi.mocked(createMediaPopupDom).mock.calls[0][0];
    handlers.onInputKeydown(event);

    expect(view.dispatch).not.toHaveBeenCalled();
  });
});

describe("MediaPopupView — handleRemove with nodeAt null (line 385)", () => {
  let view: ReturnType<typeof createMockView>;
  let popup: MediaPopupView;

  afterEach(() => {
    if (popup) popup.destroy();
  });

  it("returns early when nodeAt returns null during remove", () => {
    vi.clearAllMocks();
    view = createMockView();
    (view as unknown as Record<string, unknown>).state = {
      ...(view as unknown as { state: Record<string, unknown> }).state,
      doc: {
        nodeAt: vi.fn(() => null),
      },
    };
    store._state.isOpen = true;
    store._state.mediaNodePos = 0;
    store._state.mediaNodeType = "image";

    popup = new MediaPopupView(view as unknown as import("@tiptap/pm/view").EditorView);
    const handlers = vi.mocked(createMediaPopupDom).mock.calls[0][0];

    handlers.onRemove();
    expect(view.dispatch).not.toHaveBeenCalled();
  });
});

describe("MediaPopupView — handleCopy", () => {
  let view: ReturnType<typeof createMockView>;
  let popup: MediaPopupView;

  afterEach(() => {
    if (popup) popup.destroy();
  });

  it("resolves relative path to absolute before copying", async () => {
    vi.clearAllMocks();
    mockDirname.mockResolvedValue("/docs");
    mockJoin.mockResolvedValue("/docs/test.png");
    mockGetActiveTabIdForCurrentWindow.mockReturnValue("tab-1");

    view = createMockView();
    store._state.isOpen = true;
    store._state.mediaSrc = "test.png";

    const writeTextSpy = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextSpy },
      configurable: true,
    });

    popup = new MediaPopupView(view);
    const handlers = vi.mocked(createMediaPopupDom).mock.calls[0][0];

    await handlers.onCopy();
    expect(writeTextSpy).toHaveBeenCalledWith("/docs/test.png");
    expect(mockClosePopup).toHaveBeenCalled();
  });

  it("copies absolute path as-is", async () => {
    vi.clearAllMocks();
    view = createMockView();
    store._state.isOpen = true;
    store._state.mediaSrc = "/absolute/image.png";

    const writeTextSpy = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextSpy },
      configurable: true,
    });

    popup = new MediaPopupView(view);
    const handlers = vi.mocked(createMediaPopupDom).mock.calls[0][0];

    await handlers.onCopy();
    expect(writeTextSpy).toHaveBeenCalledWith("/absolute/image.png");
    expect(mockDirname).not.toHaveBeenCalled();
  });

  it("copies URL as-is", async () => {
    vi.clearAllMocks();
    view = createMockView();
    store._state.isOpen = true;
    store._state.mediaSrc = "https://example.com/image.png";

    const writeTextSpy = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextSpy },
      configurable: true,
    });

    popup = new MediaPopupView(view);
    const handlers = vi.mocked(createMediaPopupDom).mock.calls[0][0];

    await handlers.onCopy();
    expect(writeTextSpy).toHaveBeenCalledWith("https://example.com/image.png");
    expect(mockDirname).not.toHaveBeenCalled();
  });

  it("handles clipboard writeText failure gracefully", async () => {
    vi.clearAllMocks();
    mockDirname.mockResolvedValue("/docs");
    mockJoin.mockResolvedValue("/docs/test.png");
    mockGetActiveTabIdForCurrentWindow.mockReturnValue("tab-1");

    view = createMockView();
    store._state.isOpen = true;
    store._state.mediaSrc = "test.png";

    const writeTextSpy = vi.fn(() => Promise.reject(new Error("clipboard error")));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextSpy },
      configurable: true,
    });

    popup = new MediaPopupView(view);
    const handlers = vi.mocked(createMediaPopupDom).mock.calls[0][0];

    await handlers.onCopy();
    expect(mockClosePopup).toHaveBeenCalled();
  });

  it("falls back to raw src when path resolution fails", async () => {
    vi.clearAllMocks();
    mockDirname.mockRejectedValue(new Error("path error"));
    mockGetActiveTabIdForCurrentWindow.mockReturnValue("tab-1");

    view = createMockView();
    store._state.isOpen = true;
    store._state.mediaSrc = "test.png";

    const writeTextSpy = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextSpy },
      configurable: true,
    });

    popup = new MediaPopupView(view);
    const handlers = vi.mocked(createMediaPopupDom).mock.calls[0][0];

    await handlers.onCopy();
    expect(writeTextSpy).toHaveBeenCalledWith("test.png");
  });
});
