/**
 * Source Image Preview Tests
 *
 * Tests that the media preview respects mediaPopupStore.isOpen state and
 * supports image, video, and audio file types:
 * - Preview is suppressed when the media edit popup is open
 * - Preview shows normally when the popup is closed
 * - Video and audio paths trigger preview with correct media type
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

// Track calls to the image preview singleton and the non-allocating helper
const mockHide = vi.fn();
const mockShow = vi.fn();
const mockIsVisible = vi.fn(() => false);
const mockUpdateContent = vi.fn();
const mockHideImagePreview = vi.fn();

vi.mock("@/plugins/imagePreview/ImagePreviewView", () => ({
  getImagePreviewView: () => ({
    hide: mockHide,
    show: mockShow,
    isVisible: mockIsVisible,
    updateContent: mockUpdateContent,
  }),
  hideImagePreview: (...args: unknown[]) => mockHideImagePreview(...args),
}));

// Mock mediaPopupStore with subscribe support for cached state
let mockIsOpen = false;
const subscribers = new Set<(state: { isOpen: boolean }) => void>();

// The media popup state is passed to the factory now, not imported by it.
const mockMediaPopup = {
  getState: () => ({ isOpen: mockIsOpen }),
  subscribe: (cb: (state: { isOpen: boolean }) => void) => {
    subscribers.add(cb);
    return () => subscribers.delete(cb);
  },
} as never;

const mockGetMediaType = vi.fn<(path: string) => "image" | "video" | "audio" | null>(() => "image");
vi.mock("@/utils/mediaPathDetection", () => ({
  getMediaType: (...args: unknown[]) => mockGetMediaType(args[0] as string),
}));

import { createSourceImagePreviewPlugin } from "../sourceImagePreview";

/** Flush one requestAnimationFrame tick. */
async function flushRaf(): Promise<void> {
  await new Promise((r) => requestAnimationFrame(r));
}

function createView(content: string, cursorPos: number): EditorView {
  const state = EditorState.create({
    doc: content,
    selection: { anchor: cursorPos },
    extensions: [createSourceImagePreviewPlugin(mockMediaPopup)],
  });
  return new EditorView({
    state,
    parent: document.createElement("div"),
  });
}

describe("sourceImagePreview popup-open guard", () => {
  let coordsSpy: ReturnType<typeof vi.spyOn>;
  let activeView: EditorView | null = null;

  beforeAll(() => {
    // Mock coordsAtPos — jsdom has no layout engine
    coordsSpy = vi.spyOn(EditorView.prototype, "coordsAtPos").mockReturnValue({
      top: 100,
      left: 50,
      bottom: 120,
      right: 200,
    });
  });

  afterAll(() => {
    coordsSpy.mockRestore();
  });

  beforeEach(() => {
    mockIsOpen = false;
    subscribers.clear();
    mockHide.mockClear();
    mockHideImagePreview.mockClear();
    mockShow.mockClear();
    mockIsVisible.mockClear();
    mockUpdateContent.mockClear();
    mockGetMediaType.mockClear();
    mockGetMediaType.mockReturnValue("image");
    coordsSpy.mockClear();
  });

  afterEach(() => {
    activeView?.destroy();
    activeView = null;
  });

  it("does not show preview when mediaPopupStore.isOpen is true", async () => {
    mockIsOpen = true;
    const content = "![alt](image.png)";
    activeView = createView(content, 5);

    await flushRaf();

    // Guard triggers hidePreview — hideImagePreview must be called, show must not
    expect(mockHideImagePreview).toHaveBeenCalled();
    expect(mockShow).not.toHaveBeenCalled();
    expect(mockUpdateContent).not.toHaveBeenCalled();
    // coordsAtPos should not be called (guard exits before layout)
    expect(coordsSpy).not.toHaveBeenCalled();
  });

  it("shows preview when mediaPopupStore.isOpen is false", async () => {
    mockIsOpen = false;
    const content = "![alt](image.png)";
    activeView = createView(content, 5);

    await flushRaf();

    // Guard did NOT block — coordsAtPos was called to get anchor rect
    expect(coordsSpy).toHaveBeenCalled();
    // show() is called with correct arguments including media type
    expect(mockShow).toHaveBeenCalledWith(
      "image.png",
      expect.objectContaining({ top: 100, left: 50, bottom: 120, right: 200 }),
      activeView!.dom,
      "image",
    );
    expect(mockUpdateContent).not.toHaveBeenCalled();
  });

  it("hides preview on cursor outside image when popup is closed", async () => {
    mockIsOpen = false;
    const content = "Hello ![alt](image.png) world";
    activeView = createView(content, 0);

    await flushRaf();

    // hideImagePreview called during initial check (no image at pos 0)
    expect(mockHideImagePreview).toHaveBeenCalled();
    expect(mockShow).not.toHaveBeenCalled();
  });

  it("suppresses hover preview when popup is open", async () => {
    mockIsOpen = true;
    const content = "![alt](image.png)";
    activeView = createView(content, 0);

    // Flush constructor rAF first
    await flushRaf();
    mockHideImagePreview.mockClear();
    mockShow.mockClear();

    // Simulate mouse move over the image area
    const moveEvent = new MouseEvent("mousemove", {
      clientX: 50,
      clientY: 10,
      bubbles: true,
    });
    activeView.dom.dispatchEvent(moveEvent);

    // Guard fires hidePreview via cached state, no show
    expect(mockHideImagePreview).toHaveBeenCalled();
    expect(mockShow).not.toHaveBeenCalled();
    expect(mockUpdateContent).not.toHaveBeenCalled();
  });

  it("hides preview reactively when popup opens via subscription", async () => {
    mockIsOpen = false;
    const content = "![alt](image.png)";
    activeView = createView(content, 5);

    await flushRaf();

    // Preview was shown
    expect(mockShow).toHaveBeenCalled();
    mockHideImagePreview.mockClear();

    // Simulate popup opening via store subscription
    mockIsOpen = true;
    for (const cb of subscribers) {
      cb({ isOpen: true });
    }

    // Subscription triggers hidePreview immediately
    expect(mockHideImagePreview).toHaveBeenCalled();
  });
});

