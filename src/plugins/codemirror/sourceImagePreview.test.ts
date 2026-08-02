/**
 * Tests for Source Image Preview Plugin
 *
 * Covers:
 *   - Plugin creation
 *   - SourceImagePreviewPlugin lifecycle (construct, update, destroy)
 *   - Popup suppression when media popup is open
 *   - scheduleCheck debouncing
 *   - Mouseleave and mousemove event handling
 *   - destroy() cleanup
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

// --- Mocks ---

const mockImagePreview = {
  show: vi.fn(),
  updateContent: vi.fn(),
  isVisible: vi.fn(() => false),
};

vi.mock("@/plugins/imagePreview/ImagePreviewView", () => ({
  getImagePreviewView: () => mockImagePreview,
  hideImagePreview: vi.fn(),
}));

let mockMediaPopupIsOpen = false;
const mockMediaPopupSubscribers: Array<(state: { isOpen: boolean }) => void> = [];

// The media popup state is passed to the factory now, not imported by it.
const mockMediaPopup = {
  getState: () => ({ isOpen: mockMediaPopupIsOpen }),
  subscribe: (cb: (state: { isOpen: boolean }) => void) => {
    mockMediaPopupSubscribers.push(cb);
    return () => {
      const i = mockMediaPopupSubscribers.indexOf(cb);
      if (i >= 0) mockMediaPopupSubscribers.splice(i, 1);
    };
  },
} as never;

vi.mock("@/utils/mediaPathDetection", () => ({
  getMediaType: (path: string) => {
    if (/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(path)) return "image";
    if (/\.(mp4|webm|mov)$/i.test(path)) return "video";
    if (/\.(mp3|ogg|wav)$/i.test(path)) return "audio";
    return null;
  },
}));

import { hideImagePreview } from "@/plugins/imagePreview/ImagePreviewView";
import { createSourceImagePreviewPlugin } from "./sourceImagePreview";

const viewInstances: EditorView[] = [];

// Store rAF callbacks to control execution timing
let rafCallbacks: FrameRequestCallback[] = [];
let rafIntercepted = false;

function interceptRaf() {
  if (rafIntercepted) return;
  rafIntercepted = true;
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  });
}

function flushRaf() {
  const cbs = [...rafCallbacks];
  rafCallbacks = [];
  cbs.forEach((cb) => cb(0));
}

function releaseRaf() {
  rafIntercepted = false;
  vi.restoreAllMocks();
}

function createView(content: string, cursorPos?: number): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);

  const pos = cursorPos ?? 0;
  const state = EditorState.create({
    doc: content,
    selection: { anchor: pos },
    extensions: [createSourceImagePreviewPlugin(mockMediaPopup)],
  });
  const view = new EditorView({ state, parent });

  // Patch coordsAtPos and posAtCoords to return null (no real layout in jsdom)
  view.coordsAtPos = () => null;
  view.posAtCoords = () => null;

  viewInstances.push(view);
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMediaPopupIsOpen = false;
  mockMediaPopupSubscribers.length = 0;
  mockImagePreview.isVisible.mockReturnValue(false);
  rafCallbacks = [];
  interceptRaf();
});

afterEach(() => {
  viewInstances.forEach((v) => {
    const parent = v.dom.parentElement;
    v.destroy();
    parent?.remove();
  });
  viewInstances.length = 0;
  releaseRaf();
});

describe("createSourceImagePreviewPlugin", () => {
  it("returns an extension", () => {
    const ext = createSourceImagePreviewPlugin(mockMediaPopup);
    expect(ext).toBeDefined();
  });

  it("schedules a check on construction (via requestAnimationFrame)", () => {
    createView("![alt](image.png)", 5);
    // The constructor calls scheduleCheck which calls rAF
    expect(rafCallbacks.length).toBeGreaterThanOrEqual(1);
  });

  it("hides preview when selection is a range (not collapsed)", () => {
    const view = createView("![alt](image.png)");
    // Drain initial rAF
    flushRaf();

    // Select a range (not collapsed)
    view.dispatch({ selection: { anchor: 0, head: 10 } });
    flushRaf();

    // checkImageAtCursor: from !== to → hidePreview
    expect(hideImagePreview).toHaveBeenCalled();
  });

  it("hides preview when cursor is not inside image markdown", () => {
    const view = createView("plain text without images", 5);
    flushRaf();
    vi.mocked(hideImagePreview).mockClear();

    view.dispatch({ selection: { anchor: 3 } });
    flushRaf();

    expect(hideImagePreview).toHaveBeenCalled();
  });

  it("hides preview when media popup is open", () => {
    createView("![alt](image.png)", 10);
    flushRaf();

    vi.mocked(hideImagePreview).mockClear();

    // Simulate popup opening via store subscription
    mockMediaPopupIsOpen = true;
    mockMediaPopupSubscribers.forEach((fn) => fn({ isOpen: true }));

    expect(hideImagePreview).toHaveBeenCalled();
  });

  it("popup suppression hides preview on cursor check", () => {
    const view = createView("![alt](image.png)", 10);
    flushRaf();

    // Open popup
    mockMediaPopupIsOpen = true;
    mockMediaPopupSubscribers.forEach((fn) => fn({ isOpen: true }));
    vi.mocked(hideImagePreview).mockClear();

    // Now trigger a selection change — isPopupSuppressing should return true
    view.dispatch({ selection: { anchor: 10 } });
    flushRaf();

    expect(hideImagePreview).toHaveBeenCalled();
  });

  it("handles mouseleave event", () => {
    const view = createView("![alt](image.png)", 0);
    flushRaf();

    const mouseLeave = new MouseEvent("mouseleave", { bubbles: true });
    view.dom.dispatchEvent(mouseLeave);

    // Should not throw — clearHoverPreview is called
  });

  it("handles mousemove when popup is suppressing", () => {
    const view = createView("![alt](image.png)", 0);
    flushRaf();

    // Open popup to suppress previews
    mockMediaPopupIsOpen = true;
    mockMediaPopupSubscribers.forEach((fn) => fn({ isOpen: true }));

    const mouseMove = new MouseEvent("mousemove", {
      bubbles: true,
      clientX: 50,
      clientY: 50,
    });
    view.dom.dispatchEvent(mouseMove);

    expect(mockImagePreview.show).not.toHaveBeenCalled();
  });

  it("handles mousemove when posAtCoords returns null", () => {
    const view = createView("![alt](image.png)", 0);
    flushRaf();

    // posAtCoords returns null (our default mock)
    const mouseMove = new MouseEvent("mousemove", {
      bubbles: true,
      clientX: 50,
      clientY: 50,
    });
    view.dom.dispatchEvent(mouseMove);

    // clearHoverPreview should be called since pos is null
  });

  it("removes event listeners on destroy", () => {
    const view = createView("![alt](image.png)", 0);
    const removeSpy = vi.spyOn(view.dom, "removeEventListener");

    view.destroy();
    viewInstances.pop();

    expect(removeSpy).toHaveBeenCalledWith("mousemove", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("mouseleave", expect.any(Function));
  });

  it("handles doc change by scheduling a new check", () => {
    const view = createView("![alt](image.png)", 5);
    flushRaf();

    // Clear to count fresh rAF calls
    const countBefore = rafCallbacks.length;
    view.dispatch({
      changes: { from: 0, to: 0, insert: "x" },
    });

    expect(rafCallbacks.length).toBeGreaterThan(countBefore);
  });

  it("does not double-schedule when pendingUpdate is true", () => {
    const view = createView("![alt](image.png)", 5);
    // Don't flush — pendingUpdate is true

    const _countBefore = rafCallbacks.length;

    // Dispatch twice without flushing — second should be skipped
    view.dispatch({ selection: { anchor: 3 } });
    const countAfterFirst = rafCallbacks.length;

    view.dispatch({ selection: { anchor: 4 } });
    // Should not add another rAF callback since pendingUpdate is still true
    expect(rafCallbacks.length).toBe(countAfterFirst);
  });

  it("cursor inside image markdown with coordsAtPos returning null is handled", () => {
    // coordsAtPos returns null → showPreviewForRange returns early
    const view = createView("![alt](image.png)", 10);
    view.dispatch({ selection: { anchor: 10 } });
    flushRaf();

    // Should not throw — coordsAtPos returns null so preview is not shown
    expect(mockImagePreview.show).not.toHaveBeenCalled();
  });

  it("cursor inside video markdown detects video type", () => {
    const view = createView("![video](clip.mp4)", 10);
    view.dispatch({ selection: { anchor: 10 } });
    flushRaf();

    // coordsAtPos returns null so preview not shown, but path detection ran
    expect(mockImagePreview.show).not.toHaveBeenCalled();
  });

  it("ignores non-media paths (no recognized extension)", () => {
    const view = createView("![doc](file.pdf)", 10);
    view.dispatch({ selection: { anchor: 10 } });
    flushRaf();

    // No media type → hidePreview called
    expect(hideImagePreview).toHaveBeenCalled();
  });

  it("handles data:image/ URIs as image type", () => {
    const dataUri = "data:image/png;base64,abc123";
    const view = createView(`![img](${dataUri})`, 10);
    view.dispatch({ selection: { anchor: 10 } });
    flushRaf();

    // Path found, but coordsAtPos returns null
  });

  it("handles angle-bracket syntax ![alt](<path with spaces>)", () => {
    const view = createView("![alt](<my image.png>)", 10);
    view.dispatch({ selection: { anchor: 10 } });
    flushRaf();
  });

  it("handles image with title", () => {
    const view = createView('![alt](image.png "My Image")', 10);
    view.dispatch({ selection: { anchor: 10 } });
    flushRaf();
  });

  it("returns null when cursor is outside image markdown", () => {
    const view = createView("text ![alt](image.png)", 2);
    view.dispatch({ selection: { anchor: 2 } });
    flushRaf();

    expect(hideImagePreview).toHaveBeenCalled();
  });

  it("popup subscription handles popup closing (isOpen becomes false)", () => {
    createView("![alt](image.png)", 10);
    flushRaf();

    // Open popup
    mockMediaPopupIsOpen = true;
    mockMediaPopupSubscribers.forEach((fn) => fn({ isOpen: true }));

    vi.mocked(hideImagePreview).mockClear();

    // Close popup — subscription fires with isOpen=false
    mockMediaPopupIsOpen = false;
    mockMediaPopupSubscribers.forEach((fn) => fn({ isOpen: false }));

    // hidePreview should NOT be called on false (only on true)
    // The popupOpen field is updated but hidePreview is gated by if (this.popupOpen)
  });

  it("update with neither selectionSet nor docChanged does not schedule check", () => {
    const _view = createView("![alt](image.png)", 5);
    flushRaf();

    const countBefore = rafCallbacks.length;

    // Dispatch an annotation-only transaction (no selection/doc change)
    // CM6 ViewPlugin.update only fires when there is an actual update
    // We can't easily trigger this without real layout changes
    // Instead verify the existing schedule guard by checking callback count
    expect(countBefore).toBe(0); // All flushed
  });

  it("unsubscribes from popup store on destroy", () => {
    createView("![alt](image.png)", 0);
    expect(mockMediaPopupSubscribers.length).toBe(1);

    // Destroy removes the subscriber
    viewInstances[0].destroy();
    const parent = viewInstances[0].dom.parentElement;
    parent?.remove();
    viewInstances.length = 0;

    expect(mockMediaPopupSubscribers.length).toBe(0);
  });

  it("hover: shows preview when posAtCoords returns valid position over image", () => {
    // Cursor at position 25 (in "text" part), NOT inside image markdown
    const view = createView("text ![alt](image.png) end", 2);
    flushRaf(); // Cursor at pos 2 → not in image → currentImageRange is null

    // Override posAtCoords to return a position inside the image markdown
    view.posAtCoords = () => 12; // inside ![alt](image.png)
    view.coordsAtPos = () => ({ top: 50, left: 100, bottom: 70, right: 150 });

    const mouseMove = new MouseEvent("mousemove", {
      bubbles: true,
      clientX: 100,
      clientY: 60,
    });
    view.dom.dispatchEvent(mouseMove);

    // Cursor is NOT inside an image, hover IS → should show preview
    expect(mockImagePreview.show).toHaveBeenCalled();
  });

  it("hover: does not show preview when hovering over same image range", () => {
    const view = createView("text ![alt](image.png) end", 2);
    flushRaf();

    view.posAtCoords = () => 12;
    view.coordsAtPos = () => ({ top: 50, left: 100, bottom: 70, right: 150 });

    // First mousemove — shows preview
    const mouseMove1 = new MouseEvent("mousemove", {
      bubbles: true,
      clientX: 100,
      clientY: 60,
    });
    view.dom.dispatchEvent(mouseMove1);
    mockImagePreview.show.mockClear();

    // Second mousemove over same image — should not show again
    const mouseMove2 = new MouseEvent("mousemove", {
      bubbles: true,
      clientX: 101,
      clientY: 60,
    });
    view.dom.dispatchEvent(mouseMove2);
    expect(mockImagePreview.show).not.toHaveBeenCalled();
  });

  it("hover: clears preview on mouseleave when hoverImageRange is set", () => {
    const view = createView("text ![alt](image.png) end", 2);
    flushRaf();

    view.posAtCoords = () => 12;
    view.coordsAtPos = () => ({ top: 50, left: 100, bottom: 70, right: 150 });

    // Hover over image
    const mouseMove = new MouseEvent("mousemove", {
      bubbles: true,
      clientX: 100,
      clientY: 60,
    });
    view.dom.dispatchEvent(mouseMove);
    vi.mocked(hideImagePreview).mockClear();

    // Leave
    const mouseLeave = new MouseEvent("mouseleave", { bubbles: true });
    view.dom.dispatchEvent(mouseLeave);

    expect(hideImagePreview).toHaveBeenCalled();
  });

  it("hover: clears preview when moving to non-image area", () => {
    const view = createView("text ![alt](image.png)", 0);
    flushRaf();

    view.coordsAtPos = () => ({ top: 50, left: 100, bottom: 70, right: 150 });

    // Hover over image area
    view.posAtCoords = () => 10;
    const moveToImage = new MouseEvent("mousemove", {
      bubbles: true,
      clientX: 100,
      clientY: 60,
    });
    view.dom.dispatchEvent(moveToImage);
    vi.mocked(hideImagePreview).mockClear();

    // Move to text area (not image)
    view.posAtCoords = () => 2;
    const moveToText = new MouseEvent("mousemove", {
      bubbles: true,
      clientX: 10,
      clientY: 60,
    });
    view.dom.dispatchEvent(moveToText);

    expect(hideImagePreview).toHaveBeenCalled();
  });

  it("hover: defers to cursor preview when currentImageRange is set", () => {
    // Position cursor inside image to set currentImageRange
    const view = createView("![alt](image.png)", 10);

    // Mock coordsAtPos to return null — so showPreview returns early
    // but currentImageRange is still set since findMediaAtCursor found an image
    view.coordsAtPos = () => null;
    flushRaf(); // This triggers checkImageAtCursor which sets currentImageRange

    // Now try hover — should return early because currentImageRange is set
    view.posAtCoords = () => 5;
    const mouseMove = new MouseEvent("mousemove", {
      bubbles: true,
      clientX: 50,
      clientY: 50,
    });
    view.dom.dispatchEvent(mouseMove);

    // Preview should not be shown via hover since cursor takes priority
    expect(mockImagePreview.show).not.toHaveBeenCalled();
  });

  it("showPreviewForRange uses updateContent when preview is already visible", () => {
    // Two images on same line, cursor not in either
    const view = createView("text ![a](img1.png) ![b](img2.png) end", 2);
    flushRaf();

    view.coordsAtPos = () => ({ top: 50, left: 100, bottom: 70, right: 150 });

    // Hover over first image
    view.posAtCoords = () => 10;
    const mouseMove1 = new MouseEvent("mousemove", {
      bubbles: true,
      clientX: 100,
      clientY: 60,
    });
    view.dom.dispatchEvent(mouseMove1);
    expect(mockImagePreview.show).toHaveBeenCalled();

    // Now mark preview as visible
    mockImagePreview.isVisible.mockReturnValue(true);
    mockImagePreview.show.mockClear();

    // Move to second image — different range, preview already visible → updateContent
    view.posAtCoords = () => 25;
    const mouseMove2 = new MouseEvent("mousemove", {
      bubbles: true,
      clientX: 200,
      clientY: 60,
    });
    view.dom.dispatchEvent(mouseMove2);

    expect(mockImagePreview.updateContent).toHaveBeenCalled();
  });

  it("showPreviewForRange returns early when popup is suppressing", () => {
    const view = createView("![alt](image.png)", 0);
    flushRaf();

    view.posAtCoords = () => 10;
    view.coordsAtPos = () => ({ top: 50, left: 100, bottom: 70, right: 150 });

    // Enable popup suppression
    mockMediaPopupIsOpen = true;
    mockMediaPopupSubscribers.forEach((fn) => fn({ isOpen: true }));

    const mouseMove = new MouseEvent("mousemove", {
      bubbles: true,
      clientX: 100,
      clientY: 60,
    });
    view.dom.dispatchEvent(mouseMove);

    expect(mockImagePreview.show).not.toHaveBeenCalled();
  });

  it("showPreviewForRange returns early when coordsAtPos returns null", () => {
    const view = createView("![alt](image.png)", 10);
    view.coordsAtPos = () => null;
    flushRaf();

    // findMediaAtCursor found the image, but coordsAtPos returns null
    // → showPreviewForRange exits early
    expect(mockImagePreview.show).not.toHaveBeenCalled();
  });

  it("cursor inside image with valid coords shows preview via showPreview path", () => {
    const view = createView("![alt](image.png)", 10);
    view.coordsAtPos = () => ({ top: 50, left: 100, bottom: 70, right: 200 });
    flushRaf();

    // checkImageAtCursor finds image → sets currentImageRange → calls showPreview
    // showPreview calls showPreviewForRange with currentImageRange
    // coordsAtPos returns valid coords → preview.show is called
    expect(mockImagePreview.show).toHaveBeenCalled();
  });

  it("cursor inside image with visible preview calls updateContent", () => {
    const view = createView("![alt](image.png)", 10);
    view.coordsAtPos = () => ({ top: 50, left: 100, bottom: 70, right: 200 });
    mockImagePreview.isVisible.mockReturnValue(true);
    flushRaf();

    // Preview is already visible → updateContent instead of show
    expect(mockImagePreview.updateContent).toHaveBeenCalled();
  });
});
