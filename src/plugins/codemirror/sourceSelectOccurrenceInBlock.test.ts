// @vitest-environment node
/**
 * #1418 in Source mode — the behaviour, not just the bounds.
 *
 * `sourceBlockBounds.test.ts` pins what "the current block" means. This pins
 * what the user gets: cursors inside the block they are looking at, and the
 * document-wide command still reaching the whole file.
 */
import { describe, it, expect } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import type { TransactionSpec } from "@codemirror/state";
import { selectAllOccurrencesSource } from "./sourceSelectOccurrence";
import { selectAllOccurrencesInBlockSource } from "./sourceSelectOccurrenceInBlock";

/** State with the caret at `pos`. */
function at(text: string, pos: number): EditorState {
  return EditorState.create({ doc: text, selection: { anchor: pos, head: pos } });
}

/** The multi-range selection a spec carries, narrowed from the union. */
function rangesOf(spec: TransactionSpec | null): readonly { from: number; to: number }[] {
  expect(spec).not.toBeNull();
  const sel = spec!.selection;
  if (!(sel instanceof EditorSelection)) throw new Error("expected an EditorSelection");
  return sel.ranges;
}

/** Number of ranges the resulting spec selects. */
function count(spec: TransactionSpec | null): number {
  return rangesOf(spec).length;
}

// "target" twice per paragraph, two paragraphs.
const DOC = "target one target\n\ntarget two target";

describe("selectAllOccurrencesInBlockSource (#1418)", () => {
  it("selects only the matches in the caret's block", () => {
    expect(count(selectAllOccurrencesInBlockSource(at(DOC, 2)))).toBe(2);
  });

  it("the document-wide command still reaches both blocks", () => {
    expect(count(selectAllOccurrencesSource(at(DOC, 2)))).toBe(4);
  });

  it("scopes to the second block when the caret is there", () => {
    const state = at(DOC, DOC.indexOf("target two") + 2);
    const ranges = rangesOf(selectAllOccurrencesInBlockSource(state));
    expect(ranges).toHaveLength(2);
    const secondBlockStart = DOC.indexOf("target two");
    for (const r of ranges) {
      expect(r.from).toBeGreaterThanOrEqual(secondBlockStart);
    }
  });

  it("spans a multi-line paragraph, since blank lines are the boundary", () => {
    const doc = "alpha beta\nbeta gamma\n\nbeta delta";
    expect(count(selectAllOccurrencesInBlockSource(at(doc, 7)))).toBe(2);
  });

  it("declines on a blank line rather than widening to the document", () => {
    expect(selectAllOccurrencesInBlockSource(at(DOC, DOC.indexOf("\n\n") + 1))).toBeNull();
  });

  /** Inside a fence the fence decides, so this matches the existing behaviour. */
  it("stays inside a code fence", () => {
    const doc = "```js\nlet val = val\n```\n\nval outside val";
    const state = at(doc, doc.indexOf("let val") + 5);
    expect(count(selectAllOccurrencesInBlockSource(state))).toBe(
      count(selectAllOccurrencesSource(state)),
    );
  });

  it("returns null when there is no word under the caret", () => {
    expect(selectAllOccurrencesInBlockSource(at("", 0))).toBeNull();
  });
});