describe("sourceImagePreview audio/video support", () => {
  let coordsSpy: ReturnType<typeof vi.spyOn>;
  let activeView: EditorView | null = null;

  beforeAll(() => {
    coordsSpy = vi.spyOn(EditorView.prototype, "coordsAtPos").mockReturnValue({
      top: 100,
      left: 50,
      bottom: 120,
      right: 200,
    });
  });

  afterAll(() => {
    coordsSpy.mockRestore();
  });

  beforeEach(() => {
    mockIsOpen = false;
    subscribers.clear();
    mockHide.mockClear();
    mockHideImagePreview.mockClear();
    mockShow.mockClear();
    mockIsVisible.mockClear();
    mockUpdateContent.mockClear();
    mockGetMediaType.mockClear();
    coordsSpy.mockClear();
  });

  afterEach(() => {
    activeView?.destroy();
    activeView = null;
  });

  it("shows preview for video files with type 'video'", async () => {
    mockGetMediaType.mockReturnValue("video");
    const content = "![video](clip.mp4)";
    activeView = createView(content, 5);

    await flushRaf();

    expect(mockShow).toHaveBeenCalledWith(
      "clip.mp4",
      expect.objectContaining({ top: 100, left: 50 }),
      activeView!.dom,
      "video",
    );
  });

  it("shows preview for audio files with type 'audio'", async () => {
    mockGetMediaType.mockReturnValue("audio");
    const content = "![song](track.mp3)";
    activeView = createView(content, 5);

    await flushRaf();

    expect(mockShow).toHaveBeenCalledWith(
      "track.mp3",
      expect.objectContaining({ top: 100, left: 50 }),
      activeView!.dom,
      "audio",
    );
  });

  it("does not show preview for unknown file extensions", async () => {
    mockGetMediaType.mockReturnValue(null);
    const content = "![doc](readme.txt)";
    activeView = createView(content, 5);

    await flushRaf();

    expect(mockShow).not.toHaveBeenCalled();
    expect(mockHideImagePreview).toHaveBeenCalled();
  });

  it("still shows preview for data:image/ URLs as image type", async () => {
    // data: URLs bypass getMediaType — always treated as image
    mockGetMediaType.mockReturnValue(null);
    const content = "![img](data:image/png;base64,abc)";
    activeView = createView(content, 5);

    await flushRaf();

    expect(mockShow).toHaveBeenCalledWith(
      "data:image/png;base64,abc",
      expect.any(Object),
      activeView!.dom,
      "image",
    );
  });

  it("passes media type through updateContent when preview is already visible", async () => {
    mockGetMediaType.mockReturnValue("video");
    mockIsVisible.mockReturnValue(true);
    const content = "![v](clip.mp4)";
    activeView = createView(content, 5);

    await flushRaf();

    expect(mockUpdateContent).toHaveBeenCalledWith("clip.mp4", expect.any(Object), "video");
  });
});

