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
import { syntaxTree } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { markdownLanguageSupport } from "./markdownLanguageSupport";

function nodeTypes(doc: string, extension = markdownLanguageSupport([])): Set<string> {
  const state = EditorState.create({ doc, extensions: [extension] });
  const seen = new Set<string>();
  syntaxTree(state).iterate({ enter: (n) => void seen.add(n.name) });
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
