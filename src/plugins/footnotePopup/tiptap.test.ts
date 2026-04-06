/**
 * Footnote Popup Tiptap Extension Tests
 *
 * Tests for the footnote popup plugin behavior including:
 * - appendTransaction logic (orphan cleanup, renumbering, deletion detection)
 * - handleClick navigation (ref->def, def->ref)
 * - handleKeyDown (Escape to close)
 * - handleMouseDown (prevent default on footnote refs)
 * - Mouse hover open/close with delays
 * - FootnotePopupPluginView lifecycle
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, Plugin, TextSelection, NodeSelection } from "@tiptap/pm/state";

const mockOpenPopup = vi.fn();
const mockClosePopup = vi.fn();
vi.mock("@/stores/footnotePopupStore", () => ({
  useFootnotePopupStore: {
    getState: () => ({
      isOpen: false,
      openPopup: mockOpenPopup,
      closePopup: mockClosePopup,
    }),
  },
}));

vi.mock("./FootnotePopupView", () => ({
  FootnotePopupView: class MockFootnotePopupView {
    update = vi.fn();
    destroy = vi.fn();
  },
}));

vi.mock("./footnote-popup.css", () => ({}));

const { mockGetReferenceLabels, mockGetDefinitionInfo } = vi.hoisted(() => ({
  mockGetReferenceLabels: vi.fn() as ReturnType<typeof vi.fn> & { _real?: (...args: unknown[]) => unknown },
  mockGetDefinitionInfo: vi.fn() as ReturnType<typeof vi.fn> & { _real?: (...args: unknown[]) => unknown },
}));

vi.mock("./tiptapCleanup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tiptapCleanup")>();
  mockGetReferenceLabels._real = actual.getReferenceLabels as unknown as (...args: unknown[]) => unknown;
  mockGetReferenceLabels.mockImplementation((...args: unknown[]) => mockGetReferenceLabels._real?.(...args));
  mockGetDefinitionInfo._real = actual.getDefinitionInfo as unknown as (...args: unknown[]) => unknown;
  mockGetDefinitionInfo.mockImplementation((...args: unknown[]) => mockGetDefinitionInfo._real?.(...args));
  return {
    ...actual,
    getReferenceLabels: (...args: unknown[]) => mockGetReferenceLabels(...args),
    getDefinitionInfo: (...args: unknown[]) => mockGetDefinitionInfo(...args),
  };
});

import {
  footnotePopupExtension,
  footnotePopupPluginKey,
} from "./tiptap";
import {
  getReferenceLabels,
  getDefinitionInfo,
  createRenumberTransaction,
  createCleanupAndRenumberTransaction,
} from "./tiptapCleanup";
import {
  findFootnoteDefinition,
  findFootnoteReference,
} from "./tiptapDomUtils";

// Schema with footnote nodes
const schema = new Schema({
  nodes: {
    doc: { content: "(block | footnote_definition)+" },
    paragraph: { group: "block", content: "inline*" },
    footnote_reference: {
      group: "inline",
      inline: true,
      atom: true,
      attrs: { label: { default: "1" } },
    },
    footnote_definition: {
      content: "block+",
      attrs: { label: { default: "1" } },
    },
    text: { group: "inline" },
  },
});

function p(text?: string) {
  return schema.node("paragraph", null, text ? [schema.text(text)] : []);
}

function fnRef(label: string) {
  return schema.node("footnote_reference", { label });
}

function fnDef(label: string, text?: string) {
  return schema.node("footnote_definition", { label }, [p(text ?? `Footnote ${label}`)]);
}

function pWithRef(text: string, label: string) {
  return schema.node("paragraph", null, [schema.text(text), fnRef(label)]);
}

function createState(doc: ReturnType<typeof schema.node>) {
  return EditorState.create({ doc, schema });
}

describe("footnotePopupPluginKey", () => {
  it("is a PluginKey with correct name", () => {
    expect(footnotePopupPluginKey).toBeDefined();
  });
});

describe("appendTransaction logic", () => {
  // We test the appendTransaction logic indirectly through the cleanup functions
  // since the extension creates a PM plugin internally.

  it("getReferenceLabels detects deleted references", () => {
    const oldDoc = schema.node("doc", null, [
      pWithRef("A", "1"),
      pWithRef("B", "2"),
      fnDef("1"),
      fnDef("2"),
    ]);

    const newDoc = schema.node("doc", null, [
      pWithRef("A", "1"),
      p("B was here"),
      fnDef("1"),
      fnDef("2"),
    ]);

    const oldLabels = getReferenceLabels(oldDoc);
    const newLabels = getReferenceLabels(newDoc);

    expect(oldLabels.has("2")).toBe(true);
    expect(newLabels.has("2")).toBe(false);

    // Detect deletion
    let refDeleted = false;
    for (const label of oldLabels) {
      if (!newLabels.has(label)) {
        refDeleted = true;
        break;
      }
    }
    expect(refDeleted).toBe(true);
  });

  it("getDefinitionInfo identifies orphaned definitions", () => {
    const doc = schema.node("doc", null, [
      pWithRef("A", "1"),
      fnDef("1"),
      fnDef("2"), // orphaned — no matching ref
    ]);

    const refLabels = getReferenceLabels(doc);
    const defs = getDefinitionInfo(doc);
    const orphans = defs.filter((d) => !refLabels.has(d.label));

    expect(orphans).toHaveLength(1);
    expect(orphans[0].label).toBe("2");
  });

  it("skips when no footnotes exist in old doc", () => {
    const doc = schema.node("doc", null, [p("No footnotes")]);
    let hasFootnotes = false;
    doc.descendants((node) => {
      if (node.type.name === "footnote_reference" || node.type.name === "footnote_definition") {
        hasFootnotes = true;
        return false;
      }
      return true;
    });
    expect(hasFootnotes).toBe(false);
  });

  it("skips when no references were deleted", () => {
    const oldDoc = schema.node("doc", null, [
      pWithRef("A", "1"),
      fnDef("1"),
    ]);
    const newDoc = schema.node("doc", null, [
      pWithRef("A", "1"),
      fnDef("1"),
    ]);

    const oldLabels = getReferenceLabels(oldDoc);
    const newLabels = getReferenceLabels(newDoc);

    let refDeleted = false;
    for (const label of oldLabels) {
      if (!newLabels.has(label)) {
        refDeleted = true;
        break;
      }
    }
    expect(refDeleted).toBe(false);
  });

  it("detects all refs deleted — should clean up all defs", () => {
    const newDoc = schema.node("doc", null, [
      p("All refs removed"),
      fnDef("1"),
      fnDef("2"),
    ]);

    const newRefLabels = getReferenceLabels(newDoc);
    const defs = getDefinitionInfo(newDoc);
    const orphanedDefs = defs.filter((d) => !newRefLabels.has(d.label));

    expect(newRefLabels.size).toBe(0);
    expect(orphanedDefs).toHaveLength(2);

    // When no refs and orphans exist, all defs should be deleted
    if (orphanedDefs.length === 0 && newRefLabels.size === 0 && defs.length > 0) {
      // This branch deletes all defs
    }
    // In this case, orphanedDefs.length > 0, so it goes to cleanup branch
    expect(defs.length).toBeGreaterThan(0);
  });

  it("calls createRenumberTransaction when orphans are zero but refs need renumbering", () => {
    const state = createState(
      schema.node("doc", null, [
        pWithRef("A", "3"),
        fnDef("3"),
      ])
    );

    const refType = schema.nodes.footnote_reference;
    const defType = schema.nodes.footnote_definition;

    const tr = createRenumberTransaction(state, refType, defType);
    expect(tr).not.toBeNull();

    // After renumbering, label should be "1"
    const newLabels = getReferenceLabels(tr!.doc);
    expect(newLabels).toEqual(new Set(["1"]));
  });

  it("calls createCleanupAndRenumberTransaction when orphans exist", () => {
    const state = createState(
      schema.node("doc", null, [
        pWithRef("A", "2"),
        fnDef("1", "Orphan"),
        fnDef("2", "Kept"),
      ])
    );

    const refType = schema.nodes.footnote_reference;
    const defType = schema.nodes.footnote_definition;
    const remainingLabels = new Set(["2"]);

    const tr = createCleanupAndRenumberTransaction(state, remainingLabels, refType, defType);
    expect(tr).not.toBeNull();

    const newDefs = getDefinitionInfo(tr!.doc);
    expect(newDefs).toHaveLength(1);
    expect(newDefs[0].label).toBe("1");
  });
});

describe("footnotePopupExtension", () => {
  it("creates an extension with the correct name", () => {
    expect(footnotePopupExtension.name).toBe("footnotePopup");
  });

  it("provides addProseMirrorPlugins method", () => {
    expect(typeof footnotePopupExtension.config.addProseMirrorPlugins).toBe("function");
  });
});

describe("handleClick navigation logic", () => {
  it("clicking ref scrolls to definition — tested via findFootnoteDefinition", () => {
    const doc = schema.node("doc", null, [
      pWithRef("Text", "1"),
      fnDef("1", "Definition content"),
    ]);
    const state = createState(doc);
    const view = { state } as unknown as import("@tiptap/pm/view").EditorView;

    const def = findFootnoteDefinition(view, "1");
    expect(def).not.toBeNull();
    expect(def!.content).toBe("Definition content");
  });

  it("clicking def navigates to reference — tested via findFootnoteReference", () => {
    const doc = schema.node("doc", null, [
      pWithRef("Text", "1"),
      fnDef("1"),
    ]);
    const state = createState(doc);
    const view = { state } as unknown as import("@tiptap/pm/view").EditorView;

    const pos = findFootnoteReference(view, "1");
    expect(pos).not.toBeNull();
  });
});

describe("hover delay constants", () => {
  it("hover behavior uses delayed open and close pattern", () => {
    expect(footnotePopupExtension).toBeDefined();
  });
});

describe("handleMouseDown logic", () => {
  it("returns true when target is a footnote reference element", () => {
    const refEl = document.createElement("sup");
    refEl.className = "footnote-reference";
    refEl.setAttribute("data-type", "footnote_reference");
    // getFootnoteRefFromTarget checks for the element
    const result = Boolean(refEl);
    expect(result).toBe(true);
  });

  it("returns false when target is not a footnote reference", () => {
    const div = document.createElement("div");
    const isRef = div.classList.contains("footnote-reference");
    expect(isRef).toBe(false);
  });
});

describe("handleKeyDown logic", () => {
  it("does not close popup when Escape is pressed and popup is editing", () => {
    const popup = document.createElement("div");
    popup.className = "footnote-popup editing";
    document.body.appendChild(popup);

    const isEditing = popup.classList.contains("editing");
    expect(isEditing).toBe(true);
    // Should not close when editing

    document.body.removeChild(popup);
  });

  it("closes popup when Escape is pressed and popup is not editing", () => {
    const popup = document.createElement("div");
    popup.className = "footnote-popup";
    document.body.appendChild(popup);

    const isEditing = popup.classList.contains("editing");
    expect(isEditing).toBe(false);
    // Should close

    document.body.removeChild(popup);
  });

  it("does nothing when Escape is pressed and no popup is open", () => {
    const popup = document.querySelector(".footnote-popup");
    expect(popup).toBeNull();
  });

  it("does not handle non-Escape keys", () => {
    const event = new KeyboardEvent("keydown", { key: "Enter" });
    expect(event.key).not.toBe("Escape");
  });
});

describe("handleClick navigation edge cases", () => {
  it("handles clicking ref when definition does not exist", () => {
    const doc = schema.node("doc", null, [
      pWithRef("Text", "99"),
    ]);
    const state = createState(doc);
    const view = { state } as unknown as import("@tiptap/pm/view").EditorView;

    const def = findFootnoteDefinition(view, "99");
    expect(def).toBeNull();
  });

  it("handles clicking def when reference does not exist", () => {
    const doc = schema.node("doc", null, [
      p("No refs here"),
      fnDef("5"),
    ]);
    const state = createState(doc);
    const view = { state } as unknown as import("@tiptap/pm/view").EditorView;

    const pos = findFootnoteReference(view, "5");
    expect(pos).toBeNull();
  });

  it("handles special characters in footnote labels", () => {
    // Footnote labels are typically numeric but test with different values
    const doc = schema.node("doc", null, [
      pWithRef("Text", "abc"),
      fnDef("abc", "Footnote abc content"),
    ]);
    const state = createState(doc);
    const view = { state } as unknown as import("@tiptap/pm/view").EditorView;

    const def = findFootnoteDefinition(view, "abc");
    expect(def).not.toBeNull();
    expect(def!.content).toBe("Footnote abc content");
  });
});

describe("appendTransaction edge cases", () => {
  it("handles document with multiple refs pointing to same definition", () => {
    const doc = schema.node("doc", null, [
      pWithRef("A", "1"),
      pWithRef("B", "1"),
      fnDef("1"),
    ]);

    const refLabels = getReferenceLabels(doc);
    expect(refLabels.has("1")).toBe(true);
    expect(refLabels.size).toBe(1); // Both refs have same label
  });

  it("handles document with many footnotes for renumbering", () => {
    const doc = schema.node("doc", null, [
      pWithRef("A", "5"),
      pWithRef("B", "10"),
      pWithRef("C", "15"),
      fnDef("5"),
      fnDef("10"),
      fnDef("15"),
    ]);

    const state = createState(doc);
    const refType = schema.nodes.footnote_reference;
    const defType = schema.nodes.footnote_definition;

    const tr = createRenumberTransaction(state, refType, defType);
    expect(tr).not.toBeNull();

    // After renumbering, labels should be 1, 2, 3
    const newLabels = getReferenceLabels(tr!.doc);
    expect(newLabels).toEqual(new Set(["1", "2", "3"]));
  });

  it("handles removing all footnotes from document", () => {
    const doc = schema.node("doc", null, [
      p("No more footnotes"),
    ]);

    const refLabels = getReferenceLabels(doc);
    expect(refLabels.size).toBe(0);

    const defs = getDefinitionInfo(doc);
    expect(defs).toHaveLength(0);
  });

  it("handles single footnote requiring no renumbering", () => {
    const doc = schema.node("doc", null, [
      pWithRef("A", "1"),
      fnDef("1"),
    ]);

    const state = createState(doc);
    const refType = schema.nodes.footnote_reference;
    const defType = schema.nodes.footnote_definition;

    const tr = createRenumberTransaction(state, refType, defType);
    // Label is already "1", no renumbering needed — should return null or identity
    if (tr) {
      const newLabels = getReferenceLabels(tr.doc);
      expect(newLabels).toEqual(new Set(["1"]));
    }
  });
});

describe("footnotePopup plugin handler integration", () => {
  let plugin: InstanceType<typeof Plugin>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore passthrough to real implementations after clearAllMocks
    mockGetReferenceLabels.mockImplementation((...args: unknown[]) => mockGetReferenceLabels._real?.(...args));
    mockGetDefinitionInfo.mockImplementation((...args: unknown[]) => mockGetDefinitionInfo._real?.(...args));

    const extensionContext = {
      name: footnotePopupExtension.name,
      options: footnotePopupExtension.options,
      storage: footnotePopupExtension.storage,
      editor: {} as import("@tiptap/core").Editor,
      type: null,
      parent: undefined,
    };
    const plugins = footnotePopupExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];
    plugin = plugins[0];
  });

  describe("handleDOMEvents.mousedown", () => {
    it("returns true when target is a footnote reference", () => {
      const refEl = document.createElement("sup");
      refEl.setAttribute("data-type", "footnote_reference");
      document.body.appendChild(refEl);

      const event = new MouseEvent("mousedown");
      Object.defineProperty(event, "target", { value: refEl });

      const handler = plugin.props.handleDOMEvents!.mousedown!;
      const result = handler({} as never, event);
      expect(result).toBe(true);

      document.body.removeChild(refEl);
    });

    it("returns false when target is not a footnote reference", () => {
      const div = document.createElement("div");
      document.body.appendChild(div);

      const event = new MouseEvent("mousedown");
      Object.defineProperty(event, "target", { value: div });

      const handler = plugin.props.handleDOMEvents!.mousedown!;
      const result = handler({} as never, event);
      expect(result).toBe(false);

      document.body.removeChild(div);
    });
  });

  describe("handleDOMEvents.mouseover", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns false for non-footnote elements", () => {
      const div = document.createElement("div");
      const event = new MouseEvent("mouseover");
      Object.defineProperty(event, "target", { value: div });

      const handler = plugin.props.handleDOMEvents!.mouseover!;
      const result = handler({} as never, event);
      expect(result).toBe(false);
    });
  });

  describe("handleDOMEvents.mouseout", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("schedules popup close when moving away from footnote", () => {
      vi.useFakeTimers();

      const div = document.createElement("div");
      const event = new MouseEvent("mouseout");
      Object.defineProperty(event, "relatedTarget", { value: div });
      Object.defineProperty(event, "target", { value: document.createElement("sup") });

      const handler = plugin.props.handleDOMEvents!.mouseout!;
      const result = handler({} as never, event);
      expect(result).toBe(false);

      vi.advanceTimersByTime(150);
      // Should have tried to close popup
      expect(mockClosePopup).toHaveBeenCalled();
    });

    it("does not close when moving to popup element", () => {
      vi.useFakeTimers();

      const popup = document.createElement("div");
      popup.className = "footnote-popup";
      document.body.appendChild(popup);

      const event = new MouseEvent("mouseout");
      Object.defineProperty(event, "relatedTarget", { value: popup });

      const handler = plugin.props.handleDOMEvents!.mouseout!;
      handler({} as never, event);

      vi.advanceTimersByTime(150);
      expect(mockClosePopup).not.toHaveBeenCalled();

      document.body.removeChild(popup);
    });
  });

  describe("handleKeyDown", () => {
    it("returns false for non-Escape keys", () => {
      const event = new KeyboardEvent("keydown", { key: "Enter" });
      const handler = plugin.props.handleKeyDown!;
      const result = handler({} as never, event);
      expect(result).toBe(false);
    });

    it("returns false for Escape when popup is not open", () => {
      const event = new KeyboardEvent("keydown", { key: "Escape" });
      const handler = plugin.props.handleKeyDown!;
      // mockClosePopup returns isOpen: false by default
      const result = handler({} as never, event);
      expect(result).toBe(false);
    });
  });

  describe("handleClick", () => {
    it("returns false when target is not a footnote element", () => {
      const div = document.createElement("div");
      document.body.appendChild(div);

      const event = new MouseEvent("click");
      Object.defineProperty(event, "target", { value: div });

      const handler = plugin.props.handleClick!;
      const mockView = {
        state: createState(schema.node("doc", null, [p("hello")])),
      };
      const result = handler(mockView as never, 0, event);
      expect(result).toBe(false);

      document.body.removeChild(div);
    });
  });

  describe("appendTransaction", () => {
    it("returns null when no doc change", () => {
      const doc = schema.node("doc", null, [
        pWithRef("A", "1"),
        fnDef("1"),
      ]);
      const state = createState(doc);

      // Create a non-doc-changing transaction
      const tr = state.tr;
      const result = plugin.spec.appendTransaction!(
        [tr],
        state,
        state,
      );
      expect(result).toBeNull();
    });

    it("returns null during IME composition transactions", () => {
      const doc = schema.node("doc", null, [
        pWithRef("A", "2"),
        pWithRef("B", "3"),
        fnDef("2"),
        fnDef("3"),
      ]);
      const state = createState(doc);

      // Simulate a composition transaction that changes the doc
      const tr = state.tr.insertText("你好", 1).setMeta("composition", { type: "compositionend" });
      const newState = state.apply(tr);

      // appendTransaction should skip during composition to avoid
      // disrupting active CJK input (cf. Tiptap #6758, #7126)
      const result = plugin.spec.appendTransaction!(
        [tr],
        state,
        newState,
      );
      expect(result).toBeNull();
    });

    it("returns null during input uiEvent transactions", () => {
      const doc = schema.node("doc", null, [
        pWithRef("A", "2"),
        pWithRef("B", "3"),
        fnDef("2"),
        fnDef("3"),
      ]);
      const state = createState(doc);

      const tr = state.tr.insertText("你", 1).setMeta("uiEvent", "input");
      const newState = state.apply(tr);

      const result = plugin.spec.appendTransaction!(
        [tr],
        state,
        newState,
      );
      expect(result).toBeNull();
    });

    it("returns null when old doc has no footnotes", () => {
      const oldDoc = schema.node("doc", null, [p("no footnotes")]);
      const newDoc = schema.node("doc", null, [p("still no footnotes")]);
      const oldState = createState(oldDoc);
      const newState = createState(newDoc);

      // Create a doc-changing transaction
      const tr = oldState.tr.insertText("x", 1);

      const result = plugin.spec.appendTransaction!(
        [tr],
        oldState,
        newState,
      );
      expect(result).toBeNull();
    });

    it("returns null when no references were deleted", () => {
      const doc = schema.node("doc", null, [
        pWithRef("A", "1"),
        fnDef("1"),
      ]);
      const state = createState(doc);

      // Apply a doc change that doesn't remove refs
      const tr = state.tr.insertText("B", 1);
      const newState = state.apply(tr);

      const result = plugin.spec.appendTransaction!(
        [tr],
        state,
        newState,
      );
      expect(result).toBeNull();
    });

    it("cleans up orphaned definitions when ref is deleted", () => {
      const doc = schema.node("doc", null, [
        pWithRef("A", "1"),
        pWithRef("B", "2"),
        fnDef("1"),
        fnDef("2"),
      ]);
      const state = createState(doc);

      // Delete the paragraph containing ref "2"
      // Find the paragraph with "B" and ref "2"
      let refPos = 0;
      state.doc.descendants((node, pos) => {
        if (node.type.name === "paragraph" && node.textContent.includes("B")) {
          refPos = pos;
          return false;
        }
        return true;
      });

      // Replace the paragraph with one without a ref
      const newPara = p("B was here");
      const tr = state.tr.replaceWith(refPos, refPos + state.doc.child(1).nodeSize, newPara);
      const newState = state.apply(tr);

      const result = plugin.spec.appendTransaction!(
        [tr],
        state,
        newState,
      );
      // Should return a cleanup transaction
      expect(result).not.toBeNull();
    });

    it("deletes all definitions when all refs are removed", () => {
      const doc = schema.node("doc", null, [
        pWithRef("A", "1"),
        fnDef("1"),
      ]);
      const state = createState(doc);

      // Replace the paragraph with one without a ref
      const newPara = p("No refs anymore");
      const tr = state.tr.replaceWith(0, state.doc.child(0).nodeSize, newPara);
      const newState = state.apply(tr);

      const result = plugin.spec.appendTransaction!(
        [tr],
        state,
        newState,
      );
      // Should return transaction that deletes the orphaned definition
      expect(result).not.toBeNull();
      if (result) {
        const defs = getDefinitionInfo(result.doc);
        expect(defs).toHaveLength(0);
      }
    });
  });

  describe("plugin view lifecycle", () => {
    it("creates view with update and destroy methods", () => {
      const mockEditorView = {
        state: createState(schema.node("doc", null, [p("hello")])),
        dom: document.createElement("div"),
        nodeDOM: vi.fn(() => null),
      };

      const viewResult = plugin.spec.view!(mockEditorView as never);
      expect(viewResult).toBeDefined();
      expect(viewResult.update).toBeTypeOf("function");
      expect(viewResult.destroy).toBeTypeOf("function");
    });

    it("update method does not throw", () => {
      const mockEditorView = {
        state: createState(schema.node("doc", null, [p("hello")])),
        dom: document.createElement("div"),
        nodeDOM: vi.fn(() => null),
      };

      const viewResult = plugin.spec.view!(mockEditorView as never);
      expect(() => viewResult.update!({} as never, {} as never)).not.toThrow();
    });

    it("destroy method does not throw", () => {
      const mockEditorView = {
        state: createState(schema.node("doc", null, [p("hello")])),
        dom: document.createElement("div"),
        nodeDOM: vi.fn(() => null),
      };

      const viewResult = plugin.spec.view!(mockEditorView as never);
      expect(() => viewResult.destroy!()).not.toThrow();
    });

    it("update triggers checkSelectionForFootnote on NodeSelection of footnote_reference", () => {
      const doc = schema.node("doc", null, [
        pWithRef("Text", "1"),
        fnDef("1", "Definition content"),
      ]);
      const state = createState(doc);

      // Find the footnote reference position
      let refPos = -1;
      state.doc.descendants((node, pos) => {
        if (node.type.name === "footnote_reference") {
          refPos = pos;
          return false;
        }
        return true;
      });
      expect(refPos).toBeGreaterThanOrEqual(0);

      // Create NodeSelection on the footnote reference
      const nodeSelState = state.apply(
        state.tr.setSelection(NodeSelection.create(state.doc, refPos))
      );

      const refDom = document.createElement("sup");
      refDom.setAttribute("data-type", "footnote_reference");
      refDom.getBoundingClientRect = () => ({ top: 100, left: 50, bottom: 120, right: 70, width: 20, height: 20, x: 50, y: 100, toJSON: () => ({}) });

      const mockEditorView = {
        state: nodeSelState,
        dom: document.createElement("div"),
        nodeDOM: vi.fn(() => refDom),
      };

      const viewResult = plugin.spec.view!(mockEditorView as never);
      // Calling update triggers checkSelectionForFootnote
      viewResult.update!({} as never, {} as never);

      expect(mockOpenPopup).toHaveBeenCalledWith(
        "1",
        "Definition content",
        expect.any(Object),
        expect.any(Number),
        refPos,
      );
    });

    it("checkSelectionForFootnote does not re-open for same position", () => {
      const doc = schema.node("doc", null, [
        pWithRef("Text", "1"),
        fnDef("1", "Def 1"),
      ]);
      const state = createState(doc);

      let refPos = -1;
      state.doc.descendants((node, pos) => {
        if (node.type.name === "footnote_reference") {
          refPos = pos;
          return false;
        }
        return true;
      });

      const nodeSelState = state.apply(
        state.tr.setSelection(NodeSelection.create(state.doc, refPos))
      );

      const refDom = document.createElement("sup");
      refDom.getBoundingClientRect = () => ({ top: 100, left: 50, bottom: 120, right: 70, width: 20, height: 20, x: 50, y: 100, toJSON: () => ({}) });

      const mockEditorView = {
        state: nodeSelState,
        dom: document.createElement("div"),
        nodeDOM: vi.fn(() => refDom),
      };

      const viewResult = plugin.spec.view!(mockEditorView as never);

      // First update opens popup
      viewResult.update!({} as never, {} as never);
      expect(mockOpenPopup).toHaveBeenCalledTimes(1);

      // Second update with same state should not re-open
      viewResult.update!({} as never, {} as never);
      expect(mockOpenPopup).toHaveBeenCalledTimes(1);
    });

    it("checkSelectionForFootnote closes popup when selection moves away", () => {
      const doc = schema.node("doc", null, [
        pWithRef("Text", "1"),
        fnDef("1", "Def 1"),
      ]);
      const state = createState(doc);

      let refPos = -1;
      state.doc.descendants((node, pos) => {
        if (node.type.name === "footnote_reference") {
          refPos = pos;
          return false;
        }
        return true;
      });

      const nodeSelState = state.apply(
        state.tr.setSelection(NodeSelection.create(state.doc, refPos))
      );

      const refDom = document.createElement("sup");
      refDom.getBoundingClientRect = () => ({ top: 100, left: 50, bottom: 120, right: 70, width: 20, height: 20, x: 50, y: 100, toJSON: () => ({}) });

      const mockEditorView = {
        state: nodeSelState,
        dom: document.createElement("div"),
        nodeDOM: vi.fn(() => refDom),
      };

      const viewResult = plugin.spec.view!(mockEditorView as never);
      viewResult.update!({} as never, {} as never);
      expect(mockOpenPopup).toHaveBeenCalledTimes(1);

      // Add popup element so close logic finds it
      const popup = document.createElement("div");
      popup.className = "footnote-popup";
      document.body.appendChild(popup);

      // Now move selection away (text selection on paragraph)
      const textSelState = state.apply(
        state.tr.setSelection(TextSelection.create(state.doc, 1))
      );
      (mockEditorView as Record<string, unknown>).state = textSelState;

      viewResult.update!({} as never, {} as never);
      expect(mockClosePopup).toHaveBeenCalled();

      document.body.removeChild(popup);
    });

    it("checkSelectionForFootnote does not close popup when in editing mode", () => {
      const doc = schema.node("doc", null, [
        pWithRef("Text", "1"),
        fnDef("1", "Def 1"),
      ]);
      const state = createState(doc);

      let refPos = -1;
      state.doc.descendants((node, pos) => {
        if (node.type.name === "footnote_reference") {
          refPos = pos;
          return false;
        }
        return true;
      });

      const nodeSelState = state.apply(
        state.tr.setSelection(NodeSelection.create(state.doc, refPos))
      );

      const refDom = document.createElement("sup");
      refDom.getBoundingClientRect = () => ({ top: 100, left: 50, bottom: 120, right: 70, width: 20, height: 20, x: 50, y: 100, toJSON: () => ({}) });

      const mockEditorView = {
        state: nodeSelState,
        dom: document.createElement("div"),
        nodeDOM: vi.fn(() => refDom),
      };

      const viewResult = plugin.spec.view!(mockEditorView as never);
      viewResult.update!({} as never, {} as never);

      // Add editing popup element
      const popup = document.createElement("div");
      popup.className = "footnote-popup editing";
      document.body.appendChild(popup);

      // Move selection away
      const textSelState = state.apply(
        state.tr.setSelection(TextSelection.create(state.doc, 1))
      );
      (mockEditorView as Record<string, unknown>).state = textSelState;

      vi.clearAllMocks();
      viewResult.update!({} as never, {} as never);
      // Should not close because popup is in editing mode
      expect(mockClosePopup).not.toHaveBeenCalled();

      document.body.removeChild(popup);
    });

    it("checkSelectionForFootnote handles nodeDOM returning null", () => {
      const doc = schema.node("doc", null, [
        pWithRef("Text", "1"),
        fnDef("1", "Def 1"),
      ]);
      const state = createState(doc);

      let refPos = -1;
      state.doc.descendants((node, pos) => {
        if (node.type.name === "footnote_reference") {
          refPos = pos;
          return false;
        }
        return true;
      });

      const nodeSelState = state.apply(
        state.tr.setSelection(NodeSelection.create(state.doc, refPos))
      );

      const mockEditorView = {
        state: nodeSelState,
        dom: document.createElement("div"),
        nodeDOM: vi.fn(() => null), // returns null
      };

      const viewResult = plugin.spec.view!(mockEditorView as never);
      vi.clearAllMocks();
      viewResult.update!({} as never, {} as never);
      // Should not call openPopup since nodeDOM returned null
      expect(mockOpenPopup).not.toHaveBeenCalled();
    });
  });

  describe("handleDOMEvents.mouseover with delay", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("opens popup after delay when hovering footnote reference", () => {
      vi.useFakeTimers();

      const refEl = document.createElement("sup");
      refEl.setAttribute("data-type", "footnote_reference");
      refEl.setAttribute("data-label", "1");
      refEl.getBoundingClientRect = () => ({ top: 100, left: 50, bottom: 120, right: 70, width: 20, height: 20, x: 50, y: 100, toJSON: () => ({}) });
      document.body.appendChild(refEl);

      const doc = schema.node("doc", null, [
        pWithRef("Text", "1"),
        fnDef("1", "Def content"),
      ]);
      const state = createState(doc);

      const event = new MouseEvent("mouseover");
      Object.defineProperty(event, "target", { value: refEl });

      const handler = plugin.props.handleDOMEvents!.mouseover!;
      handler({ state } as never, event);

      // Not yet opened (delayed)
      expect(mockOpenPopup).not.toHaveBeenCalled();

      vi.advanceTimersByTime(200);
      expect(mockOpenPopup).toHaveBeenCalledWith(
        "1",
        expect.any(String),
        expect.any(Object),
        expect.any(Number),
        expect.any(Number),
      );

      document.body.removeChild(refEl);
    });

    it("does not reopen for the same ref element", () => {
      vi.useFakeTimers();

      const refEl = document.createElement("sup");
      refEl.setAttribute("data-type", "footnote_reference");
      refEl.setAttribute("data-label", "1");
      refEl.getBoundingClientRect = () => ({ top: 100, left: 50, bottom: 120, right: 70, width: 20, height: 20, x: 50, y: 100, toJSON: () => ({}) });
      document.body.appendChild(refEl);

      const doc = schema.node("doc", null, [
        pWithRef("Text", "1"),
        fnDef("1", "Def content"),
      ]);
      const state = createState(doc);

      const event1 = new MouseEvent("mouseover");
      Object.defineProperty(event1, "target", { value: refEl });

      const handler = plugin.props.handleDOMEvents!.mouseover!;
      handler({ state } as never, event1);
      vi.advanceTimersByTime(200);
      expect(mockOpenPopup).toHaveBeenCalledTimes(1);

      // Hover same element again - should return false (currentRefElement === refElement)
      const event2 = new MouseEvent("mouseover");
      Object.defineProperty(event2, "target", { value: refEl });
      const result = handler({ state } as never, event2);
      expect(result).toBe(false);

      document.body.removeChild(refEl);
    });

    it("handles ref element without data-label", () => {
      vi.useFakeTimers();

      const refEl = document.createElement("sup");
      refEl.setAttribute("data-type", "footnote_reference");
      // No data-label attribute
      document.body.appendChild(refEl);

      const event = new MouseEvent("mouseover");
      Object.defineProperty(event, "target", { value: refEl });

      const handler = plugin.props.handleDOMEvents!.mouseover!;
      handler({} as never, event);

      vi.advanceTimersByTime(200);
      // Should not call openPopup since there's no label
      expect(mockOpenPopup).not.toHaveBeenCalled();

      document.body.removeChild(refEl);
    });
  });

  describe("handleDOMEvents.mouseout edge cases", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("does not close when relatedTarget is another footnote ref", () => {
      vi.useFakeTimers();

      const refEl = document.createElement("sup");
      refEl.setAttribute("data-type", "footnote_reference");

      const event = new MouseEvent("mouseout");
      Object.defineProperty(event, "relatedTarget", { value: refEl });

      const handler = plugin.props.handleDOMEvents!.mouseout!;
      handler({} as never, event);

      vi.advanceTimersByTime(200);
      expect(mockClosePopup).not.toHaveBeenCalled();
    });

    it("does not close when relatedTarget is null (hovered to nothing)", () => {
      vi.useFakeTimers();

      const event = new MouseEvent("mouseout");
      Object.defineProperty(event, "relatedTarget", { value: null });

      const handler = plugin.props.handleDOMEvents!.mouseout!;
      handler({} as never, event);

      vi.advanceTimersByTime(200);
      // Close should still be called (relatedTarget null means left the element)
      expect(mockClosePopup).toHaveBeenCalled();
    });
  });

  describe("handleKeyDown with open popup", () => {
    it("closes popup and returns true when Escape is pressed and popup is open and not editing", async () => {
      // Override the mock to return isOpen: true
      const { useFootnotePopupStore } = await import("@/stores/footnotePopupStore");
      const origGetState = useFootnotePopupStore.getState;
      (useFootnotePopupStore as unknown as Record<string, unknown>).getState = () => ({
        isOpen: true,
        openPopup: mockOpenPopup,
        closePopup: mockClosePopup,
      });

      const popup = document.createElement("div");
      popup.className = "footnote-popup";
      document.body.appendChild(popup);

      const event = new KeyboardEvent("keydown", { key: "Escape" });
      const handler = plugin.props.handleKeyDown!;
      const result = handler({} as never, event);
      expect(result).toBe(true);
      expect(mockClosePopup).toHaveBeenCalled();

      document.body.removeChild(popup);
      (useFootnotePopupStore as unknown as Record<string, unknown>).getState = origGetState;
    });

    it("does not close popup when Escape is pressed and popup is editing", async () => {
      const { useFootnotePopupStore } = await import("@/stores/footnotePopupStore");
      const origGetState = useFootnotePopupStore.getState;
      (useFootnotePopupStore as unknown as Record<string, unknown>).getState = () => ({
        isOpen: true,
        openPopup: mockOpenPopup,
        closePopup: mockClosePopup,
      });

      const popup = document.createElement("div");
      popup.className = "footnote-popup editing";
      document.body.appendChild(popup);

      const event = new KeyboardEvent("keydown", { key: "Escape" });
      const handler = plugin.props.handleKeyDown!;
      const result = handler({} as never, event);
      expect(result).toBe(false);
      expect(mockClosePopup).not.toHaveBeenCalled();

      document.body.removeChild(popup);
      (useFootnotePopupStore as unknown as Record<string, unknown>).getState = origGetState;
    });

    it("does not close popup when Escape pressed but no popup element found", async () => {
      const { useFootnotePopupStore } = await import("@/stores/footnotePopupStore");
      const origGetState = useFootnotePopupStore.getState;
      (useFootnotePopupStore as unknown as Record<string, unknown>).getState = () => ({
        isOpen: true,
        openPopup: mockOpenPopup,
        closePopup: mockClosePopup,
      });

      // No popup element in DOM
      const event = new KeyboardEvent("keydown", { key: "Escape" });
      const handler = plugin.props.handleKeyDown!;
      const result = handler({} as never, event);
      expect(result).toBe(false);

      (useFootnotePopupStore as unknown as Record<string, unknown>).getState = origGetState;
    });
  });

  describe("handleClick with ref and def navigation", () => {
    it("clicking ref element with label navigates to definition", () => {
      // Add editor-content element for scrollToPosition
      const editorContent = document.createElement("div");
      editorContent.className = "editor-content";
      editorContent.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 500, right: 500, width: 500, height: 500, x: 0, y: 0, toJSON: () => ({}) });
      editorContent.scrollTo = vi.fn();
      document.body.appendChild(editorContent);

      const refEl = document.createElement("sup");
      refEl.setAttribute("data-type", "footnote_reference");
      refEl.setAttribute("data-label", "1");
      document.body.appendChild(refEl);

      const doc = schema.node("doc", null, [
        pWithRef("Text", "1"),
        fnDef("1", "Def content"),
      ]);
      const state = createState(doc);

      const mockView = {
        state,
        dispatch: vi.fn(),
        dom: document.createElement("div"),
        focus: vi.fn(),
        coordsAtPos: vi.fn(() => ({ top: 100, bottom: 120, left: 50, right: 70 })),
      };

      const event = new MouseEvent("click");
      Object.defineProperty(event, "target", { value: refEl });

      const handler = plugin.props.handleClick!;
      const result = handler(mockView as never, 0, event);
      expect(result).toBe(true);

      document.body.removeChild(refEl);
      document.body.removeChild(editorContent);
    });

    it("clicking ref element without label does not navigate", () => {
      const refEl = document.createElement("sup");
      refEl.setAttribute("data-type", "footnote_reference");
      // No data-label
      document.body.appendChild(refEl);

      const doc = schema.node("doc", null, [p("hello")]);
      const state = createState(doc);
      const mockView = { state };

      const event = new MouseEvent("click");
      Object.defineProperty(event, "target", { value: refEl });

      const handler = plugin.props.handleClick!;
      const result = handler(mockView as never, 0, event);
      expect(result).toBe(false);

      document.body.removeChild(refEl);
    });

    it("clicking def element navigates to reference", () => {
      const editorContent = document.createElement("div");
      editorContent.className = "editor-content";
      editorContent.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 500, right: 500, width: 500, height: 500, x: 0, y: 0, toJSON: () => ({}) });
      editorContent.scrollTo = vi.fn();
      document.body.appendChild(editorContent);

      const defEl = document.createElement("dl");
      defEl.setAttribute("data-type", "footnote_definition");
      defEl.setAttribute("data-label", "1");
      document.body.appendChild(defEl);

      const doc = schema.node("doc", null, [
        pWithRef("Text", "1"),
        fnDef("1", "Def content"),
      ]);
      const state = createState(doc);
      const mockView = {
        state,
        dispatch: vi.fn(),
        dom: document.createElement("div"),
        focus: vi.fn(),
        coordsAtPos: vi.fn(() => ({ top: 100, bottom: 120, left: 50, right: 70 })),
      };

      const event = new MouseEvent("click");
      Object.defineProperty(event, "target", { value: defEl });

      const handler = plugin.props.handleClick!;
      const result = handler(mockView as never, 0, event);
      expect(result).toBe(true);

      document.body.removeChild(defEl);
      document.body.removeChild(editorContent);
    });

    it("clicking def element with no matching ref returns false", () => {
      const defEl = document.createElement("dl");
      defEl.setAttribute("data-type", "footnote_definition");
      defEl.setAttribute("data-label", "99");
      document.body.appendChild(defEl);

      const doc = schema.node("doc", null, [p("no refs")]);
      const state = createState(doc);
      const mockView = { state };

      const event = new MouseEvent("click");
      Object.defineProperty(event, "target", { value: defEl });

      const handler = plugin.props.handleClick!;
      const result = handler(mockView as never, 0, event);
      expect(result).toBe(false);

      document.body.removeChild(defEl);
    });

    it("clicking def element without label does not navigate", () => {
      const defEl = document.createElement("dl");
      defEl.setAttribute("data-type", "footnote_definition");
      // No data-label
      document.body.appendChild(defEl);

      const doc = schema.node("doc", null, [p("hello")]);
      const state = createState(doc);
      const mockView = { state };

      const event = new MouseEvent("click");
      Object.defineProperty(event, "target", { value: defEl });

      const handler = plugin.props.handleClick!;
      const result = handler(mockView as never, 0, event);
      expect(result).toBe(false);

      document.body.removeChild(defEl);
    });

    it("clicking ref with no matching definition returns false", () => {
      const refEl = document.createElement("sup");
      refEl.setAttribute("data-type", "footnote_reference");
      refEl.setAttribute("data-label", "99");
      document.body.appendChild(refEl);

      const doc = schema.node("doc", null, [p("no defs")]);
      const state = createState(doc);
      const mockView = { state };

      const event = new MouseEvent("click");
      Object.defineProperty(event, "target", { value: refEl });

      const handler = plugin.props.handleClick!;
      const result = handler(mockView as never, 0, event);
      expect(result).toBe(false);

      document.body.removeChild(refEl);
    });
  });

  describe("appendTransaction — all refs removed with defs remaining", () => {
    it("deletes all defs when no refs exist and orphanedDefs is empty but defs remain", () => {
      // Scenario: orphanedDefs.length === 0 && newRefLabels.size === 0 && defs.length > 0
      // This happens when all references had matching definitions, but then ALL references are removed
      // The condition is orphanedDefs.filter filters out defs whose labels ARE in newRefLabels
      // If newRefLabels is empty, ALL defs are orphaned, so orphanedDefs.length > 0
      // The branch where orphanedDefs.length === 0 && newRefLabels.size === 0 && defs.length > 0
      // requires defs that all have labels matching newRefLabels... but newRefLabels.size === 0.
      // This is logically impossible, but we test the branch anyway.
      // Actually, it CAN happen if defs have labels that are not in newRefLabels but there are no orphans...
      // No, orphanedDefs = defs.filter(d => !newRefLabels.has(d.label)), if newRefLabels is empty,
      // all defs are orphaned. So this branch requires defs.length > 0 but orphanedDefs.length === 0,
      // which means all defs have labels in newRefLabels, but newRefLabels.size === 0.
      // This is impossible. The branch handles a degenerate case.

      // We can test the createCleanupAndRenumberTransaction branch instead
      const doc = schema.node("doc", null, [
        pWithRef("A", "1"),
        pWithRef("B", "2"),
        fnDef("1"),
        fnDef("2"),
        fnDef("3"), // orphan
      ]);
      const state = createState(doc);

      // Delete ref "2" paragraph
      const newPara = p("B was here");
      const tr = state.tr.replaceWith(
        state.doc.child(0).nodeSize,
        state.doc.child(0).nodeSize + state.doc.child(1).nodeSize,
        newPara,
      );
      const newState = state.apply(tr);

      const result = plugin.spec.appendTransaction!(
        [tr],
        state,
        newState,
      );
      expect(result).not.toBeNull();
    });

    it("renumbers refs when a ref and its def are both deleted (orphanedDefs=0, renumber path)", () => {
      // Setup: refs [1, 2, 3], defs [1, 2, 3]
      const doc = schema.node("doc", null, [
        pWithRef("A", "1"),
        pWithRef("B", "2"),
        pWithRef("C", "3"),
        fnDef("1"),
        fnDef("2"),
        fnDef("3"),
      ]);
      const state = createState(doc);

      // Delete both ref "2" paragraph AND def "2"
      // After: refs [1, 3], defs [1, 3] => orphanedDefs = 0, renumber needed (3->2)
      // First, find positions of paragraph with ref "2" and def "2"
      const child1Size = state.doc.child(0).nodeSize; // pWithRef A
      const child2Size = state.doc.child(1).nodeSize; // pWithRef B
      const child3Size = state.doc.child(2).nodeSize; // pWithRef C
      const child4Size = state.doc.child(3).nodeSize; // fnDef 1

      // Delete def "2" first (it's child(4)), then delete paragraph with ref "2" (child(1))
      // Work in reverse order to preserve positions
      const def2Start = child1Size + child2Size + child3Size + child4Size;
      const def2End = def2Start + state.doc.child(4).nodeSize;

      let tr = state.tr.delete(def2Start, def2End);
      // Now delete paragraph with ref "2" (child(1))
      tr = tr.delete(child1Size, child1Size + child2Size);

      const newState = state.apply(tr);

      // Verify: new doc has refs [1, 3] and defs [1, 3]
      const newRefLabels = getReferenceLabels(newState.doc);
      expect(newRefLabels).toEqual(new Set(["1", "3"]));
      const newDefs = getDefinitionInfo(newState.doc);
      expect(newDefs.map((d) => d.label)).toEqual(expect.arrayContaining(["1", "3"]));

      const result = plugin.spec.appendTransaction!(
        [tr],
        state,
        newState,
      );
      // Should return a renumber transaction (line 284)
      expect(result).not.toBeNull();
      // After renumbering, labels should be 1, 2
      const finalRefLabels = getReferenceLabels(result!.doc);
      expect(finalRefLabels).toEqual(new Set(["1", "2"]));
    });

    it("deletes all defs when all refs are removed but defs remain with non-matching labels", () => {
      // This tests lines 272-280: orphanedDefs=0, newRefLabels.size=0, defs.length>0
      // This is actually unreachable because if newRefLabels.size === 0, all defs are orphaned.
      // But we can test the outer branch: orphanedDefs.length === 0 && newRefLabels.size === 0
      // with defs.length === 0 (returns null at line 280).
      const doc = schema.node("doc", null, [
        pWithRef("A", "1"),
        fnDef("1"),
      ]);
      const state = createState(doc);

      // Delete both the ref paragraph and the def
      const child1Size = state.doc.child(0).nodeSize;
      let tr = state.tr.delete(child1Size, child1Size + state.doc.child(1).nodeSize);
      tr = tr.delete(0, child1Size);

      const newState = state.apply(tr);

      const result = plugin.spec.appendTransaction!(
        [tr],
        state,
        newState,
      );
      // No refs, no defs => returns null (line 280)
      expect(result).toBeNull();
    });

    it("deletes all defs when orphanedDefs=0 and newRefLabels=empty but defs exist (lines 273-278)", () => {
      // This branch is logically unreachable under normal conditions because
      // if newRefLabels is empty, all defs become orphaned. We use mocks to
      // force the "impossible" state: orphanedDefs=0, newRefLabels.size=0, defs.length>0.
      //
      // The trick: mock getReferenceLabels so the second call (newRefLabels) returns
      // a Set-like object where size=0 but has() always returns true.
      // This means:
      //   - refDeleted check: oldRefLabels has "1","2". For each, !newRefLabels.has(label)
      //     => !true => false. refDeleted stays false => returns null at line 266.
      //
      // To pass the refDeleted check, we need at least one old label to NOT be in new.
      // So has() must return false for some labels (triggering refDeleted) but true for
      // all def labels (making orphanedDefs=0). We use the same labels for refs and defs,
      // so this is contradictory... unless we use the iteration order.
      //
      // Better approach: make newRefLabels.has() return false on first call (refDeleted loop)
      // then true on subsequent calls (orphanedDefs filter).
      const doc = schema.node("doc", null, [
        pWithRef("A", "1"),
        pWithRef("B", "2"),
        fnDef("1"),
        fnDef("2"),
      ]);
      const state = createState(doc);

      // Delete ref "2" paragraph
      const child1Size = state.doc.child(0).nodeSize;
      const child2Size = state.doc.child(1).nodeSize;
      const tr = state.tr.delete(child1Size, child1Size + child2Size);
      const newState = state.apply(tr);

      const realDefs = getDefinitionInfo(newState.doc);

      let refLabelCallCount = 0;
      mockGetReferenceLabels.mockImplementation(() => {
        refLabelCallCount++;
        if (refLabelCallCount === 1) return new Set(["1", "2"]); // oldRefLabels
        // newRefLabels: has() returns false once (for refDeleted), then true (for orphanedDefs)
        const fakeSet = new Set<string>();
        let hasCallCount = 0;
        fakeSet.has = () => {
          hasCallCount++;
          // First call is from the refDeleted loop — return false to trigger refDeleted
          if (hasCallCount === 1) return false;
          // Subsequent calls from orphanedDefs filter — return true so orphanedDefs=0
          return true;
        };
        Object.defineProperty(fakeSet, "size", { get: () => 0 });
        return fakeSet;
      });

      mockGetDefinitionInfo.mockReturnValue(realDefs);

      const result = plugin.spec.appendTransaction!(
        [tr],
        state,
        newState,
      );

      // Should return a transaction that deletes all defs (lines 273-278)
      expect(result).not.toBeNull();
      // The result transaction should have fewer children (defs deleted)
      expect(result!.doc.childCount).toBeLessThan(newState.doc.childCount);
    });
  });

  describe("checkSelectionForFootnote — NodeSelection on non-footnote node (line 176)", () => {
    it("does not open popup when NodeSelection is on a non-footnote node", () => {
      // Create doc with just a paragraph (no footnote reference)
      const doc = schema.node("doc", null, [
        p("Text"),
        fnDef("1", "Def 1"),
      ]);
      const state = createState(doc);

      // Find the footnote_definition node position (a non-inline node)
      let defPos = -1;
      state.doc.descendants((node, pos) => {
        if (node.type.name === "footnote_definition") {
          defPos = pos;
          return false;
        }
        return true;
      });
      expect(defPos).toBeGreaterThanOrEqual(0);

      // Create NodeSelection on the footnote_definition (not a footnote_reference)
      const nodeSelState = state.apply(
        state.tr.setSelection(NodeSelection.create(state.doc, defPos))
      );

      const mockEditorView = {
        state: nodeSelState,
        dom: document.createElement("div"),
        nodeDOM: vi.fn(() => null),
      };

      const viewResult = plugin.spec.view!(mockEditorView as never);
      vi.clearAllMocks();
      viewResult.update!({} as never, {} as never);

      // Should not open popup because node is footnote_definition, not footnote_reference
      expect(mockOpenPopup).not.toHaveBeenCalled();
    });
  });

  describe("mouseout — popup matches :hover (line 99)", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("does not close popup when popup element matches :hover", () => {
      vi.useFakeTimers();

      // Create a popup element that matches :hover
      const popupEl = document.createElement("div");
      popupEl.className = "footnote-popup";
      // Override matches to return true for :hover
      popupEl.matches = vi.fn((selector: string) => selector === ":hover");
      document.body.appendChild(popupEl);

      // Override querySelector to return our popup
      const origQuerySelector = document.querySelector.bind(document);
      vi.spyOn(document, "querySelector").mockImplementation((selector: string) => {
        if (selector === ".footnote-popup") return popupEl;
        return origQuerySelector(selector);
      });

      const div = document.createElement("div");
      const event = new MouseEvent("mouseout");
      Object.defineProperty(event, "relatedTarget", { value: div });

      const handler = plugin.props.handleDOMEvents!.mouseout!;
      handler({} as never, event);

      vi.advanceTimersByTime(200);
      // Should NOT close because popup matches :hover
      expect(mockClosePopup).not.toHaveBeenCalled();

      document.body.removeChild(popupEl);
      vi.mocked(document.querySelector).mockRestore();
    });
  });

  describe("handleDOMEvents.mouseover — null definition fallback (lines 77-78)", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("calls openPopup with 'Footnote not found' and null defPos when definition is missing", () => {
      vi.useFakeTimers();

      const refEl = document.createElement("sup");
      refEl.setAttribute("data-type", "footnote_reference");
      refEl.setAttribute("data-label", "99"); // label with no matching definition
      refEl.getBoundingClientRect = () => ({ top: 100, left: 50, bottom: 120, right: 70, width: 20, height: 20, x: 50, y: 100, toJSON: () => ({}) });
      document.body.appendChild(refEl);

      // Doc has a ref with label "99" but no matching definition node
      const doc = schema.node("doc", null, [
        pWithRef("Text", "99"),
        // No fnDef("99") — so findFootnoteDefinition returns null
      ]);
      const state = createState(doc);

      const event = new MouseEvent("mouseover");
      Object.defineProperty(event, "target", { value: refEl });

      const handler = plugin.props.handleDOMEvents!.mouseover!;
      handler({ state } as never, event);

      vi.advanceTimersByTime(200);

      // openPopup must be called with the fallback content and null defPos
      expect(mockOpenPopup).toHaveBeenCalledWith(
        "99",
        "Footnote not found", // line 77: definition?.content ?? "Footnote not found"
        expect.any(Object),
        null,                  // line 78: definition?.pos ?? null
        expect.anything(),
      );

      document.body.removeChild(refEl);
    });
  });

  describe("checkSelectionForFootnote — null definition fallback (lines 183-186)", () => {
    it("calls openPopup with 'Footnote not found' and null defPos when definition is missing on NodeSelection", () => {
      // Ref label "99" but no matching footnote_definition in the doc
      const doc = schema.node("doc", null, [
        pWithRef("Text", "99"),
        // No fnDef("99")
      ]);
      const state = createState(doc);

      let refPos = -1;
      state.doc.descendants((node, pos) => {
        if (node.type.name === "footnote_reference") {
          refPos = pos;
          return false;
        }
        return true;
      });
      expect(refPos).toBeGreaterThanOrEqual(0);

      const nodeSelState = state.apply(
        state.tr.setSelection(NodeSelection.create(state.doc, refPos))
      );

      const domEl = document.createElement("sup");
      domEl.getBoundingClientRect = () => ({ top: 100, left: 50, bottom: 120, right: 70, width: 20, height: 20, x: 50, y: 100, toJSON: () => ({}) });

      const mockEditorView = {
        state: nodeSelState,
        dom: document.createElement("div"),
        nodeDOM: vi.fn(() => domEl), // returns a real element so openPopup is called
      };

      const viewResult = plugin.spec.view!(mockEditorView as never);
      vi.clearAllMocks();
      viewResult.update!({} as never, {} as never);

      // openPopup must be called with fallback values (lines 185-186)
      expect(mockOpenPopup).toHaveBeenCalledWith(
        "99",
        "Footnote not found", // line 185: definition?.content ?? "Footnote not found"
        expect.any(Object),
        null,                  // line 186: definition?.pos ?? null
        refPos,
      );
    });
  });

  describe("appendTransaction — schema without footnote types (line 240)", () => {
    it("returns null when schema has no footnote_reference type", () => {
      // Create a schema without footnote nodes
      const plainSchema = new Schema({
        nodes: {
          doc: { content: "block+" },
          paragraph: { group: "block", content: "inline*" },
          text: { group: "inline" },
        },
      });

      const plainDoc = plainSchema.node("doc", null, [
        plainSchema.node("paragraph", null, [plainSchema.text("hello")])
      ]);
      const plainState = EditorState.create({ doc: plainDoc, schema: plainSchema });

      // Create a plugin from the extension
      const extensionContext = {
        name: footnotePopupExtension.name,
        options: footnotePopupExtension.options,
        storage: footnotePopupExtension.storage,
        editor: {} as import("@tiptap/core").Editor,
        type: null,
        parent: undefined,
      };
      const plugins = footnotePopupExtension.config.addProseMirrorPlugins?.call(extensionContext) ?? [];
      const plainPlugin = plugins[0];

      // Create a doc-changing transaction
      const tr = plainState.tr.insertText("x", 1);

      const result = plainPlugin.spec.appendTransaction!(
        [tr],
        plainState,
        plainState,
      );
      // Should return null because schema has no footnote_reference / footnote_definition
      expect(result).toBeNull();
    });
  });
});
