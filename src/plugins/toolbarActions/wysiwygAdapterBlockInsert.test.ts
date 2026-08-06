/**
 * The WYSIWYG fenced-block inserts, tested against a REAL editor.
 *
 * These replace mock-based tests that asserted `insertContent` was called with
 * `{ language: "latex" }`. That is wiring, and it passed for as long as the bug
 * existed — the mocks could not see that the emitted markdown was a ```latex
 * code fence, that the paragraph had been split mid-word, or that the rest of
 * the line had been deleted. Every assertion here is on the markdown a user
 * would find in their file.
 *
 * The cross-surface half lives in `__tests__/parity/`; this file pins the
 * WYSIWYG contract on its own so a Source-side change cannot mask a regression
 * by moving both surfaces together.
 *
 * @coordinates-with plugins/toolbarActions/wysiwygAdapterBlockInsert.ts
 * @coordinates-with plugins/toolbarActions/__tests__/parity/surfaces — the runner
 * @module plugins/toolbarActions/wysiwygAdapterBlockInsert.test
 */
import { describe, it, expect } from "vitest";
import { runOnWysiwyg } from "./__tests__/parity/surfaces";
import {
  insertMathBlock,
  insertDiagramBlock,
  insertGraphvizBlock,
  insertMarkmapBlock,
} from "./wysiwygAdapterBlockInsert";
import type { WysiwygToolbarContext } from "./types";

const DOC = "The quick brown fox\n";
const caret = { caret: "brown" };
const range = { select: "brown" };

describe("math blocks are `$$`, not a ```latex fence", () => {
  it("emits $$ so the math is portable", () => {
    // Both render through KaTeX inside VMark, which is why this looked
    // cosmetic. It is not: GitHub, Obsidian and Pandoc render ```latex as
    // SOURCE CODE. The sentinel language round-trips as `$$`.
    const out = runOnWysiwyg(DOC, caret, "insertMath").markdown;
    expect(out).toContain("$$");
    expect(out).not.toContain("```latex");
  });

  it("leaves the formula empty rather than seeding a sample", () => {
    // A formula is a specific expression the user already has in mind, so a
    // sample only becomes junk to delete. `math-preview-empty` styles the empty
    // state deliberately. Diagrams keep their templates — see below.
    expect(runOnWysiwyg(DOC, caret, "insertMath").markdown).not.toContain("sqrt");
  });
});

describe("diagram blocks keep their scaffolding", () => {
  it.each([
    ["insertDiagram", "mermaid"],
    ["insertGraphvizDiagram", "dot"],
    ["insertMarkmap", "markmap"],
  ])("%s emits a seeded ```%s fence", (action, lang) => {
    // Diagram syntax is scaffolding-heavy: a valid tiny sample shows the shape
    // to edit. This is a deliberate split from math, not an inconsistency.
    const out = runOnWysiwyg(DOC, caret, action).markdown;
    expect(out).toContain("```" + lang);
    expect(out.split("```" + lang)[1]?.trim().length).toBeGreaterThan(0);
  });
});

describe("a caret APPENDS; it never splits the enclosing block", () => {
  it.each(["insertMath", "insertDiagram", "insertGraphvizDiagram", "insertMarkmap"])(
    "%s leaves the sentence intact",
    (action) => {
      // `insertContent` split "The quick |brown fox" at the caret and
      // serialised the orphaned trailing space as `&#x20;` into the file.
      const out = runOnWysiwyg(DOC, caret, action).markdown;
      expect(out).toContain("The quick brown fox");
      expect(out).not.toContain("&#x20;");
    }
  );
});

describe("a selection converts the whole block, losing nothing", () => {
  it.each(["insertMath", "insertDiagram"])("%s keeps the untouched text", (action) => {
    // Only the SELECTED characters used to become the block while whole lines
    // were replaced, deleting the rest of the line — "brown" survived and
    // "The quick " / " fox" did not.
    const out = runOnWysiwyg(DOC, range, action).markdown;
    expect(out).toContain("The quick brown fox");
  });

  it("strips block markup, because a fence holds literal text", () => {
    // `### Title` enters the block as `Title`. An alert or <details> is a
    // CONTAINER and keeps its markdown — that distinction is the reason the
    // strip is opt-in rather than applied to every builder.
    const out = runOnWysiwyg("### The quick brown fox\n", range, "insertMath").markdown;
    expect(out).toContain("The quick brown fox");
    expect(out).not.toContain("### The quick brown fox");
  });
});

describe("refuses without an editor", () => {
  const noEditor = { editor: null, view: null } as unknown as WysiwygToolbarContext;

  it.each([
    ["insertMathBlock", insertMathBlock],
    ["insertDiagramBlock", insertDiagramBlock],
    ["insertGraphvizBlock", insertGraphvizBlock],
    ["insertMarkmapBlock", insertMarkmapBlock],
  ])("%s returns false", (_name, fn) => {
    expect(fn(noEditor)).toBe(false);
  });
});
