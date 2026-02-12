/**
 * Source Image Preview Tests
 *
 * Tests that the image preview respects imagePopupStore.isOpen state:
 * - Preview is suppressed when the image edit popup is open
 * - Preview shows normally when the popup is closed
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

// Mock imagePopupStore with subscribe support for cached state
let mockIsOpen = false;
const subscribers = new Set<(state: { isOpen: boolean }) => void>();

vi.mock("@/stores/imagePopupStore", () => ({
  useImagePopupStore: {
    getState: () => ({ isOpen: mockIsOpen }),
    subscribe: (cb: (state: { isOpen: boolean }) => void) => {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
  },
}));

vi.mock("@/utils/imagePathDetection", () => ({
  hasImageExtension: vi.fn(() => true),
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
    extensions: [createSourceImagePreviewPlugin()],
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
    coordsSpy.mockClear();
  });

  afterEach(() => {
    activeView?.destroy();
    activeView = null;
  });

  it("does not show preview when imagePopupStore.isOpen is true", async () => {
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

  it("shows preview when imagePopupStore.isOpen is false", async () => {
    mockIsOpen = false;
    const content = "![alt](image.png)";
    activeView = createView(content, 5);

    await flushRaf();

    // Guard did NOT block — coordsAtPos was called to get anchor rect
    expect(coordsSpy).toHaveBeenCalled();
    // show() is called with correct arguments
    expect(mockShow).toHaveBeenCalledWith(
      "image.png",
      expect.objectContaining({ top: 100, left: 50, bottom: 120, right: 200 }),
      activeView!.dom,
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
