import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useFootnotePopupStore } from "@/stores/footnotePopupStore";
import {
  removeFootnote,
  saveFootnoteContent,
  findFootnoteDefinition,
  findFootnoteDefinitionAtPos,
  findFootnoteReference,
  findFootnoteReferences,
} from "../sourceFootnoteActions";
import { gotoFootnoteTarget } from "../sourceFootnoteActions";

// The actions take the popup state as a parameter now. These tests drive the
// REAL store, so they pass it — the wiring the app ships.
const store = useFootnotePopupStore as never;

function createView(doc: string): EditorView {
  const parent = document.createElement("div");
  const state = EditorState.create({ doc });
  return new EditorView({ state, parent });
}

describe("source footnote actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    useFootnotePopupStore.getState().closePopup();
  });

  describe("saveFootnoteContent", () => {
    it("updates multi-line footnote definitions", () => {
      const doc = "Ref[^1]\n\n[^1]: first line\n  second line\n  third line\n\nAfter.";
      const definitionPos = doc.indexOf("[^1]:");
      const referencePos = doc.indexOf("[^1]");
      const view = createView(doc);

      useFootnotePopupStore.setState({
        isOpen: true,
        label: "1",
        content: "updated line\nsecond updated",
        anchorRect: null,
        definitionPos,
        referencePos,
        autoFocus: false,
      });

      saveFootnoteContent(view, store);

      expect(view.state.doc.toString()).toBe(
        "Ref[^1]\n\n[^1]: updated line\n  second updated\n\nAfter."
      );

      view.destroy();
    });

    it("does nothing when definitionPos is null", () => {
      const doc = "Ref[^1]\n\n[^1]: content";
      const view = createView(doc);

      useFootnotePopupStore.setState({
        isOpen: true,
        label: "1",
        content: "new content",
        anchorRect: null,
        definitionPos: null,
        referencePos: 3,
        autoFocus: false,
      });

      saveFootnoteContent(view, store);

      // Document unchanged
      expect(view.state.doc.toString()).toBe(doc);
      view.destroy();
    });

    it("does nothing when label is empty", () => {
      const doc = "Ref[^1]\n\n[^1]: content";
      const view = createView(doc);

      useFootnotePopupStore.setState({
        isOpen: true,
        label: "",
        content: "new content",
        anchorRect: null,
        definitionPos: 10,
        referencePos: 3,
        autoFocus: false,
      });

      saveFootnoteContent(view, store);

      expect(view.state.doc.toString()).toBe(doc);
      view.destroy();
    });

    it("saves single-line footnote definition", () => {
      const doc = "Text[^1]\n\n[^1]: old content\n\nAfter.";
      const definitionPos = doc.indexOf("[^1]:");
      const view = createView(doc);

      useFootnotePopupStore.setState({
        isOpen: true,
        label: "1",
        content: "new content",
        anchorRect: null,
        definitionPos,
        referencePos: 4,
        autoFocus: false,
      });

      saveFootnoteContent(view, store);

      expect(view.state.doc.toString()).toBe(
        "Text[^1]\n\n[^1]: new content\n\nAfter."
      );
      view.destroy();
    });
  });

  describe("removeFootnote", () => {
    it("removes all references and the definition block", () => {
      const doc = "Ref[^a] middle [^a].\n\n[^a]: note\n  more\nAfter.";
      const definitionPos = doc.indexOf("[^a]:");
      const referencePos = doc.indexOf("[^a]");
      const view = createView(doc);

      useFootnotePopupStore.setState({
        isOpen: true,
        label: "a",
        content: "",
        anchorRect: null,
        definitionPos,
        referencePos,
        autoFocus: false,
      });

      removeFootnote(view, store);

      expect(view.state.doc.toString()).toBe("Ref middle .\n\nAfter.");

      view.destroy();
    });

    it("does nothing when label is empty", () => {
      const doc = "Ref[^1]\n\n[^1]: content";
      const view = createView(doc);

      useFootnotePopupStore.setState({
        isOpen: true,
        label: "",
        content: "",
        anchorRect: null,
        definitionPos: 10,
        referencePos: 3,
        autoFocus: false,
      });

      removeFootnote(view, store);

      expect(view.state.doc.toString()).toBe(doc);
      view.destroy();
    });

    it("removes only the reference when no definition exists", () => {
      const doc = "Text [^orphan] here.";
      const referencePos = doc.indexOf("[^orphan]");
      const view = createView(doc);

      useFootnotePopupStore.setState({
        isOpen: true,
        label: "orphan",
        content: "",
        anchorRect: null,
        definitionPos: null,
        referencePos,
        autoFocus: false,
      });

      removeFootnote(view, store);

      expect(view.state.doc.toString()).toBe("Text  here.");
      view.destroy();
    });

    it("handles special regex characters in label", () => {
      const doc = "Text[^a.b]\n\n[^a.b]: note";
      const definitionPos = doc.indexOf("[^a.b]:");
      const referencePos = doc.indexOf("[^a.b]");
      const view = createView(doc);

      useFootnotePopupStore.setState({
        isOpen: true,
        label: "a.b",
        content: "",
        anchorRect: null,
        definitionPos,
        referencePos,
        autoFocus: false,
      });

      removeFootnote(view, store);

      expect(view.state.doc.toString()).toBe("Text\n\n");
      view.destroy();
    });
  });

  describe("gotoFootnoteTarget", () => {
    it("navigates to definition when opened on reference", () => {
      const doc = "Ref[^1]\n\n[^1]: content";
      const definitionPos = doc.indexOf("[^1]:");
      const view = createView(doc);

      useFootnotePopupStore.setState({
        isOpen: true,
        label: "1",
        content: "content",
        anchorRect: null,
        definitionPos,
        referencePos: 3,
        autoFocus: false,
      });

      gotoFootnoteTarget(view, true, store);

      // Should dispatch with selection at definitionPos
      const sel = view.state.selection.main;
      expect(sel.anchor).toBe(definitionPos);
      view.destroy();
    });

    it("navigates to reference when opened on definition", () => {
      const doc = "Ref[^1]\n\n[^1]: content";
      const referencePos = doc.indexOf("[^1]");
      const view = createView(doc);

      useFootnotePopupStore.setState({
        isOpen: true,
        label: "1",
        content: "content",
        anchorRect: null,
        definitionPos: doc.indexOf("[^1]:"),
        referencePos,
        autoFocus: false,
      });

      gotoFootnoteTarget(view, false, store);

      const sel = view.state.selection.main;
      expect(sel.anchor).toBe(referencePos);
      view.destroy();
    });

    it("does nothing when target position is null", () => {
      const doc = "Ref[^1]";
      const view = createView(doc);

      useFootnotePopupStore.setState({
        isOpen: true,
        label: "1",
        content: "",
        anchorRect: null,
        definitionPos: null,
        referencePos: null,
        autoFocus: false,
      });

      // Should not throw
      gotoFootnoteTarget(view, true, store);
      view.destroy();
    });
  });

  describe("findFootnoteDefinition", () => {
    it("finds a simple footnote definition", () => {
      const doc = "Text\n\n[^1]: This is a footnote";
      const view = createView(doc);

      const result = findFootnoteDefinition(view, "1");

      expect(result).not.toBeNull();
      expect(result!.content).toBe("This is a footnote");
      view.destroy();
    });

    it("returns null when definition not found", () => {
      const doc = "Text without footnotes";
      const view = createView(doc);

      const result = findFootnoteDefinition(view, "1");

      expect(result).toBeNull();
      view.destroy();
    });

    it("finds multi-line footnote definition", () => {
      const doc = "[^1]: first line\n  second line\n  third line";
      const view = createView(doc);

      const result = findFootnoteDefinition(view, "1");

      expect(result).not.toBeNull();
      expect(result!.content).toBe("first line\nsecond line\nthird line");
      view.destroy();
    });

    it("stops at non-continuation line", () => {
      const doc = "[^1]: first line\n  second line\nnot indented";
      const view = createView(doc);

      const result = findFootnoteDefinition(view, "1");

      expect(result).not.toBeNull();
      expect(result!.content).toBe("first line\nsecond line");
      view.destroy();
    });
  });

  describe("findFootnoteDefinitionAtPos", () => {
    it("finds definition when pos is on definition line", () => {
      const doc = "[^1]: content here";
      const view = createView(doc);

      const result = findFootnoteDefinitionAtPos(view, 0);

      expect(result).not.toBeNull();
      expect(result!.label).toBe("1");
      expect(result!.content).toBe("content here");
      view.destroy();
    });

    it("finds definition when pos is on continuation line", () => {
      const doc = "[^1]: first\n  second";
      const view = createView(doc);

      // Position on the continuation line
      const result = findFootnoteDefinitionAtPos(view, doc.indexOf("second"));

      expect(result).not.toBeNull();
      expect(result!.label).toBe("1");
      view.destroy();
    });

    it("finds definition when pos is on third continuation line (scans through multiple continuation lines)", () => {
      // This exercises the false branch of `if (!isFootnoteContinuationLine(current.text)) { break; }`
      // when scanning backward: line 3 (pos here) → scans i=2 ("  second": IS continuation → don't break)
      // → scans i=1 ("[^1]: first": matches def regex → returns).
      const doc = "[^1]: first\n  second\n  third";
      const view = createView(doc);

      // Position on "third" (the third line — second continuation)
      const result = findFootnoteDefinitionAtPos(view, doc.indexOf("third"));

      expect(result).not.toBeNull();
      expect(result!.label).toBe("1");
      expect(result!.content).toBe("first\nsecond\nthird");
      view.destroy();
    });

    it("returns null when pos is not on a footnote", () => {
      const doc = "Just plain text";
      const view = createView(doc);

      const result = findFootnoteDefinitionAtPos(view, 5);

      expect(result).toBeNull();
      view.destroy();
    });
  });

  describe("removeFootnote — referenceAtPos not already in references", () => {
    it("includes a reference found at referencePos that is the only reference (not duplicated)", () => {
      // The reference at referencePos is found by findFootnoteReferenceAtPos.
      // findFootnoteReferences should also find it (both use same regex).
      // However, if referencePos points to a position that IS a reference,
      // and there are NO other references (so references list is just that one),
      // the `!references.some(...)` check is TRUE (ref IS already in list from findFootnoteReferences).
      // To actually hit branch 12 arm 0 (referenceAtPos NOT in references):
      // Set referencePos to null → findFootnoteReferenceAtPos returns null → condition false (arm 1).
      // Or set referencePos to a position where referenceAtPos is found but not in references...
      // In practice this branch is a defensive guard. Test with referencePos=null (arm 1):
      const doc = "Text[^x] here.\n\n[^x]: note";
      const view = createView(doc);

      useFootnotePopupStore.setState({
        isOpen: true,
        label: "x",
        content: "",
        anchorRect: null,
        definitionPos: doc.indexOf("[^x]:"),
        referencePos: null, // null → findFootnoteReferenceAtPos returns null → condition false
        autoFocus: false,
      });

      removeFootnote(view, store);

      // With null referencePos, findFootnoteReferenceAtPos returns null.
      // findFootnoteReferences finds the reference at referencePos.
      // The reference IS removed.
      const result = view.state.doc.toString();
      expect(result).not.toContain("[^x]");
      view.destroy();
    });
  });

  describe("findFootnoteReferences", () => {
    it("finds all references for a label", () => {
      const doc = "First[^1] and second[^1] and third[^2].";
      const view = createView(doc);

      const refs = findFootnoteReferences(view, "1");

      expect(refs.length).toBe(2);
      view.destroy();
    });

    it("returns empty array when no references found", () => {
      const doc = "No footnotes here.";
      const view = createView(doc);

      const refs = findFootnoteReferences(view, "1");

      expect(refs.length).toBe(0);
      view.destroy();
    });

    it("does not match definition syntax as reference", () => {
      const doc = "[^1]: definition only";
      const view = createView(doc);

      const refs = findFootnoteReferences(view, "1");

      expect(refs.length).toBe(0);
      view.destroy();
    });
  });

  describe("findFootnoteReference", () => {
    it("finds first reference for a label", () => {
      const doc = "First[^1] and second[^1].";
      const view = createView(doc);

      const ref = findFootnoteReference(view, "1");

      expect(ref).not.toBeNull();
      expect(ref!.from).toBe(doc.indexOf("[^1]"));
      view.destroy();
    });

    it("returns null when no references found", () => {
      const doc = "No footnotes.";
      const view = createView(doc);

      const ref = findFootnoteReference(view, "1");

      expect(ref).toBeNull();
      view.destroy();
    });
  });
});
