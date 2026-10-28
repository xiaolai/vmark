// @vitest-environment jsdom
/**
 * Footnote rebuild vs. the trailing paragraph — production stack.
 *
 * Tiptap's trailing-node extension keeps an empty paragraph after a document
 * that ends in a footnote definition. Renumbering/cleanup deletes every
 * definition and re-appends them at the end of the document; appending them
 * AFTER that trailing paragraph stranded it between the body and the
 * definitions (a visible empty block, serialized as an extra blank-line run),
 * and every later cleanup or footnote insertion stranded one more.
 *
 * Runs the real extension stack and the real serializer (typingHarness), and
 * compares each result with the same document loaded directly.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { createTypingSession, type TypingSession } from "@/test/typingHarness";
import { insertFootnoteAndOpenPopup } from "./tiptapInsertFootnote";

let sessions: TypingSession[] = [];
afterEach(() => {
  for (const s of sessions) s.destroy();
  sessions = [];
});

function load(markdown: string): TypingSession {
  const s = createTypingSession({ markdown });
  sessions.push(s);
  return s;
}

/** Top-level block kinds; an empty paragraph is spelled "empty". */
function blocks(doc: PMNode): string[] {
  const out: string[] = [];
  doc.forEach((node) => {
    out.push(node.type.name === "paragraph" && node.content.size === 0 ? "empty" : node.type.name);
  });
  return out;
}

/** Delete the first reference carrying `label` — what Backspace over it does. */
function deleteRef(s: TypingSession, label: string): void {
  const { state } = s.editor;
  let pos = -1;
  state.doc.descendants((node, p) => {
    if (pos < 0 && node.type.name === "footnote_reference" && node.attrs.label === label) pos = p;
    return pos < 0;
  });
  if (pos < 0) throw new Error(`no reference [^${label}]`);
  s.editor.view.dispatch(state.tr.delete(pos, pos + 1));
}

/** The serialization of `expected` loaded directly — no rebuild involved. */
function direct(expected: string): string {
  return load(expected).markdown();
}

describe("footnote cleanup keeps the trailing paragraph at the end", () => {
  it("defs at the end: deleting the first ref leaves no empty paragraph before the moved def", () => {
    const s = load("a[^1] b[^2] c\n\n[^1]: one\n\n[^2]: two\n");
    deleteRef(s, "1");
    expect(blocks(s.editor.state.doc)).toEqual(["paragraph", "footnote_definition", "empty"]);
    expect(s.markdown()).toBe(direct("a b[^1] c\n\n[^1]: two\n"));
  });

  it("deleting the last ref (orphan only, no renumber) leaves no empty paragraph", () => {
    const s = load("a[^1] b[^2] c\n\n[^1]: one\n\n[^2]: two\n");
    deleteRef(s, "2");
    expect(blocks(s.editor.state.doc)).toEqual(["paragraph", "footnote_definition", "empty"]);
    expect(s.markdown()).toBe(direct("a[^1] b c\n\n[^1]: one\n"));
  });

  it("repeated cleanups do not accumulate empty paragraphs (three definitions)", () => {
    const s = load("a[^1] b[^2] c[^3] d\n\n[^1]: one\n\n[^2]: two\n\n[^3]: three\n");
    deleteRef(s, "1");
    expect(blocks(s.editor.state.doc)).toEqual(["paragraph", "footnote_definition", "footnote_definition", "empty"]);
    expect(s.markdown()).toBe(direct("a b[^1] c[^2] d\n\n[^1]: two\n\n[^2]: three\n"));
    deleteRef(s, "1");
    expect(blocks(s.editor.state.doc)).toEqual(["paragraph", "footnote_definition", "empty"]);
    expect(s.markdown()).toBe(direct("a b c[^1] d\n\n[^1]: three\n"));
  });

  it("defs in the middle move after the following text, trailing paragraph last", () => {
    const s = load("Intro a[^1] b[^2].\n\n[^1]: one\n\n[^2]: two\n\nTail.\n");
    deleteRef(s, "1");
    expect(blocks(s.editor.state.doc)).toEqual(["paragraph", "paragraph", "footnote_definition", "empty"]);
    expect(s.markdown()).toBe(direct("Intro a b[^1].\n\nTail.\n\n[^1]: two\n"));
  });

  it("defs at the start move to the end", () => {
    const s = load("[^1]: one\n\n[^2]: two\n\na[^1] b[^2] c\n");
    deleteRef(s, "1");
    expect(blocks(s.editor.state.doc)).toEqual(["paragraph", "footnote_definition", "empty"]);
    expect(s.markdown()).toBe(direct("a b[^1] c\n\n[^1]: two\n"));
  });

  it("CJK text and definitions", () => {
    const s = load("甲[^1]乙[^2]丙\n\n[^1]: 第一\n\n[^2]: 第二😀\n");
    deleteRef(s, "1");
    expect(blocks(s.editor.state.doc)).toEqual(["paragraph", "footnote_definition", "empty"]);
    expect(s.markdown()).toBe(direct("甲乙[^1]丙\n\n[^1]: 第二😀\n"));
  });

  it("an empty paragraph the user put in the body stays where it was", () => {
    const s = load("a[^1] b[^2] c\n\n[^1]: one\n\n[^2]: two\n");
    const { state } = s.editor;
    const afterFirst = state.doc.child(0).nodeSize;
    s.editor.view.dispatch(state.tr.insert(afterFirst, state.schema.nodes.paragraph.create()));
    deleteRef(s, "1");
    expect(blocks(s.editor.state.doc)).toEqual(["paragraph", "empty", "footnote_definition", "empty"]);
  });

  it("empty paragraphs after the definitions stay after them", () => {
    const s = load("a[^1] b[^2] c\n\n[^1]: one\n\n[^2]: two\n");
    const { state } = s.editor;
    s.editor.view.dispatch(state.tr.insert(state.doc.content.size, state.schema.nodes.paragraph.create()));
    expect(blocks(s.editor.state.doc)).toEqual(["paragraph", "footnote_definition", "footnote_definition", "empty", "empty"]);
    deleteRef(s, "1");
    expect(blocks(s.editor.state.doc)).toEqual(["paragraph", "footnote_definition", "empty", "empty"]);
  });
});

describe("footnote insertion keeps the trailing paragraph at the end", () => {
  it("inserting a second footnote strands no empty paragraph", () => {
    const s = load("a[^1] b\n\n[^1]: one\n");
    const { state } = s.editor;
    const end = state.doc.child(0).nodeSize - 1;
    s.editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, end)));
    expect(insertFootnoteAndOpenPopup(s.editor)).toBe(true);
    expect(blocks(s.editor.state.doc)).toEqual(["paragraph", "footnote_definition", "footnote_definition", "empty"]);
    // The new definition is empty, which markdown cannot spell, so there is no
    // direct-load twin to compare with: assert no blank-line run instead.
    expect(s.markdown()).not.toMatch(/\n{3,}/);
  });
});
