// @vitest-environment node
/**
 * Real-document tests for handleWysiwygTransformCase.
 *
 * The sibling suite (`wysiwygAdapterFormatting.test.ts`) mocks the document
 * and the transforms, so it can only see that SOMETHING was dispatched. These
 * tests run the handler against a real schema and a real EditorState, because
 * the defect they pin was invisible to mocks: replacing the whole selection
 * with one concatenated text node destroyed block boundaries, collapsed mixed
 * marks and silently discarded inline atoms.
 */
import { describe, it, expect, vi } from "vitest";
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { testSchema } from "@/utils/markdownPipeline/testSchema";
import { handleWysiwygTransformCase } from "./wysiwygAdapterFormatting";
import type { WysiwygToolbarContext } from "./types";

const s = testSchema;
const doc = (...blocks: PMNode[]) => s.node("doc", null, blocks);
const p = (...content: PMNode[]) => s.node("paragraph", null, content);
const text = (t: string) => s.text(t);
const bold = (t: string) => s.text(t, [s.marks.bold.create()]);
const br = () => s.node("hardBreak");

type CaseType = "uppercase" | "lowercase" | "titleCase" | "toggleCase";

function run(startDoc: PMNode, from: number, to: number, caseType: CaseType) {
  let state = EditorState.create({
    doc: startDoc,
    selection: TextSelection.create(startDoc, from, to),
  });
  const dispatch = vi.fn((tr: Transaction) => {
    state = state.apply(tr);
  });
  const setTextSelection = vi.fn();
  const focus = vi.fn();
  const context = {
    surface: "wysiwyg",
    view: { state, dispatch } as never,
    editor: { commands: { setTextSelection, focus } } as never,
    context: null,
  } as WysiwygToolbarContext;
  const accepted = handleWysiwygTransformCase(context, caseType);
  return { accepted, doc: () => state.doc, dispatch, setTextSelection };
}

describe("handleWysiwygTransformCase — real documents", () => {
  it("preserves mixed marks: bold text stays bold after uppercase", () => {
    const start = doc(p(text("plain "), bold("bold")));
    const r = run(start, 1, 11, "uppercase");
    expect(r.accepted).toBe(true);
    expect(r.doc().eq(doc(p(text("PLAIN "), bold("BOLD"))))).toBe(true);
  });

  it("keeps inline atoms: a hard break survives the transform", () => {
    const start = doc(p(text("one"), br(), text("two")));
    const r = run(start, 1, 8, "uppercase");
    expect(r.accepted).toBe(true);
    expect(r.doc().eq(doc(p(text("ONE"), br(), text("TWO"))))).toBe(true);
  });

  it("keeps block boundaries: a two-paragraph selection stays two paragraphs", () => {
    const start = doc(p(text("one")), p(text("two")));
    const r = run(start, 1, 9, "uppercase");
    expect(r.accepted).toBe(true);
    expect(r.doc().eq(doc(p(text("ONE")), p(text("TWO"))))).toBe(true);
  });

  it("titleCase does not treat a mid-word mark boundary as a word start", () => {
    const start = doc(p(text("he"), bold("llo world")));
    const r = run(start, 1, 12, "titleCase");
    expect(r.accepted).toBe(true);
    expect(r.doc().eq(doc(p(text("He"), bold("llo World"))))).toBe(true);
  });

  it("toggleCase decides its direction over the WHOLE selection", () => {
    // "ABcd" is half upper, half lower — the tie goes to lowercase, for every
    // slice. Deciding per slice would leave "ab" and "CD".
    const start = doc(p(text("AB"), bold("cd")));
    const r = run(start, 1, 5, "toggleCase");
    expect(r.accepted).toBe(true);
    expect(r.doc().eq(doc(p(text("ab"), bold("cd"))))).toBe(true);
  });

  it("transforms only the selected part of a partially selected text node", () => {
    const start = doc(p(text("abcdef")));
    const r = run(start, 3, 5, "uppercase");
    expect(r.accepted).toBe(true);
    expect(r.doc().eq(doc(p(text("abCDef"))))).toBe(true);
  });

  it("re-selects the transformed range", () => {
    const start = doc(p(text("one"), br(), text("two")));
    const r = run(start, 1, 8, "uppercase");
    expect(r.setTextSelection).toHaveBeenCalledWith({ from: 1, to: 8 });
  });

  it("returns true without dispatching when already in the requested case", () => {
    const start = doc(p(text("ALREADY")));
    const r = run(start, 1, 8, "uppercase");
    expect(r.accepted).toBe(true);
    expect(r.dispatch).not.toHaveBeenCalled();
  });
});
