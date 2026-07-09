// WI-4.1 follow-up (audit round 1, finding #1) — composed source unlink:
// inline and wiki links via the existing path, PLUS reference links
// ([text][label], [text][]) which previously made "Remove Link" a no-op.

import { describe, expect, it } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { removeSourceLinkAtCursor } from "./sourceUnlink";

function createView(doc: string, cursor: number): EditorView {
  return new EditorView({
    state: EditorState.create({ doc, selection: EditorSelection.single(cursor) }),
  });
}

function run(doc: string, cursor: number): { handled: boolean; text: string } {
  const view = createView(doc, cursor);
  const handled = removeSourceLinkAtCursor(view);
  const text = view.state.doc.toString();
  view.destroy();
  return { handled, text };
}

describe("removeSourceLinkAtCursor", () => {
  it("unwraps inline links (existing path)", () => {
    expect(run("see [text](https://x.example) here", 6)).toEqual({
      handled: true,
      text: "see text here",
    });
  });

  it("unwraps wiki links (existing path)", () => {
    expect(run("see [[target|alias]] here", 8)).toEqual({
      handled: true,
      text: "see alias here",
    });
  });

  it("unwraps full reference links, keeping the text", () => {
    expect(run("see [text][label] here", 6)).toEqual({
      handled: true,
      text: "see text here",
    });
  });

  it("unwraps collapsed reference links", () => {
    expect(run("[text][] tail", 3)).toEqual({ handled: true, text: "text tail" });
  });

  it("leaves image references alone", () => {
    const doc = "![alt][ref]";
    expect(run(doc, 4)).toEqual({ handled: false, text: doc });
  });

  it("no-ops outside any link", () => {
    const doc = "plain text";
    expect(run(doc, 3)).toEqual({ handled: false, text: doc });
  });
});
