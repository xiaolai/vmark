/**
 * Tests for sourceImagePopupPlugin — image detection and data extraction.
 *
 * Tests findImageAtPos, detectImageTrigger, extractImageData,
 * and the plugin factory createSourceImagePopupPlugin.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

// Mock dependencies
vi.mock("@/plugins/sourcePopup", () => ({
  createSourcePopupPlugin: vi.fn((config) => {
    (createSourcePopupPlugin as ReturnType<typeof vi.fn>).__lastConfig = config;
    return {};
  }),
}));

vi.mock("@/stores/mediaPopupStore", () => ({
  useMediaPopupStore: {
    getState: () => ({ isOpen: false, anchorRect: null }),
    subscribe: vi.fn(() => () => {}),
  },
}));

vi.mock("@/plugins/imagePreview/ImagePreviewView", () => ({
  hideImagePreview: vi.fn(),
}));

vi.mock("./SourceImagePopupView", () => ({
  SourceImagePopupView: vi.fn().mockImplementation(() => ({
    destroy: vi.fn(),
  })),
}));

import { createSourcePopupPlugin } from "@/plugins/sourcePopup";
import { createSourceImagePopupPlugin } from "./sourceImagePopupPlugin";
import { hideImagePreview } from "@/plugins/imagePreview/ImagePreviewView";

// Helper to create a CM6 view
function createView(doc: string, cursorPos?: number): EditorView {
  const parent = document.createElement("div");
  const pos = cursorPos ?? 0;
  const state = EditorState.create({
    doc,
    selection: { anchor: pos },
  });
  return new EditorView({ state, parent });
}

describe("createSourceImagePopupPlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls createSourcePopupPlugin with correct config", () => {
    createSourceImagePopupPlugin();

    expect(createSourcePopupPlugin).toHaveBeenCalledTimes(1);
    const config = (createSourcePopupPlugin as ReturnType<typeof vi.fn>).mock.calls[0][0];

    expect(config.triggerOnClick).toBe(true);
    expect(config.triggerOnHover).toBe(false);
    expect(typeof config.detectTrigger).toBe("function");
    expect(typeof config.detectTriggerAtPos).toBe("function");
    expect(typeof config.extractData).toBe("function");
    expect(typeof config.onOpen).toBe("function");
  });

  it("onOpen hides image preview", () => {
    createSourceImagePopupPlugin();
    const config = (createSourcePopupPlugin as ReturnType<typeof vi.fn>).mock.calls[0][0];

    config.onOpen();

    expect(hideImagePreview).toHaveBeenCalled();
  });
});

describe("detectImageTrigger (via plugin config)", () => {
  let detectTrigger: (view: EditorView) => { from: number; to: number } | null;

  beforeEach(() => {
    vi.clearAllMocks();
    createSourceImagePopupPlugin();
    const config = (createSourcePopupPlugin as ReturnType<typeof vi.fn>).mock.calls[0][0];
    detectTrigger = config.detectTrigger;
  });

  it("detects simple image ![alt](path)", () => {
    const doc = "Text ![photo](image.png) end";
    const view = createView(doc, 10); // Inside the image syntax
    const result = detectTrigger(view);

    expect(result).toEqual({ from: 5, to: 24 });
  });

  it("returns null when cursor is not on an image", () => {
    const view = createView("Some plain text", 5);
    const result = detectTrigger(view);

    expect(result).toBeNull();
  });

  it("returns null when there is a selection", () => {
    const parent = document.createElement("div");
    const state = EditorState.create({
      doc: "![alt](path.png)",
      selection: { anchor: 2, head: 10 },
    });
    const view = new EditorView({ state, parent });
    const result = detectTrigger(view);

    expect(result).toBeNull();
    view.destroy();
  });

  it("detects image with title ![alt](path \"title\")", () => {
    const doc = '![photo](image.png "My Title") end';
    const view = createView(doc, 10);
    const result = detectTrigger(view);

    expect(result).toEqual({ from: 0, to: 30 });
  });

  it("detects image with angle bracket path ![alt](<path with spaces>)", () => {
    const doc = "![photo](<path with spaces.png>) end";
    const view = createView(doc, 15);
    const result = detectTrigger(view);

    expect(result).toEqual({ from: 0, to: 32 });
  });

  it("detects image at start of line", () => {
    const doc = "![logo](logo.svg)";
    const view = createView(doc, 0);
    const result = detectTrigger(view);

    expect(result).toEqual({ from: 0, to: 17 });
  });

  it("detects image at end boundary", () => {
    const doc = "![logo](logo.svg)";
    const view = createView(doc, 17); // At the end
    const result = detectTrigger(view);

    expect(result).toEqual({ from: 0, to: 17 });
  });

  it("handles multiple images on same line", () => {
    const doc = "![a](a.png) and ![b](b.png)";
    const view = createView(doc, 20); // Inside second image
    const result = detectTrigger(view);

    expect(result).toEqual({ from: 16, to: 27 });
  });

  it("detects image with empty alt text", () => {
    const doc = "![](image.png)";
    const view = createView(doc, 5);
    const result = detectTrigger(view);

    expect(result).toEqual({ from: 0, to: 14 });
  });

  // RW-5 (L17) — iframe parity in Source media popup
  it("detects an <iframe> embed at cursor", () => {
    const doc = '<iframe src="https://www.youtube.com/embed/abc" width="560" height="315"></iframe>';
    const view = createView(doc, 20); // inside the iframe tag
    const result = detectTrigger(view);

    expect(result).toEqual({ from: 0, to: doc.length });
  });

  // RW-5 (L17) — iframe parity in Source media popup
  it("detects a self-closing <iframe ... /> embed at cursor", () => {
    const doc = '<iframe src="https://player.vimeo.com/video/123" />';
    const view = createView(doc, 10);
    const result = detectTrigger(view);

    expect(result).toEqual({ from: 0, to: doc.length });
  });
});

describe("detectTriggerAtPos (via plugin config)", () => {
  let detectTriggerAtPos: (view: EditorView, pos: number) => { from: number; to: number } | null;

  beforeEach(() => {
    vi.clearAllMocks();
    createSourceImagePopupPlugin();
    const config = (createSourcePopupPlugin as ReturnType<typeof vi.fn>).mock.calls[0][0];
    detectTriggerAtPos = config.detectTriggerAtPos;
  });

  it("detects image at arbitrary position", () => {
    const view = createView("![alt](img.png) text", 0);
    const result = detectTriggerAtPos(view, 5);

    expect(result).toEqual({ from: 0, to: 15 });
  });

  it("returns null when no image at position", () => {
    const view = createView("No images here", 0);
    const result = detectTriggerAtPos(view, 5);

    expect(result).toBeNull();
  });
});

describe("extractImageData (via plugin config)", () => {
  let extractData: (
    view: EditorView,
    range: { from: number; to: number }
  ) => { mediaSrc: string; mediaAlt: string; mediaNodePos: number; mediaNodeType: "image" };

  beforeEach(() => {
    vi.clearAllMocks();
    createSourceImagePopupPlugin();
    const config = (createSourcePopupPlugin as ReturnType<typeof vi.fn>).mock.calls[0][0];
    extractData = config.extractData;
  });

  it("extracts image path and alt text", () => {
    const doc = "![my photo](images/photo.jpg)";
    const view = createView(doc, 5);
    const result = extractData(view, { from: 0, to: 29 });

    expect(result.mediaSrc).toBe("images/photo.jpg");
    expect(result.mediaAlt).toBe("my photo");
    expect(result.mediaNodePos).toBe(0);
    expect(result.mediaNodeType).toBe("image");
  });

  it("extracts angle-bracket path", () => {
    const doc = "![alt](<path with spaces.png>)";
    const view = createView(doc, 5);
    const result = extractData(view, { from: 0, to: 30 });

    expect(result.mediaSrc).toBe("path with spaces.png");
    expect(result.mediaAlt).toBe("alt");
  });

  it("returns defaults when no image found at range", () => {
    const doc = "No image here";
    const view = createView(doc, 3);
    const result = extractData(view, { from: 3, to: 8 });

    expect(result.mediaSrc).toBe("");
    expect(result.mediaAlt).toBe("");
    expect(result.mediaNodePos).toBe(3);
    expect(result.mediaNodeType).toBe("image");
  });

  it("extracts empty alt text", () => {
    const doc = "![](file.png)";
    const view = createView(doc, 0);
    const result = extractData(view, { from: 0, to: 14 });

    expect(result.mediaSrc).toBe("file.png");
    expect(result.mediaAlt).toBe("");
  });

  it("ignores title in extraction", () => {
    const doc = '![alt](img.png "My Title")';
    const view = createView(doc, 5);
    const result = extractData(view, { from: 0, to: 26 });

    expect(result.mediaSrc).toBe("img.png");
    expect(result.mediaAlt).toBe("alt");
  });

  // RW-5 (L17) — iframe parity in Source media popup
  it("extracts the src from an <iframe> embed", () => {
    const doc = '<iframe src="https://www.youtube.com/embed/abc" width="560"></iframe>';
    const view = createView(doc, 20);
    const result = extractData(view, { from: 0, to: doc.length }) as {
      mediaSrc: string;
      mediaAlt: string;
      mediaNodePos: number;
      mediaNodeType: string;
    };

    expect(result.mediaSrc).toBe("https://www.youtube.com/embed/abc");
    expect(result.mediaNodePos).toBe(0);
    expect(result.mediaNodeType).toBe("block_video");
  });
});
