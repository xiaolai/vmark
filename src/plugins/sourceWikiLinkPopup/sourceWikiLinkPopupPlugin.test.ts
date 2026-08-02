/**
 * Tests for sourceWikiLinkPopupPlugin — wiki link detection and data extraction.
 *
 * Tests findWikiLinkAtPos, detectWikiLinkTrigger, extractWikiLinkData,
 * and the plugin factory createSourceWikiLinkPopupPlugin.
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

const mockOpenPopup = vi.fn();
const mockClosePopup = vi.fn();

// The popup state is passed to the factory now, not imported by it.
const mockStore = {
  getState: () => ({
    isOpen: false,
    anchorRect: null,
    openPopup: mockOpenPopup,
    closePopup: mockClosePopup,
  }),
  subscribe: vi.fn(() => () => {}),
} as never;

vi.mock("./SourceWikiLinkPopupView", () => ({
  SourceWikiLinkPopupView: vi.fn().mockImplementation(() => ({
    destroy: vi.fn(),
  })),
}));

import { createSourcePopupPlugin } from "@/plugins/sourcePopup";
import { createSourceWikiLinkPopupPlugin } from "./sourceWikiLinkPopupPlugin";

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

describe("createSourceWikiLinkPopupPlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls createSourcePopupPlugin with correct config", () => {
    createSourceWikiLinkPopupPlugin(mockStore);

    expect(createSourcePopupPlugin).toHaveBeenCalledTimes(1);
    const config = (createSourcePopupPlugin as ReturnType<typeof vi.fn>).mock.calls[0][0];

    expect(config.triggerOnClick).toBe(true);
    expect(config.triggerOnHover).toBe(true);
    expect(config.hoverDelay).toBe(300);
    expect(config.hoverHideDelay).toBe(100);
    expect(typeof config.detectTrigger).toBe("function");
    expect(typeof config.detectTriggerAtPos).toBe("function");
    expect(typeof config.extractData).toBe("function");
    expect(typeof config.openPopup).toBe("function");
  });

  it("openPopup calls store openPopup with correct args", () => {
    createSourceWikiLinkPopupPlugin(mockStore);
    const config = (createSourcePopupPlugin as ReturnType<typeof vi.fn>).mock.calls[0][0];

    const anchorRect = { top: 100, left: 50, bottom: 120, right: 200 };
    config.openPopup({
      view: {} as EditorView,
      range: { from: 0, to: 10 },
      anchorRect,
      data: { target: "MyPage", nodePos: 5 },
    });

    expect(mockOpenPopup).toHaveBeenCalledWith(anchorRect, "MyPage", 5);
  });
});

describe("detectWikiLinkTrigger (via plugin config)", () => {
  let detectTrigger: (view: EditorView) => { from: number; to: number } | null;

  beforeEach(() => {
    vi.clearAllMocks();
    createSourceWikiLinkPopupPlugin(mockStore);
    const config = (createSourcePopupPlugin as ReturnType<typeof vi.fn>).mock.calls[0][0];
    detectTrigger = config.detectTrigger;
  });

  it("detects simple wiki link [[target]]", () => {
    const doc = "See [[MyPage]] here";
    const view = createView(doc, 8); // Inside the wiki link
    const result = detectTrigger(view);

    expect(result).toEqual({ from: 4, to: 14 });
  });

  it("detects wiki link with alias [[target|alias]]", () => {
    const doc = "See [[MyPage|display text]] here";
    const view = createView(doc, 10);
    const result = detectTrigger(view);

    expect(result).toEqual({ from: 4, to: 27 });
  });

  it("returns null when cursor is not on a wiki link", () => {
    const view = createView("Some plain text", 5);
    const result = detectTrigger(view);

    expect(result).toBeNull();
  });

  it("returns null when there is a selection", () => {
    const parent = document.createElement("div");
    const state = EditorState.create({
      doc: "See [[Page]] here",
      selection: { anchor: 6, head: 10 },
    });
    const view = new EditorView({ state, parent });
    const result = detectTrigger(view);

    expect(result).toBeNull();
    view.destroy();
  });

  it("detects wiki link at start boundary", () => {
    const doc = "[[Page]] end";
    const view = createView(doc, 0);
    const result = detectTrigger(view);

    expect(result).toEqual({ from: 0, to: 8 });
  });

  it("detects wiki link at end boundary", () => {
    const doc = "[[Page]]";
    const view = createView(doc, 8);
    const result = detectTrigger(view);

    expect(result).toEqual({ from: 0, to: 8 });
  });

  it("handles multiple wiki links on same line", () => {
    const doc = "See [[A]] and [[B]] here";
    //           0123456789012345678901234
    const view = createView(doc, 17); // Inside [[B]]
    const result = detectTrigger(view);

    expect(result).toEqual({ from: 14, to: 19 });
  });

  it("does not detect incomplete wiki link [[target", () => {
    const doc = "See [[incomplete here";
    const view = createView(doc, 8);
    const result = detectTrigger(view);

    expect(result).toBeNull();
  });

  it("detects wiki link with path-like target", () => {
    const doc = "See [[docs/readme]] here";
    const view = createView(doc, 10);
    const result = detectTrigger(view);

    expect(result).toEqual({ from: 4, to: 19 });
  });
});

describe("detectTriggerAtPos (via plugin config)", () => {
  let detectTriggerAtPos: (view: EditorView, pos: number) => { from: number; to: number } | null;

  beforeEach(() => {
    vi.clearAllMocks();
    createSourceWikiLinkPopupPlugin(mockStore);
    const config = (createSourcePopupPlugin as ReturnType<typeof vi.fn>).mock.calls[0][0];
    detectTriggerAtPos = config.detectTriggerAtPos;
  });

  it("detects wiki link at arbitrary position", () => {
    const view = createView("Text [[Page]] end", 0);
    const result = detectTriggerAtPos(view, 8);

    expect(result).toEqual({ from: 5, to: 13 });
  });

  it("returns null when no wiki link at position", () => {
    const view = createView("No wiki links", 0);
    const result = detectTriggerAtPos(view, 5);

    expect(result).toBeNull();
  });
});

describe("extractWikiLinkData (via plugin config)", () => {
  let extractData: (
    view: EditorView,
    range: { from: number; to: number }
  ) => { target: string; nodePos: number };

  beforeEach(() => {
    vi.clearAllMocks();
    createSourceWikiLinkPopupPlugin(mockStore);
    const config = (createSourcePopupPlugin as ReturnType<typeof vi.fn>).mock.calls[0][0];
    extractData = config.extractData;
  });

  it("extracts target from simple wiki link", () => {
    const doc = "[[MyPage]]";
    const view = createView(doc, 3);
    const result = extractData(view, { from: 0, to: 10 });

    expect(result.target).toBe("MyPage");
    expect(result.nodePos).toBe(0);
  });

  it("extracts target from wiki link with alias", () => {
    const doc = "[[MyPage|Display]]";
    const view = createView(doc, 3);
    const result = extractData(view, { from: 0, to: 18 });

    expect(result.target).toBe("MyPage");
    expect(result.nodePos).toBe(0);
  });

  it("returns defaults when no wiki link found at range", () => {
    const doc = "No wiki link";
    const view = createView(doc, 3);
    const result = extractData(view, { from: 3, to: 8 });

    expect(result.target).toBe("");
    expect(result.nodePos).toBe(3);
  });

  it("extracts path-like target", () => {
    const doc = "[[docs/readme]]";
    const view = createView(doc, 3);
    const result = extractData(view, { from: 0, to: 15 });

    expect(result.target).toBe("docs/readme");
  });
});
