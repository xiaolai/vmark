// @vitest-environment node
/**
 * Contract: the editor parses the same language the document parser does.
 *
 * `markdownPipeline` loads `remark-gfm` unconditionally. If the CodeMirror base
 * ever drifts back to CommonMark, GFM constructs stop existing in the syntax
 * tree — silently, because a missing node type reads as "no table here" rather
 * than an error. These tests name the node types so that regression is loud.
 *
 * @coordinates-with markdownLanguageSupport.ts
 * @module lib/formats/markdownLanguageSupport.test
 */
import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { markdownLanguageSupport } from "./markdownLanguageSupport";

function nodeTypes(doc: string, extension = markdownLanguageSupport([])): Set<string> {
  const state = EditorState.create({ doc, extensions: [extension] });
  // `ensureSyntaxTree`, NOT `syntaxTree`. CodeMirror parses under a work
  // budget, and `syntaxTree(state)` returns whatever has been parsed SO FAR —
  // a partial tree is a documented, legitimate return value. Asserting
  // `toContain("Blockquote")` on it therefore asserts that the machine got far
  // enough, not that the grammar has the node: under a parallel full-suite run
  // this returned ['Document', 'ATXHeading1', …] and failed on a document
  // whose blockquote was simply beyond where the parser had reached.
  //
  // The 5 s argument is a LIVENESS bound, not a performance assertion — it is
  // orders of magnitude above the real parse cost for these few-line documents,
  // so it fires only if parsing has genuinely stalled. A null return is a hard
  // failure rather than a silent fall back to the partial tree, which would put
  // the flake straight back.
  const tree = ensureSyntaxTree(state, doc.length, 5000);
  if (!tree) throw new Error("parser did not finish within 5s — not a partial-tree fallback");
  // Encodes the property directly, so a revert to `syntaxTree` fails loudly
  // here rather than as a mystery "expected [...] to include 'Blockquote'"
  // somewhere downstream. Measured: on a 72 kB document `syntaxTree` covered
  // 3,013 chars (4%) while `ensureSyntaxTree` covered all 72,044.
  if (tree.length !== doc.length) {
    throw new Error(
      `syntax tree covers ${tree.length}/${doc.length} chars — a PARTIAL parse; ` +
        `node-type assertions on it test how far the parser got, not the grammar`,
    );
  }
  const seen = new Set<string>();
  tree.iterate({ enter: (n) => void seen.add(n.name) });
  return seen;
}

describe("markdownLanguageSupport parses GFM", () => {
  it("sees a table as a Table", () => {
    const types = nodeTypes("| A | B |\n| --- | --- |\n| 1 | 2 |\n");
    expect(types).toContain("Table");
    expect(types).toContain("TableHeader");
    expect(types).toContain("TableRow");
    expect(types).toContain("TableCell");
    expect(types).toContain("TableDelimiter");
  });

  it("sees a task item as a Task", () => {
    const types = nodeTypes("- [ ] todo\n- [x] done\n");
    expect(types).toContain("Task");
    expect(types).toContain("TaskMarker");
  });

  it("sees strikethrough", () => {
    expect(nodeTypes("~~struck~~\n")).toContain("Strikethrough");
  });

  it("sees an autolink as a URL", () => {
    expect(nodeTypes("www.example.com\n")).toContain("URL");
  });

  it("sees subscript and superscript, which VMark's toolbar also offers", () => {
    const types = nodeTypes("H~2~O and X^2^\n");
    expect(types).toContain("Subscript");
    expect(types).toContain("Superscript");
  });

  it("still parses plain CommonMark structures", () => {
    const types = nodeTypes("# Heading\n\n> quote\n\n- item\n\n```js\ncode\n```\n");
    for (const name of ["ATXHeading1", "Blockquote", "BulletList", "FencedCode"]) {
      expect(types).toContain(name);
    }
  });
});

describe("the regression this guards", () => {
  // Bare `markdown()` defaults to strict CommonMark. Asserting that it does NOT
  // see these keeps the test honest: if a future lang-markdown made GFM the
  // default, this would fail and the guard above would be shown as vacuous.
  it("bare markdown() does NOT see GFM constructs", () => {
    const types = nodeTypes("| A | B |\n| --- | --- |\n| 1 | 2 |\n", markdown({}));
    expect(types).not.toContain("Table");
  });

  it("bare markdown() does not see task items either", () => {
    expect(nodeTypes("- [ ] todo\n", markdown({}))).not.toContain("Task");
  });
});
