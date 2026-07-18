/**
 * Tests for findMatchesInDoc — per-inline-parent aggregated matching.
 *
 * Covers: cross-mark-boundary matches (PL-8), atom handling (no fabricated
 * text), exact positions for decorations/replace, per-node parity for simple
 * text, nested inline content, and document ordering.
 */

import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { findMatchesInDoc } from "./findMatches";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    codeBlock: { content: "text*", group: "block", marks: "", code: true },
    text: { inline: true, group: "inline" },
    atom: { inline: true, group: "inline", atom: true },
    wikiLink: { inline: true, group: "inline", content: "text*" },
  },
  marks: { bold: {} },
});

const bold = schema.marks.bold.create();

function doc(...blocks: ReturnType<typeof schema.node>[]) {
  return schema.node("doc", null, blocks);
}

function p(...inline: Array<ReturnType<typeof schema.node> | ReturnType<typeof schema.text>>) {
  return schema.node("paragraph", null, inline);
}

describe("findMatchesInDoc", () => {
  describe("simple text (per-node parity)", () => {
    it("returns empty for empty query", () => {
      expect(findMatchesInDoc(doc(p(schema.text("hello"))), "", false, false, false)).toEqual([]);
    });

    it("finds a single match with exact positions", () => {
      const matches = findMatchesInDoc(doc(p(schema.text("hello world"))), "hello", false, false, false);
      expect(matches).toEqual([{ from: 1, to: 6 }]);
    });

    it("finds multiple matches in one block", () => {
      const matches = findMatchesInDoc(doc(p(schema.text("foo bar foo"))), "foo", false, false, false);
      expect(matches).toEqual([
        { from: 1, to: 4 },
        { from: 9, to: 12 },
      ]);
    });

    it("finds matches across multiple paragraphs but never spanning them", () => {
      const d = doc(p(schema.text("hello")), p(schema.text("hello")));
      expect(findMatchesInDoc(d, "hello", false, false, false)).toEqual([
        { from: 1, to: 6 },
        { from: 8, to: 13 },
      ]);
      // No cross-block match (parity with Source mode)
      expect(findMatchesInDoc(d, "hello hello", false, false, false)).toEqual([]);
    });

    it("respects caseSensitive / wholeWord / regex options", () => {
      const d = doc(p(schema.text("Foo foobar foo")));
      expect(findMatchesInDoc(d, "foo", true, false, false)).toHaveLength(2);
      expect(findMatchesInDoc(d, "foo", false, true, false)).toHaveLength(2);
      expect(findMatchesInDoc(d, "f.o", false, false, true)).toHaveLength(3);
    });

    it("returns empty for invalid regex", () => {
      const d = doc(p(schema.text("hello")));
      expect(findMatchesInDoc(d, "[invalid", false, false, true)).toEqual([]);
    });

    it("handles zero-length regex matches without an infinite loop", () => {
      const d = doc(p(schema.text("abc")));
      const matches = findMatchesInDoc(d, "(?:)", false, false, true);
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  describe("mark boundaries (PL-8)", () => {
    it("finds a query spanning a bold boundary with exact from/to", () => {
      // "foo **bar**": "foo " at 1..5, bold "bar" at 5..8
      const d = doc(p(schema.text("foo "), schema.text("bar", [bold])));
      const matches = findMatchesInDoc(d, "foo bar", false, false, false);
      expect(matches).toEqual([{ from: 1, to: 8 }]);
    });

    it("replace across the boundary via replaceWith produces correct text", () => {
      const d = doc(p(schema.text("foo "), schema.text("bar", [bold])));
      const [match] = findMatchesInDoc(d, "foo bar", false, false, false);
      const state = EditorState.create({ doc: d });
      const tr = state.tr.replaceWith(match.from, match.to, schema.text("baz"));
      expect(tr.doc.textContent).toBe("baz");
    });

    it("finds a query spanning three differently-marked segments", () => {
      const d = doc(p(schema.text("a"), schema.text("b", [bold]), schema.text("c")));
      expect(findMatchesInDoc(d, "abc", false, false, false)).toEqual([{ from: 1, to: 4 }]);
    });
  });

  describe("inline atoms and hard-break-like leaves", () => {
    it("does not match across an atom (no fabricated text)", () => {
      // "foo " at 1..5, atom at 5..6, "bar" at 6..9
      const d = doc(p(schema.text("foo "), schema.node("atom"), schema.text("bar")));
      expect(findMatchesInDoc(d, "foo bar", false, false, false)).toEqual([]);
      expect(findMatchesInDoc(d, "foo b", false, false, false)).toEqual([]);
    });

    it("finds text on both sides of an atom with exact positions", () => {
      const d = doc(p(schema.text("foo "), schema.node("atom"), schema.text("bar")));
      expect(findMatchesInDoc(d, "foo", false, false, false)).toEqual([{ from: 1, to: 4 }]);
      expect(findMatchesInDoc(d, "bar", false, false, false)).toEqual([{ from: 6, to: 9 }]);
    });
  });

  describe("nested inline content and code blocks", () => {
    it("finds text inside an inline node with content (wiki link)", () => {
      // paragraph: "see " at 1..5, wikiLink node at 5, its text starts at 6
      const d = doc(p(schema.text("see "), schema.node("wikiLink", null, [schema.text("target")])));
      expect(findMatchesInDoc(d, "target", false, false, false)).toEqual([{ from: 6, to: 12 }]);
    });

    it("returns matches in document order when text follows a nested inline node", () => {
      const d = doc(
        p(
          schema.text("x "),
          schema.node("wikiLink", null, [schema.text("x")]),
          schema.text(" x")
        )
      );
      const matches = findMatchesInDoc(d, "x", false, false, false);
      const froms = matches.map((m) => m.from);
      expect(froms).toEqual([...froms].sort((a, b) => a - b));
      expect(matches).toHaveLength(3);
    });

    it("finds matches inside code blocks", () => {
      const d = doc(schema.node("codeBlock", null, [schema.text("const foo = 1;")]));
      expect(findMatchesInDoc(d, "foo", false, false, false)).toEqual([{ from: 7, to: 10 }]);
    });
  });

  describe("edge cases", () => {
    it("handles empty blocks", () => {
      expect(findMatchesInDoc(doc(p()), "x", false, false, false)).toEqual([]);
    });

    it("decoration/replace positions stay exact when match is not at block start", () => {
      const d = doc(p(schema.text("aa "), schema.text("bb", [bold]), schema.text(" cc")));
      const matches = findMatchesInDoc(d, "bb cc", false, false, false);
      expect(matches).toEqual([{ from: 4, to: 9 }]);
      const state = EditorState.create({ doc: d });
      const tr = state.tr.replaceWith(matches[0].from, matches[0].to, schema.text("Z"));
      expect(tr.doc.textContent).toBe("aa Z");
    });
  });
});
