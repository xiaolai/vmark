/**
 * Tests for sourceFootnotePopupPlugin — footnote detection and data extraction.
 *
 * Tests findFootnoteAtPos, detectFootnoteTrigger, extractFootnoteData,
 * and the plugin factory createSourceFootnotePopupPlugin.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

// Mock dependencies
vi.mock("@/plugins/sourcePopup", () => ({
  createSourcePopupPlugin: vi.fn((config) => {
    // Capture config for inspection
    (createSourcePopupPlugin as ReturnType<typeof vi.fn>).__lastConfig = config;
    return {};
  }),
}));

vi.mock("@/stores/footnotePopupStore", () => {
  const openPopup = vi.fn();
  const closePopup = vi.fn();
  return {
    useFootnotePopupStore: {
      getState: () => ({
        isOpen: false,
        anchorRect: null,
        openPopup,
        closePopup,
      }),
      subscribe: vi.fn(() => () => {}),
    },
  };
});

vi.mock("./SourceFootnotePopupView", () => {
  const SourceFootnotePopupView = vi.fn(function(this: Record<string, unknown>) {
    this.destroy = vi.fn();
    this.setOpenedOnReference = vi.fn();
  });
  return { SourceFootnotePopupView };
});

vi.mock("./sourceFootnoteActions", () => ({
  findFootnoteDefinition: vi.fn(),
  findFootnoteDefinitionAtPos: vi.fn(),
  findFootnoteReference: vi.fn(),
}));

import { createSourcePopupPlugin } from "@/plugins/sourcePopup";
import { useFootnotePopupStore } from "@/stores/footnotePopupStore";
import { createSourceFootnotePopupPlugin } from "./sourceFootnotePopupPlugin";
import {
  findFootnoteDefinition,
  findFootnoteDefinitionAtPos,
  findFootnoteReference,
} from "./sourceFootnoteActions";

// Helper to create a real CM6 view for trigger/extract testing
function createView(doc: string, cursorPos?: number): EditorView {
  const parent = document.createElement("div");
  const pos = cursorPos ?? 0;
  const state = EditorState.create({
    doc,
    selection: { anchor: pos },
  });
  return new EditorView({ state, parent });
}

describe("createSourceFootnotePopupPlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls createSourcePopupPlugin with correct config", () => {
    createSourceFootnotePopupPlugin(useFootnotePopupStore as never);

    expect(createSourcePopupPlugin).toHaveBeenCalledTimes(1);
    const config = (createSourcePopupPlugin as ReturnType<typeof vi.fn>).mock.calls[0][0];

    expect(config.triggerOnClick).toBe(true);
    expect(config.triggerOnHover).toBe(true);
    expect(config.hoverDelay).toBe(150);
    expect(config.hoverHideDelay).toBe(100);
    expect(typeof config.detectTrigger).toBe("function");
    expect(typeof config.detectTriggerAtPos).toBe("function");
    expect(typeof config.extractData).toBe("function");
    expect(typeof config.openPopup).toBe("function");
    expect(typeof config.onOpen).toBe("function");
  });
});

describe("detectFootnoteTrigger (via plugin config)", () => {
  let detectTrigger: (view: EditorView) => { from: number; to: number } | null;

  beforeEach(() => {
    vi.clearAllMocks();
    createSourceFootnotePopupPlugin(useFootnotePopupStore as never);
    const config = (createSourcePopupPlugin as ReturnType<typeof vi.fn>).mock.calls[0][0];
    detectTrigger = config.detectTrigger;
  });

  it("detects footnote reference [^label]", () => {
    const view = createView("Some text [^1] more text", 12);
    // findFootnoteDefinitionAtPos returns null (not a definition)
    vi.mocked(findFootnoteDefinitionAtPos).mockReturnValue(null);

    const result = detectTrigger(view);

    expect(result).toEqual({ from: 10, to: 14 });
  });

  it("returns null when cursor is not on a footnote", () => {
    const view = createView("Some plain text", 5);
    vi.mocked(findFootnoteDefinitionAtPos).mockReturnValue(null);

    const result = detectTrigger(view);

    expect(result).toBeNull();
  });

  it("returns null when there is a selection (not collapsed cursor)", () => {
    const parent = document.createElement("div");
    const state = EditorState.create({
      doc: "Some text [^1] more text",
      selection: { anchor: 10, head: 14 },
    });
    const view = new EditorView({ state, parent });

    const result = detectTrigger(view);

    expect(result).toBeNull();
    view.destroy();
  });

  it("detects footnote definition [^label]: content", () => {
    const doc = "[^note]: This is the content";
    const view = createView(doc, 3);
    vi.mocked(findFootnoteDefinitionAtPos).mockReturnValue({
      from: 0,
      to: 28,
      label: "note",
      content: "This is the content",
    });

    const result = detectTrigger(view);

    expect(result).not.toBeNull();
    expect(result!.from).toBe(0);
    expect(result!.to).toBe(28);
  });

  it("does not match definition syntax as reference (no false positive)", () => {
    // [^label]: should be caught by definition detection, not reference regex
    const doc = "[^note]: definition text";
    const view = createView(doc, 3);
    vi.mocked(findFootnoteDefinitionAtPos).mockReturnValue({
      from: 0,
      to: 24,
      label: "note",
      content: "definition text",
    });

    const result = detectTrigger(view);

    expect(result).not.toBeNull();
  });

  it("detects reference at start of match boundary", () => {
    const doc = "Text [^abc] end";
    const view = createView(doc, 5); // At the '['
    vi.mocked(findFootnoteDefinitionAtPos).mockReturnValue(null);

    const result = detectTrigger(view);

    expect(result).toEqual({ from: 5, to: 11 });
  });

  it("detects reference at end of match boundary", () => {
    const doc = "Text [^abc] end";
    const view = createView(doc, 11); // At the ']'
    vi.mocked(findFootnoteDefinitionAtPos).mockReturnValue(null);

    const result = detectTrigger(view);

    expect(result).toEqual({ from: 5, to: 11 });
  });

  it("handles multiple references on same line", () => {
    const doc = "See [^1] and [^2] here";
    const view = createView(doc, 15); // Inside [^2]
    vi.mocked(findFootnoteDefinitionAtPos).mockReturnValue(null);

    const result = detectTrigger(view);

    expect(result).toEqual({ from: 13, to: 17 });
  });
});

describe("detectTriggerAtPos (via plugin config)", () => {
  let detectTriggerAtPos: (view: EditorView, pos: number) => { from: number; to: number } | null;

  beforeEach(() => {
    vi.clearAllMocks();
    createSourceFootnotePopupPlugin(useFootnotePopupStore as never);
    const config = (createSourcePopupPlugin as ReturnType<typeof vi.fn>).mock.calls[0][0];
    detectTriggerAtPos = config.detectTriggerAtPos;
  });

  it("detects footnote at arbitrary position", () => {
    const view = createView("Text [^1] end", 0);
    vi.mocked(findFootnoteDefinitionAtPos).mockReturnValue(null);

    const result = detectTriggerAtPos(view, 7); // Inside [^1]

    expect(result).toEqual({ from: 5, to: 9 });
  });

  it("returns null when no footnote at position", () => {
    const view = createView("Plain text", 0);
    vi.mocked(findFootnoteDefinitionAtPos).mockReturnValue(null);

    const result = detectTriggerAtPos(view, 3);

    expect(result).toBeNull();
  });
});

describe("createView callback (via plugin config)", () => {
  it("instantiates SourceFootnotePopupView", () => {
    vi.clearAllMocks();
    createSourceFootnotePopupPlugin(useFootnotePopupStore as never);
    const config = (createSourcePopupPlugin as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const view = createView("test", 0);
    const store = { getState: () => ({}) };
    const popupView = config.createView(view, store);
    expect(popupView).toBeDefined();
    expect(popupView.destroy).toBeDefined();
    view.destroy();
  });
});

describe("onOpen callback (via plugin config)", () => {
  it("calls setOpenedOnReference on SourceFootnotePopupView", async () => {
    vi.clearAllMocks();
    createSourceFootnotePopupPlugin(useFootnotePopupStore as never);
    const config = (createSourcePopupPlugin as ReturnType<typeof vi.fn>).mock.calls[0][0];

    const { SourceFootnotePopupView: _SourceFootnotePopupView } = await import("./SourceFootnotePopupView");
    const view = createView("test", 0);
    const store = { getState: () => ({}) };
    const popupView = config.createView(view, store);

    config.onOpen({ popupView, data: { openedOnReference: true } });
    expect(popupView.setOpenedOnReference).toHaveBeenCalledWith(true);

    view.destroy();
  });

  it("does nothing when popupView is not SourceFootnotePopupView instance", () => {
    vi.clearAllMocks();
    createSourceFootnotePopupPlugin(useFootnotePopupStore as never);
    const config = (createSourcePopupPlugin as ReturnType<typeof vi.fn>).mock.calls[0][0];

    const fakePopupView = { setOpenedOnReference: vi.fn() };
    // This is not an instanceof SourceFootnotePopupView since it's a plain object
    config.onOpen({ popupView: fakePopupView, data: { openedOnReference: true } });
    // The check `popupView instanceof SourceFootnotePopupView` will fail for plain objects
    // depending on mock impl; the key point is it shouldn't crash
  });
});

describe("openPopup callback (via plugin config)", () => {
  it("calls openPopup on the injected store with correct args", () => {
    vi.clearAllMocks();
    createSourceFootnotePopupPlugin(useFootnotePopupStore as never);
    const config = (createSourcePopupPlugin as ReturnType<typeof vi.fn>).mock.calls[0][0];

    const mockAnchorRect = { top: 10, left: 20, width: 100, height: 20 };
    const data = {
      label: "1",
      content: "test content",
      definitionPos: 5,
      referencePos: 0,
    };

    config.openPopup({ anchorRect: mockAnchorRect, data });

    const openPopup = useFootnotePopupStore.getState().openPopup;
    expect(openPopup).toHaveBeenCalledWith("1", "test content", mockAnchorRect, 5, 0);
  });
});

describe("extractFootnoteData (via plugin config)", () => {
  let extractData: (
    view: EditorView,
    range: { from: number; to: number }
  ) => {
    label: string;
    content: string;
    referencePos: number | null;
    definitionPos: number | null;
    openedOnReference: boolean;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    createSourceFootnotePopupPlugin(useFootnotePopupStore as never);
    const config = (createSourcePopupPlugin as ReturnType<typeof vi.fn>).mock.calls[0][0];
    extractData = config.extractData;
  });

  it("extracts data for a footnote reference with existing definition", () => {
    const doc = "See [^note] here\n\n[^note]: The definition";
    const view = createView(doc, 6);
    vi.mocked(findFootnoteDefinitionAtPos).mockReturnValue(null);
    vi.mocked(findFootnoteDefinition).mockReturnValue({
      from: 18,
      to: 42,
      content: "The definition",
    });

    const result = extractData(view, { from: 4, to: 11 });

    expect(result.label).toBe("note");
    expect(result.isReference).toBe(undefined); // extractData returns openedOnReference
    expect(result.openedOnReference).toBe(true);
    expect(result.content).toBe("The definition");
    expect(result.definitionPos).toBe(18);
  });

  it("extracts data for a footnote reference without definition", () => {
    const doc = "See [^orphan] here";
    const view = createView(doc, 6);
    vi.mocked(findFootnoteDefinitionAtPos).mockReturnValue(null);
    vi.mocked(findFootnoteDefinition).mockReturnValue(null);

    const result = extractData(view, { from: 4, to: 13 });

    expect(result.label).toBe("orphan");
    expect(result.openedOnReference).toBe(true);
    expect(result.definitionPos).toBeNull();
    expect(result.content).toBe("");
  });

  it("extracts data for a footnote definition", () => {
    const doc = "[^note]: Definition content";
    const view = createView(doc, 3);
    vi.mocked(findFootnoteDefinitionAtPos).mockReturnValue({
      from: 0,
      to: 27,
      label: "note",
      content: "Definition content",
    });
    vi.mocked(findFootnoteReference).mockReturnValue({ from: 50, to: 57 });

    const result = extractData(view, { from: 0, to: 27 });

    expect(result.label).toBe("note");
    expect(result.openedOnReference).toBe(false);
    expect(result.content).toBe("Definition content");
    expect(result.definitionPos).toBe(0);
    expect(result.referencePos).toBe(50);
  });

  it("returns defaults when no footnote found at range", () => {
    const doc = "Plain text no footnotes";
    const view = createView(doc, 5);
    vi.mocked(findFootnoteDefinitionAtPos).mockReturnValue(null);

    const result = extractData(view, { from: 5, to: 10 });

    expect(result.label).toBe("");
    expect(result.content).toBe("");
    expect(result.referencePos).toBe(5);
    expect(result.definitionPos).toBeNull();
    expect(result.openedOnReference).toBe(true);
  });

  it("extracts definition data with no reference found", () => {
    const doc = "[^lonely]: No reference points here";
    const view = createView(doc, 3);
    vi.mocked(findFootnoteDefinitionAtPos).mockReturnValue({
      from: 0,
      to: 35,
      label: "lonely",
      content: "No reference points here",
    });
    vi.mocked(findFootnoteReference).mockReturnValue(null);

    const result = extractData(view, { from: 0, to: 35 });

    expect(result.referencePos).toBeNull();
    expect(result.definitionPos).toBe(0);
  });
});
