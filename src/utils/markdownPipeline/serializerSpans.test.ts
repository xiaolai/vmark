// @vitest-environment node
// WI-AL1.4 — The span serializer: production's Markdown byte for byte, plus each top-level block's span in it. Spans are ascending and only separators lie between them; a block's span holds its own text after the cosmetic pass and the leading-rule swap moved things; an empty block has a zero-width span; a doc past the size budget, or a reference that is not production's output, has no spans (fail closed).
import { describe, expect, it } from "vitest";
import { parseMarkdown, serializeMarkdown } from "./adapter";
import { SPAN_SERIALIZE_LIMIT, serializeWithSpans } from "./serializerSpans";
import { testSchema } from "./testSchema";
import type { MarkdownPipelineOptions } from "./types";

function spansOf(markdown: string, opts: MarkdownPipelineOptions = {}) {
  const doc = parseMarkdown(testSchema, markdown, opts);
  const out = serializeWithSpans(testSchema, doc, opts);
  if (!out.ok) throw new Error(`no spans: ${out.reason}`);
  expect(out.markdown).toBe(serializeMarkdown(testSchema, doc, opts));
  expect(out.spans).toHaveLength(doc.childCount);
  let end = 0;
  for (const s of out.spans) {
    expect(s.from).toBeGreaterThanOrEqual(end);
    expect(s.to).toBeGreaterThanOrEqual(s.from);
    end = s.to;
  }
  expect(end).toBeLessThanOrEqual(out.markdown.length);
  return { doc, out, text: out.spans.map((s) => out.markdown.slice(s.from, s.to)) };
}

describe("serializeWithSpans", () => {
  it.each([
    ["headings and paragraphs", "# Title\n\nfirst\n\nsecond\n"],
    ["lists", "- a\n- b\n\n1. one\n2. two\n"],
    ["code and math", "```ts\nconst a = 1;\n```\n\n$$\nx^2\n$$\n"],
    ["a table", "| a | b |\n| - | - |\n| 1 | 2 |\n"],
    ["frontmatter", "---\ntitle: x\n---\n\nbody\n"],
    ["a leading rule", "---\n\n- item\n"],
    ["CJK and emoji", "# 标题\n\n中文段落😀\n\n> 引用\n"],
    ["escapes the cosmetic pass strips", "a \\[b\\] c\n\nd \\$e\\$ f\n\n\\[g\\]\n"],
    ["blank-line runs", "a\n\n\n\nb\n"],
  ])("%s", (_name, markdown) => {
    spansOf(markdown, { preserveBlankLines: true });
  });

  it("each block's span is its own text", () => {
    const { text } = spansOf("# Title\n\npara \\[x\\] 中文\n\n- a\n- b\n");
    expect(text[0]).toBe("# Title");
    expect(text[1]).toBe("para [x] 中文");
    expect(text[2]).toBe("- a\n- b");
  });

  it("only separators lie between spans", () => {
    const { out } = spansOf("a\n\nb\n\nc\n");
    for (let i = 1; i < out.spans.length; i++) {
      expect(out.markdown.slice(out.spans[i - 1].to, out.spans[i].from)).toMatch(/^\n+$/);
    }
  });

  it.each([
    ["the default join", "a\n\nb\n", "\n\n"],
    ["a captured blank-line run", "a\n\n\n\nb\n", "\n\n\n\n"],
    ["CJK blocks around a run", "中文\n\n\n😀\n", "\n\n\n"],
  ])("the gap between spans is the separator production emitted: %s", (_name, markdown, gap) => {
    const { out } = spansOf(markdown, { preserveBlankLines: true });
    expect(out.markdown.slice(out.spans[0].to, out.spans[1].from)).toBe(gap);
  });

  it("an empty document's one empty block has a zero-width span", () => {
    const { out } = spansOf("");
    expect(out.spans.every((s) => s.from === s.to)).toBe(true);
  });

  it("a reference that is not production's output yields no spans", () => {
    const doc = parseMarkdown(testSchema, "a\n");
    const out = serializeWithSpans(testSchema, doc, {}, "something else\n");
    expect(out).toMatchObject({ ok: false, reason: expect.stringContaining("fidelity") });
  });

  it("a document past the size budget yields no spans", () => {
    const doc = parseMarkdown(testSchema, `${"x".repeat(SPAN_SERIALIZE_LIMIT + 1)}\n`);
    expect(serializeWithSpans(testSchema, doc, {})).toMatchObject({ ok: false, reason: "size-budget" });
  });

  it.each([
    ["an image URL", (big: string) => `![pic](https://example.com/${big}.png)\n`],
    ["a link href", (big: string) => `[链接](https://example.com/${big})\n`],
  ])("a tiny document with %s past the size budget yields no spans", (_what, build) => {
    const doc = parseMarkdown(testSchema, build("a".repeat(SPAN_SERIALIZE_LIMIT)));
    expect(doc.content.size).toBeLessThan(100); // the attribute is invisible to the node size
    expect(serializeWithSpans(testSchema, doc, {})).toMatchObject({ ok: false, reason: "size-budget" });
    const reference = serializeMarkdown(testSchema, doc, {});
    expect(serializeWithSpans(testSchema, doc, {}, reference)).toMatchObject({ ok: false, reason: "size-budget" });
  });

  it("hard-break spellings each match production", () => {
    for (const hardBreakStyle of ["backslash", "twoSpaces"] as const) {
      spansOf("line one\\\nline two\n\nnext\n", { hardBreakStyle });
    }
  });
});
