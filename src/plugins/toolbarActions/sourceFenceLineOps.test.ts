/**
 * Line operations at the ACTION layer, inside a fence.
 *
 * `sourceBlockMove.test.ts` checks `duplicateNeedsHardBreak`, which only decides
 * whether a hard-break marker is appended. That is the wrong layer to establish
 * safety: it returned false for a delimiter — no backslash — while the action
 * still duplicated the delimiter and broke the fence. These tests drive the real
 * handlers and assert the document.
 *
 * @coordinates-with sourceTextTransforms.ts — handleDuplicateLine / handleDeleteLine
 * @module plugins/toolbarActions/sourceFenceLineOps.test
 */
import { describe, it, expect, afterEach } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { handleDuplicateLine, handleDeleteLine } from "./sourceTextTransforms";

const views: EditorView[] = [];
afterEach(() => { views.forEach((v) => { try { v.destroy(); } catch { /* */ } }); views.length = 0; });

function view(doc: string, cursor: number) {
  const parent = document.createElement("div");
  const v = new EditorView({
    state: EditorState.create({ doc, selection: EditorSelection.create([EditorSelection.cursor(cursor)]) }),
    parent,
  });
  views.push(v);
  return v;
}

const FENCE = "```js\nconst a = 1;\n```";

describe("duplicate/delete refuse fence delimiters", () => {
  it.each([
    { label: "opening delimiter", cursor: 2 },
    { label: "closing delimiter", cursor: 21 },
  ])("duplicateLine refuses the $label", ({ cursor }) => {
    const v = view(FENCE, cursor);
    expect(handleDuplicateLine(v)).toBe(false);
    expect(v.state.doc.toString()).toBe(FENCE);
  });

  it.each([
    { label: "opening delimiter", cursor: 2 },
    { label: "closing delimiter", cursor: 21 },
  ])("deleteLine refuses the $label", ({ cursor }) => {
    const v = view(FENCE, cursor);
    expect(handleDeleteLine(v)).toBe(false);
    expect(v.state.doc.toString()).toBe(FENCE);
  });

  it("duplicates fence CONTENT with no markdown hard break", () => {
    const v = view(FENCE, 10);
    expect(handleDuplicateLine(v)).toBe(true);
    expect(v.state.doc.toString()).toBe("```js\nconst a = 1;\nconst a = 1;\n```");
    expect(v.state.doc.toString()).not.toContain("\\");
  });

  it("deletes fence CONTENT", () => {
    const v = view(FENCE, 10);
    expect(handleDeleteLine(v)).toBe(true);
    expect(v.state.doc.toString()).toBe("```js\n```");
  });

  it("still adds a hard break duplicating a real paragraph", () => {
    const v = view("paragraph text", 4);
    expect(handleDuplicateLine(v)).toBe(true);
    expect(v.state.doc.toString()).toBe("paragraph text\\\nparagraph text");
  });
});
