// @vitest-environment node
/**
 * Setext headings, and the one document shape that must still refuse them.
 *
 * `remarkDisableSetextHeadings` exists to stop an empty nested list item (`  -`)
 * being read as a setext underline for the paragraph above it — a real
 * corruption. Disabling setext for EVERY document to prevent it was the wrong
 * trade: an authored `Title` over `=====` became a paragraph whose underline was
 * escaped to `\=====`, and `Title` over `-----` became a paragraph plus a
 * thematic break, with useTiptapFlush persisting the damage on the next
 * keystroke. Only the first corruption had ever been measured.
 *
 * The protection now applies only to documents that actually carry the
 * ambiguous line, which is the same content-aware plugin loading the parser
 * already uses for math, frontmatter, wiki links and details.
 *
 * @coordinates-with ../parser/remarkPlugins.ts — analyzeContent + the plugin
 * @coordinates-with ../parser/processorFactory.ts — conditional application
 * @module utils/markdownPipeline/__tests__/setextHeadings.test
 */
import { describe, it, expect } from "vitest";
import { parseMarkdownToMdast } from "../parser";
import { parseMarkdown, serializeMarkdown } from "../adapter";
import { getProductionSchema } from "@/test/productionSchema";

const schema = getProductionSchema();
const blocks = (md: string): string[] =>
  (parseMarkdownToMdast(md).children as Array<{ type: string; depth?: number }>).map((n) =>
    n.type === "heading" ? `heading(${n.depth})` : n.type,
  );
const roundTrip = (md: string): string => serializeMarkdown(schema, parseMarkdown(schema, md));

describe("setext headings are read as headings", () => {
  it.each([
    { name: "level one", md: "Title\n=====\n", depth: 1 },
    { name: "level two", md: "Title\n-----\n", depth: 2 },
    { name: "short underline", md: "Title\n=\n", depth: 1 },
    { name: "CJK title", md: "中文标题\n=====\n", depth: 1 },
  ])("parses a $name underline", ({ md, depth }) => {
    expect(blocks(md)).toEqual([`heading(${depth})`]);
  });

  it.each([
    { md: "Title\n=====\n", atx: "# Title\n" },
    { md: "Title\n-----\n", atx: "## Title\n" },
  ])("re-emits it as ATX, VMark's single heading spelling", ({ md, atx }) => {
    expect(roundTrip(md)).toBe(atx);
  });

  it("no longer escapes the underline into the document", () => {
    expect(roundTrip("Title\n=====\n")).not.toContain("\\=");
  });

  it("no longer turns a level-two underline into a thematic break", () => {
    expect(blocks("Title\n-----\n")).not.toContain("thematicBreak");
  });

  it("keeps ATX headings working unchanged", () => {
    expect(blocks("# One\n\n## Two\n")).toEqual(["heading(1)", "heading(2)"]);
  });
});

describe("the empty-nested-list-item protection still applies", () => {
  // `  -` directly under a paragraph is the shape CommonMark reads as a setext
  // underline and the author means as an empty nested item. Documents carrying
  // it keep setext disabled, so the list survives.
  const ambiguous = "- item\n  -\n";

  it("does not read an indented lone marker as a heading underline", () => {
    expect(blocks(ambiguous)).not.toContain("heading(2)");
  });

  it.each(["  -\n", "\t*\n", "   +\n"])("detects the ambiguous line %j anywhere in the document", (line) => {
    expect(blocks(`Some paragraph\n\n- item\n${line}`)).not.toContain("heading(2)");
  });

  it("still disables setext for the WHOLE document when the line is present", () => {
    // The trade-off is document-level: a file containing both keeps the older,
    // safer behaviour rather than guessing per-line.
    expect(blocks("Title\n=====\n\n- item\n  -\n")).not.toContain("heading(1)");
  });
});

describe("setext protection is scoped to real ambiguity", () => {
  it("does not disable setext headings for a marker inside a fenced code block", () => {
    // `  -` in a code sample is literal text. Treating it as an ambiguous
    // underline disabled setext parsing document-wide, so this real heading
    // silently became a paragraph.
    const md = ["```yaml", "list:", "  -", "```", "", "Real Heading", "-----------", ""].join("\n");
    const doc = parseMarkdown(getProductionSchema(), md);
    const types: string[] = [];
    doc.descendants((n) => {
      types.push(n.type.name);
    });
    expect(types).toContain("heading");
  });

  it("still disables setext when the ambiguous marker is real", () => {
    const md = ["Paragraph", "  -", ""].join("\n");
    const doc = parseMarkdown(getProductionSchema(), md);
    let sawHeading = false;
    doc.descendants((n) => {
      if (n.type.name === "heading") sawHeading = true;
    });
    expect(sawHeading).toBe(false);
  });
});

describe("fence stripping recognises valid closing fences", () => {
  it("still sees ambiguity after a fence closed by a LONGER run", () => {
    // CommonMark lets a 3-backtick block close with 4+. Matching repetitions of
    // the whole opener missed that, so the strip ran to end-of-input and hid
    // the real ambiguous marker below.
    const md = ["```", "code", "````", "", "Para", "  -", ""].join("\n");
    const doc = parseMarkdown(getProductionSchema(), md);
    let sawHeading = false;
    doc.descendants((n) => {
      if (n.type.name === "heading") sawHeading = true;
    });
    expect(sawHeading).toBe(false); // protection still applies — ambiguity was seen
  });

  it("does not let a tilde run close a backtick fence", () => {
    const md = ["```", "~~~", "  -", "```", "", "Real Heading", "-----------", ""].join("\n");
    const doc = parseMarkdown(getProductionSchema(), md);
    const types: string[] = [];
    doc.descendants((n) => types.push(n.type.name));
    expect(types).toContain("heading");
  });
});