describe("sourceImagePreview findMediaAtCursor edge cases", () => {
  let coordsSpy: ReturnType<typeof vi.spyOn>;
  let activeView: EditorView | null = null;

  beforeAll(() => {
    coordsSpy = vi.spyOn(EditorView.prototype, "coordsAtPos").mockReturnValue({
      top: 100,
      left: 50,
      bottom: 120,
      right: 200,
    });
  });

  afterAll(() => {
    coordsSpy.mockRestore();
  });

  beforeEach(() => {
    mockIsOpen = false;
    subscribers.clear();
    mockHide.mockClear();
    mockHideImagePreview.mockClear();
    mockShow.mockClear();
    mockIsVisible.mockClear();
    mockIsVisible.mockReturnValue(false);
    mockUpdateContent.mockClear();
    mockGetMediaType.mockClear();
    mockGetMediaType.mockReturnValue("image");
    coordsSpy.mockClear();
  });

  afterEach(() => {
    activeView?.destroy();
    activeView = null;
  });

  it("detects angle-bracket path syntax ![alt](<path with spaces>)", async () => {
    const content = "![alt](<my image.png>)";
    activeView = createView(content, 10);

    await flushRaf();

    expect(mockShow).toHaveBeenCalledWith(
      "my image.png",
      expect.any(Object),
      activeView!.dom,
      "image",
    );
  });

  it("detects image with title attribute ![alt](path \"title\")", async () => {
    const content = '![alt](image.png "Photo title")';
    activeView = createView(content, 10);

    await flushRaf();

    expect(mockShow).toHaveBeenCalledWith(
      "image.png",
      expect.any(Object),
      activeView!.dom,
      "image",
    );
  });

  it("hides preview when cursor is outside image but on same line", async () => {
    const content = "text before ![alt](image.png) text after";
    activeView = createView(content, 2);

    await flushRaf();

    expect(mockShow).not.toHaveBeenCalled();
    expect(mockHideImagePreview).toHaveBeenCalled();
  });

  it("hides preview for range selection even inside image", async () => {
    const content = "![alt](image.png)";
    const state = EditorState.create({
      doc: content,
      selection: { anchor: 2, head: 10 },
      extensions: [createSourceImagePreviewPlugin(mockMediaPopup)],
    });
    activeView = new EditorView({ state, parent: document.createElement("div") });

    await flushRaf();

    expect(mockShow).not.toHaveBeenCalled();
    expect(mockHideImagePreview).toHaveBeenCalled();
  });

  it("handles empty alt text ![](image.png)", async () => {
    const content = "![](image.png)";
    activeView = createView(content, 5);

    await flushRaf();

    expect(mockShow).toHaveBeenCalledWith(
      "image.png",
      expect.any(Object),
      activeView!.dom,
      "image",
    );
  });

  it("handles cursor at exact start of image syntax", async () => {
    const content = "![alt](image.png)";
    activeView = createView(content, 0);

    await flushRaf();

    // Cursor at pos 0 is inside the match (starts at 0)
    expect(mockShow).toHaveBeenCalledWith(
      "image.png",
      expect.any(Object),
      activeView!.dom,
      "image",
    );
  });

  it("hides preview when cursor is at exact end of image syntax", async () => {
    const content = "![alt](image.png)";
    // pos === matchEnd means NOT inside (check is pos < matchEnd)
    activeView = createView(content, content.length);

    await flushRaf();

    expect(mockShow).not.toHaveBeenCalled();
  });

  it("handles mouseleave to clear hover preview", async () => {
    mockIsOpen = false;
    const content = "![alt](image.png)";
    activeView = createView(content, content.length); // cursor outside image

    await flushRaf();
    mockHideImagePreview.mockClear();

    const leaveEvent = new MouseEvent("mouseleave", { bubbles: true });
    activeView.dom.dispatchEvent(leaveEvent);

    // mouseleave should try to clear hover — but no hover was set, so no hide call
    // (clearHoverPreview only hides if hoverImageRange is set and currentImageRange is null)
  });

  it("hover shows preview for image not under cursor", async () => {
    mockIsOpen = false;
    const content = "text ![alt](image.png) more text";
    // Cursor at end of line (not inside image)
    activeView = createView(content, content.length);

    await flushRaf();
    mockHideImagePreview.mockClear();
    mockShow.mockClear();

    // Mock posAtCoords to return a position inside the image syntax
    const posAtCoordsSpy = vi.spyOn(activeView, "posAtCoords").mockReturnValue(8);

    const moveEvent = new MouseEvent("mousemove", {
      clientX: 50,
      clientY: 10,
      bubbles: true,
    });
    activeView.dom.dispatchEvent(moveEvent);

    // Hover should trigger show for the image
    expect(mockShow).toHaveBeenCalledWith(
      "image.png",
      expect.any(Object),
      activeView!.dom,
      "image",
    );

    posAtCoordsSpy.mockRestore();
  });

  it("hover on same image range does nothing", async () => {
    mockIsOpen = false;
    const content = "text ![alt](image.png) more text";
    activeView = createView(content, content.length);

    await flushRaf();
    mockHideImagePreview.mockClear();
    mockShow.mockClear();

    // Mock posAtCoords to return inside the image
    const posAtCoordsSpy = vi.spyOn(activeView, "posAtCoords").mockReturnValue(8);

    // First hover — shows preview
    const moveEvent1 = new MouseEvent("mousemove", {
      clientX: 50, clientY: 10, bubbles: true,
    });
    activeView.dom.dispatchEvent(moveEvent1);
    expect(mockShow).toHaveBeenCalledTimes(1);

    mockShow.mockClear();

    // Second hover on same range — should be a no-op (same from/to)
    const moveEvent2 = new MouseEvent("mousemove", {
      clientX: 60, clientY: 10, bubbles: true,
    });
    activeView.dom.dispatchEvent(moveEvent2);
    expect(mockShow).not.toHaveBeenCalled();

    posAtCoordsSpy.mockRestore();
  });

  it("hover does nothing when cursor is inside an image (cursor-based preview takes priority)", async () => {
    mockIsOpen = false;
    const content = "![alt](image.png)";
    // Cursor inside the image — this triggers cursor-based preview
    activeView = createView(content, 5);

    await flushRaf();
    mockShow.mockClear();

    // Mock posAtCoords for hover
    const posAtCoordsSpy = vi.spyOn(activeView, "posAtCoords").mockReturnValue(10);

    const moveEvent = new MouseEvent("mousemove", {
      clientX: 80, clientY: 10, bubbles: true,
    });
    activeView.dom.dispatchEvent(moveEvent);

    // currentImageRange is set, so hover is skipped
    expect(mockShow).not.toHaveBeenCalled();

    posAtCoordsSpy.mockRestore();
  });

  it("hover clears preview when posAtCoords returns null", async () => {
    mockIsOpen = false;
    const content = "text ![alt](image.png) more text";
    activeView = createView(content, content.length);

    await flushRaf();
    mockHideImagePreview.mockClear();

    // posAtCoords returns null (mouse outside editor area)
    const posAtCoordsSpy = vi.spyOn(activeView, "posAtCoords").mockReturnValue(null);

    const moveEvent = new MouseEvent("mousemove", {
      clientX: -10, clientY: -10, bubbles: true,
    });
    activeView.dom.dispatchEvent(moveEvent);

    // clearHoverPreview should be called (but no hoverImageRange was set, so no actual hide)
    posAtCoordsSpy.mockRestore();
  });

  it("hover clears existing hover preview when moving away from image", async () => {
    mockIsOpen = false;
    const content = "text ![alt](image.png) more text";
    activeView = createView(content, content.length);

    await flushRaf();
    mockHideImagePreview.mockClear();
    mockShow.mockClear();

    const posAtCoordsSpy = vi.spyOn(activeView, "posAtCoords");

    // First: hover over image
    posAtCoordsSpy.mockReturnValue(8);
    activeView.dom.dispatchEvent(new MouseEvent("mousemove", {
      clientX: 50, clientY: 10, bubbles: true,
    }));
    expect(mockShow).toHaveBeenCalled();
    mockHideImagePreview.mockClear();

    // Then: hover outside image
    posAtCoordsSpy.mockReturnValue(0);
    activeView.dom.dispatchEvent(new MouseEvent("mousemove", {
      clientX: 5, clientY: 10, bubbles: true,
    }));

    // Should clear hover preview
    expect(mockHideImagePreview).toHaveBeenCalled();

    posAtCoordsSpy.mockRestore();
  });

  it("mouseleave clears hover preview when hoverImageRange is set", async () => {
    mockIsOpen = false;
    const content = "text ![alt](image.png) more text";
    activeView = createView(content, content.length);

    await flushRaf();
    mockHideImagePreview.mockClear();

    const posAtCoordsSpy = vi.spyOn(activeView, "posAtCoords").mockReturnValue(8);

    // Hover over image to set hoverImageRange
    activeView.dom.dispatchEvent(new MouseEvent("mousemove", {
      clientX: 50, clientY: 10, bubbles: true,
    }));
    mockHideImagePreview.mockClear();

    // Mouse leave
    activeView.dom.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));

    // clearHoverPreview should hide since hoverImageRange is set and no currentImageRange
    expect(mockHideImagePreview).toHaveBeenCalled();

    posAtCoordsSpy.mockRestore();
  });

  it("does not show hover preview when coordsAtPos returns null", async () => {
    mockIsOpen = false;
    const content = "text ![alt](image.png) more text";
    activeView = createView(content, content.length);

    await flushRaf();
    mockShow.mockClear();

    const posAtCoordsSpy = vi.spyOn(activeView, "posAtCoords").mockReturnValue(8);
    // Make coordsAtPos return null
    coordsSpy.mockReturnValue(null);

    activeView.dom.dispatchEvent(new MouseEvent("mousemove", {
      clientX: 50, clientY: 10, bubbles: true,
    }));

    // showPreviewForRange should return early because coords are null
    expect(mockShow).not.toHaveBeenCalled();

    posAtCoordsSpy.mockRestore();
    // Restore coords for other tests
    coordsSpy.mockReturnValue({ top: 100, left: 50, bottom: 120, right: 200 });
  });

  it("update triggers scheduleCheck on selectionSet", async () => {
    mockIsOpen = false;
    const content = "![alt](image.png)";
    activeView = createView(content, 0);

    await flushRaf();
    mockShow.mockClear();
    mockHideImagePreview.mockClear();

    // Move cursor into the image
    activeView.dispatch({
      selection: { anchor: 5 },
    });

    await flushRaf();

    // After cursor move into image, preview should show
    expect(mockShow).toHaveBeenCalled();
  });

  it("update triggers scheduleCheck on docChanged", async () => {
    mockIsOpen = false;
    const content = "text";
    activeView = createView(content, 0);

    await flushRaf();
    mockShow.mockClear();
    mockHideImagePreview.mockClear();

    // Insert image syntax at cursor
    activeView.dispatch({
      changes: { from: 0, to: 0, insert: "![alt](image.png) " },
      selection: { anchor: 5 },
    });

    await flushRaf();

    // After doc change with cursor in new image, preview should show
    expect(mockShow).toHaveBeenCalled();
  });

  it("cleans up event listeners on destroy", async () => {
    const content = "![alt](image.png)";
    activeView = createView(content, 5);
    await flushRaf();

    const removeEventSpy = vi.spyOn(activeView.dom, "removeEventListener");
    activeView.destroy();
    activeView = null;

    // Should remove mousemove and mouseleave listeners
    expect(removeEventSpy).toHaveBeenCalledWith("mousemove", expect.any(Function));
    expect(removeEventSpy).toHaveBeenCalledWith("mouseleave", expect.any(Function));
    removeEventSpy.mockRestore();
  });
});
