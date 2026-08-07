// @vitest-environment node
// Pipeline integration for both math source guards (issues #1181,
// #1180): the guards run inside parseMarkdownToMdast, so these tests
// go through the real parseMarkdown/serializeMarkdown adapter. Unit
// coverage lives in mathSourceGuards.test.ts and
// mathDelimiterSpans.test.ts.

import { describe, it, expect } from "vitest";
import { parseMarkdown, serializeMarkdown } from "../adapter";
import { testSchema } from "../testSchema";
import { MATH_BLOCK_LANGUAGE } from "../mdastBlockConverters";
import type { Node as PMNode } from "@tiptap/pm/model";

/** Collect [typeName, language|null, textContent] rows for block nodes. */
function blockRows(doc: PMNode): Array<[string, string | null, string]> {
  const rows: Array<[string, string | null, string]> = [];
  doc.forEach((child) => {
    rows.push([
      child.type.name,
      (child.attrs?.language as string | undefined) ?? null,
      child.textContent,
    ]);
  });
  return rows;
}

describe("pipeline integration", () => {
  it("#1181 — paragraphs after an unclosed $$ survive; the later pair still parses", () => {
    const input = [
      "$$",
      "E=mc^2",
      "",
      "A normal paragraph.",
      "",
      "$$",
      "F=ma",
      "$$",
    ].join("\n");
    const doc = parseMarkdown(testSchema, input);
    const rows = blockRows(doc);

    expect(
      rows.some(
        ([type, , text]) =>
          type === "paragraph" && text.includes("A normal paragraph."),
      ),
    ).toBe(true);
    const mathBlocks = rows.filter(([, lang]) => lang === MATH_BLOCK_LANGUAGE);
    expect(mathBlocks).toHaveLength(1);
    expect(mathBlocks[0][2]).toContain("F=ma");
  });

  it("#1181 — a legit multi-line block still round-trips", () => {
    const input = ["$$", "E=mc^2", "\\alpha + \\beta", "$$"].join("\n");
    const doc = parseMarkdown(testSchema, input);
    const output = serializeMarkdown(testSchema, doc).trim();
    expect(output).toBe(input);
  });

  it("#1180 — display brackets become a block math node, serialized canonical", () => {
    const doc = parseMarkdown(testSchema, "\\[ \\alpha=0 \\]");
    const rows = blockRows(doc);
    const mathBlocks = rows.filter(([, lang]) => lang === MATH_BLOCK_LANGUAGE);
    expect(mathBlocks).toHaveLength(1);
    expect(mathBlocks[0][2]).toContain("\\alpha=0");
    const output = serializeMarkdown(testSchema, doc).trim();
    expect(output).toBe(["$$", "\\alpha=0", "$$"].join("\n"));
  });

  it("#1180 — inline brackets become inline math, serialized canonical", () => {
    const doc = parseMarkdown(testSchema, "Given \\( x^2 \\) here.");
    let sawInlineMath = false;
    doc.descendants((node) => {
      if (node.type.name === "math_inline") sawInlineMath = true;
      return true;
    });
    expect(sawInlineMath).toBe(true);
    const output = serializeMarkdown(testSchema, doc).trim();
    expect(output).toBe("Given $x^2$ here.");
  });

  it("#1180 — bracket delimiters inside code fences stay literal", () => {
    const input = ["```tex", "\\[ x \\]", "```"].join("\n");
    const doc = parseMarkdown(testSchema, input);
    const output = serializeMarkdown(testSchema, doc).trim();
    expect(output).toBe(input);
  });

  it("dialect pin: the source-position processor sees the text as written", async () => {
    // The guards run ONLY in the document parse. The source-position
    // dialect maps offsets of the raw text — rewriting there would
    // corrupt every consumer downstream. This pins the divergence as
    // intentional (same contract as remarkDisableSetextHeadings).
    const { createMarkdownProcessor } = await import("../parser");
    const processor = createMarkdownProcessor();
    const input = "Given \\( x^2 \\) here.";
    const tree = processor.runSync(processor.parse(input)) as {
      children: Array<{ children?: Array<{ type: string }> }>;
    };
    const inlineTypes = tree.children[0]?.children?.map((c) => c.type) ?? [];
    expect(inlineTypes).not.toContain("inlineMath");
  });
});
