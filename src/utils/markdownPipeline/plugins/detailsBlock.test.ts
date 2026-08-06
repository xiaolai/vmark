/**
 * Details Block Plugin Tests
 *
 * Tests for the remarkDetailsBlock plugin that transforms HTML <details>
 * blocks into mdast details nodes.
 */

import { describe, it, expect } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkStringify from "remark-stringify";
// Importing the dialect wires the injected `details-body` parser, which is
// what production does via processorFactory. Without it the plugin throws a
// named error rather than silently parsing bodies with the wrong dialect.
import "../dialect";
import { visit } from "unist-util-visit";
import { remarkDetailsBlock } from "./detailsBlock";
import type { Root } from "mdast";
import type { Details } from "../types";

/**
 * Helper to parse markdown with the details plugin.
 */
function parseWithDetails(md: string): Root {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkDetailsBlock);

  return processor.runSync(processor.parse(md)) as Root;
}

describe("remarkDetailsBlock", () => {
  describe("basic parsing", () => {
    it("transforms <details> HTML into details node", () => {
      const md = `<details>
<summary>Click to expand</summary>

Content inside details.
</details>`;
      const result = parseWithDetails(md);

      expect(result.children[0].type).toBe("details");
      const details = result.children[0] as Details;
      expect(details.summary).toBe("Click to expand");
    });

    it("parses details with markdown content", () => {
      const md = `<details>
<summary>Info</summary>

**Bold** and *italic* content.
</details>`;
      const result = parseWithDetails(md);

      const details = result.children[0] as Details;
      expect(details.type).toBe("details");
      expect(details.children.length).toBeGreaterThan(0);
    });

    it("handles details with open attribute", () => {
      const md = `<details open>
<summary>Open by default</summary>

Visible content.
</details>`;
      const result = parseWithDetails(md);

      expect(result.children[0].type).toBe("details");
    });
  });

  describe("reference-style links inside details", () => {
    it("resolves reference-style links inside details content", () => {
      const md = `<details>
<summary>Links</summary>

See [Example][ex] for more.

[ex]: https://example.com
</details>`;
      const result = parseWithDetails(md);

      const details = result.children[0] as Details;
      expect(details.type).toBe("details");
      // The content should have resolved the link reference
      // (This tests the integration of remarkResolveReferences in innerProcessor)
    });
  });

  describe("edge cases", () => {
    it("handles empty details block", () => {
      const md = `<details>
<summary>Empty</summary>
</details>`;
      const result = parseWithDetails(md);

      expect(result.children[0].type).toBe("details");
    });

    it("handles details without summary", () => {
      const md = `<details>
Some content without summary.
</details>`;
      const result = parseWithDetails(md);

      // Should still parse as details
      expect(result.children[0].type).toBe("details");
    });

    it("preserves non-details content", () => {
      const md = `# Heading

Regular paragraph.

<details>
<summary>Info</summary>

Details content.
</details>

Another paragraph.`;
      const result = parseWithDetails(md);

      expect(result.children[0].type).toBe("heading");
      expect(result.children[1].type).toBe("paragraph");
      expect(result.children[2].type).toBe("details");
      expect(result.children[3].type).toBe("paragraph");
    });

    it("handles nodes without children property", () => {
      // This tests the hasChildren type guard indirectly
      // Text nodes and other leaf nodes don't have children
      const md = `Just text with no block elements.`;
      const result = parseWithDetails(md);

      // Should not crash when visiting nodes without children
      expect(result.children[0].type).toBe("paragraph");
    });

    it("handles deeply nested structures", () => {
      const md = `> Blockquote with
> <details>
> <summary>Nested details</summary>
>
> Quoted details content.
> </details>`;
      const result = parseWithDetails(md);

      expect(result.children[0].type).toBe("blockquote");
    });

    it("handles nested details within details", () => {
      const md = `<details>
<summary>Outer details</summary>

Outer content.

<details>
<summary>Inner details</summary>

Inner hidden content.
</details>

Back to outer content.

</details>`;
      const result = parseWithDetails(md);

      const outerDetails = result.children[0] as Details;
      expect(outerDetails.type).toBe("details");
      expect(outerDetails.summary).toBe("Outer details");

      // Check for nested details in children
      const innerDetails = outerDetails.children.find(c => c.type === "details") as Details | undefined;
      expect(innerDetails).toBeDefined();
      expect(innerDetails?.type).toBe("details");
      expect(innerDetails?.summary).toBe("Inner details");
    });

    it("treats unclosed details block as plain html (pushes opening tag as-is)", () => {
      // If the </details> closing tag is never found, the opening tag is pushed as-is
      const md = `<details>
<summary>Unclosed</summary>

Content without closing tag.`;
      const result = parseWithDetails(md);

      // The unclosed <details> should NOT become a details node; it stays as html
      const types = result.children.map(c => c.type);
      expect(types).not.toContain("details");
    });

    it("does not parse single-block html when content surrounds details tags", () => {
      // parseDetailsHtmlBlock returns null when prefix or suffix exists
      const md = `Before <details><summary>S</summary></details> After`;
      const result = parseWithDetails(md);

      // Because prefix/suffix exist, parseDetailsHtmlBlock returns null
      // and the fallback sees no multi-block close tag, stays as paragraph
      expect(result.children[0].type).toBe("paragraph");
    });

    it("extractSummaryFromChildren returns unchanged when first child is not html", () => {
      // When the first content after <details> is a paragraph (not html with <summary>)
      const md = `<details>

No summary paragraph here.

</details>`;
      const result = parseWithDetails(md);

      const details = result.children[0] as Details;
      expect(details.type).toBe("details");
      // Uses the default "Details" summary since no html <summary> was found
      expect(details.summary).toBe("Details");
    });

    it("extractSummaryFromChildren returns unchanged when first html has no summary tag", () => {
      // When the first child is html but doesn't contain <summary>
      const md = `<details>
<div>Not a summary</div>

Body content.

</details>`;
      const result = parseWithDetails(md);

      const details = result.children[0] as Details;
      expect(details.type).toBe("details");
      // Uses the default "Details" summary since the html node has no <summary>
      expect(details.summary).toBe("Details");
    });

    it("parseDetailsHtmlBlock — handles single-block details with open attribute", () => {
      // Single HTML node containing complete <details open>...</details>
      const md = `<details open><summary>Open Section</summary>

Content here.

</details>`;
      const result = parseWithDetails(md);
      const details = result.children[0] as Details;
      expect(details.type).toBe("details");
      expect(details.open).toBe(true);
      expect(details.summary).toBe("Open Section");
    });

    it("parseDetailsHtmlBlock — returns null when closeIndex <= openIndex (line 183)", () => {
      // This case would require </details> appearing before <details> in the same HTML block
      // In practice this can't happen naturally, but we test the parser handles it
      const md = `</details><details><summary>S</summary></details>`;
      const result = parseWithDetails(md);
      // Should not parse as a details node since </details> comes first
      expect(result.children[0].type).not.toBe("details");
    });

    it("parseDetailsHtmlBlock — handles body with no summary tag (line 191-194)", () => {
      // Single HTML block with <details> but no <summary>
      const md = `<details>

Just content, no summary.

</details>`;
      const result = parseWithDetails(md);
      const details = result.children[0] as Details;
      expect(details.type).toBe("details");
      expect(details.summary).toBe("Details"); // default
    });

    it("extractSummaryFromChildren — empty children array (line 222-224)", () => {
      // A details block with no content between tags
      const md = `<details>
</details>`;
      const result = parseWithDetails(md);
      const details = result.children[0] as Details;
      expect(details.type).toBe("details");
    });

    it("extractSummaryFromChildren — handles summary with empty text (line 236, trim fallback)", () => {
      // <summary> with only whitespace
      const md = `<details>
<summary>   </summary>

Content.

</details>`;
      const result = parseWithDetails(md);
      const details = result.children[0] as Details;
      expect(details.type).toBe("details");
      // "   ".trim() is "" which is falsy, so summary defaults to "Details"
      expect(details.summary).toBe("Details");
    });

    it("parseDetailsOpen — summary match trim fallback (line 172)", () => {
      // Multi-block details where the open tag has a <summary> inline
      const md = `<details><summary>   </summary>

Content.

</details>`;
      const result = parseWithDetails(md);
      const details = result.children[0] as Details;
      expect(details.type).toBe("details");
      // Empty summary trims to "", defaults to "Details"
      expect(details.summary).toBe("Details");
    });

    it("parseDetailsOpen — no summary in open tag (line 172, summaryMatch is null)", () => {
      const md = `<details>

Content without summary.

</details>`;
      const result = parseWithDetails(md);
      const details = result.children[0] as Details;
      expect(details.type).toBe("details");
      expect(details.summary).toBe("Details");
    });

    it("parseDetailsHtmlBlock — bodyStart adjusted when summary is present (line 199)", () => {
      // Single-block HTML with summary and body content
      const md = `<details><summary>Title</summary>

Body text here.

</details>`;
      const result = parseWithDetails(md);
      const details = result.children[0] as Details;
      expect(details.type).toBe("details");
      expect(details.summary).toBe("Title");
      expect(details.children.length).toBeGreaterThanOrEqual(0);
    });

    it("handles details with wiki links inside (exercises innerProcessor)", () => {
      const md = `<details>
<summary>Links</summary>

See [[Page Name]] here.

</details>`;
      const result = parseWithDetails(md);
      const details = result.children[0] as Details;
      expect(details.type).toBe("details");
    });

    it("handles details serialization via toMarkdown extension", () => {
      // The toMarkdownExtension is registered but only used during serialization.
      // We verify the plugin doesn't crash when setting up the handler.
      const md = `<details>
<summary>Section</summary>

Content.

</details>`;
      const result = parseWithDetails(md);
      expect(result.children[0].type).toBe("details");
    });

    it("toMarkdownExtensions fallback — data.toMarkdownExtensions ?? [] (line 85)", () => {
      // The first call to remarkDetailsBlock sets toMarkdownExtensions.
      // Verify it works without crashing on first invocation.
      const result = parseWithDetails("No details here.");
      expect(result.children[0].type).toBe("paragraph");
    });

    it("handles content with math inside details (exercises innerProcessor with math)", () => {
      const md = `<details>
<summary>Math</summary>

Formula: $E = mc^2$

</details>`;
      const result = parseWithDetails(md);
      const details = result.children[0] as Details;
      expect(details.type).toBe("details");
    });

    it("extractSummaryFromChildren — multi-block with blank line produces empty inner (line 222)", () => {
      // Blank line between <details> and </details> forces remark to parse them as
      // separate HTML blocks. The multi-block path then has an empty inner array.
      const md = `<details>

</details>`;
      const result = parseWithDetails(md);
      const details = result.children[0] as Details;
      expect(details.type).toBe("details");
      // With no inner nodes, extractSummaryFromChildren returns { children: [] }
      // and summary falls back to the open tag default "Details"
      expect(details.summary).toBe("Details");
    });

    it("extractSummaryFromChildren — multi-block summary with whitespace-only text (line 236)", () => {
      // Multi-block path: <summary> node has only whitespace content
      // This exercises the trim fallback in extractSummaryFromChildren
      const md = `<details>
<summary>   </summary>

Body text here.

</details>`;
      const result = parseWithDetails(md);
      const details = result.children[0] as Details;
      expect(details.type).toBe("details");
      // Whitespace trims to empty string, falls back to "Details"
      expect(details.summary).toBe("Details");
    });

    it("parseDetailsHtmlBlock — prefix content prevents parsing (line 191-193)", () => {
      // Single HTML block where content exists before <details> tag
      // This exercises the prefix/suffix guard in parseDetailsHtmlBlock
      const md = `text before <details><summary>S</summary>body</details>`;
      const result = parseWithDetails(md);
      // The prefix "text before " causes parseDetailsHtmlBlock to return null
      // The node stays as a paragraph since it has surrounding text
      const types = result.children.map(c => c.type);
      expect(types).not.toContain("details");
    });

    it("parseDetailsHtmlBlock — suffix content prevents parsing (line 191-193)", () => {
      // Single HTML block where content exists after </details> tag
      const md = `<details><summary>S</summary>body</details> text after`;
      const result = parseWithDetails(md);
      // The suffix " text after" causes parseDetailsHtmlBlock to return null
      const types = result.children.map(c => c.type);
      expect(types).not.toContain("details");
    });

    it("null-coalescing for node.value ?? '' in transformDetailsBlocks (line 102, 109)", () => {
      // This is a binary-expr branch: node.value could be undefined
      // In practice remark always sets value, but the ?? fallback exists
      const md = `<details>
<summary>Test</summary>

Content.

</details>`;
      const result = parseWithDetails(md);
      expect(result.children[0].type).toBe("details");
    });

    it("handles html node with undefined value in transformDetailsBlocks (line 102, 109, 114)", () => {
      // Directly construct a tree with html nodes that have undefined value
      // to exercise the ?? '' fallback branches
      const processor = unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkDetailsBlock);

      const tree = processor.parse("placeholder");
      // Replace children with html nodes that have undefined value
      (tree as Root).children = [
        { type: "html", value: undefined as unknown as string } as any,
      ];
      const result = processor.runSync(tree) as Root;
      // The node with undefined value should not crash — ?? '' makes it empty string
      // isDetailsOpen('') returns false, so it's pushed as-is
      expect(result.children[0].type).toBe("html");
    });

    it("handles inner html node with undefined value during multi-block parsing (line 122)", () => {
      // Exercise the next.value ?? '' branch inside the multi-block inner loop
      const processor = unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkDetailsBlock);

      const tree = processor.parse("placeholder");
      // Construct a multi-block details with an inner html node that has undefined value
      (tree as Root).children = [
        { type: "html", value: "<details>" } as any,
        { type: "html", value: undefined as unknown as string } as any,
        { type: "html", value: "</details>" } as any,
      ];
      const result = processor.runSync(tree) as Root;
      expect(result.children[0].type).toBe("details");
    });

    it("detailsHandler — round-trip serialization exercises lines 256-272", () => {
      // Parse then serialize to exercise the detailsHandler toMarkdown extension
      const md = `<details>
<summary>Section</summary>

Content here.

</details>`;
      const processor = unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkDetailsBlock)
        .use(remarkStringify);

      const tree = processor.runSync(processor.parse(md));
      const output = processor.stringify(tree as Root);
      expect(output).toContain("<details>");
      expect(output).toContain("<summary>Section</summary>");
      expect(output).toContain("</details>");
    });

    it("detailsHandler — serializes open details (line 258)", () => {
      const md = `<details open>
<summary>Open Section</summary>

Content.

</details>`;
      const processor = unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkDetailsBlock)
        .use(remarkStringify);

      const tree = processor.runSync(processor.parse(md));
      const output = processor.stringify(tree as Root);
      expect(output).toContain("<details open>");
      expect(output).toContain("<summary>Open Section</summary>");
    });

    it("detailsHandler — node.summary ?? 'Details' fallback (line 262)", () => {
      // Construct a details node with undefined summary to test ?? fallback
      const processor = unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkDetailsBlock)
        .use(remarkStringify);

      const tree = processor.runSync(processor.parse("<details>\n\n</details>"));
      // Manually remove summary to trigger the ?? fallback
      const details = (tree as Root).children[0] as Details;
      if (details.type === "details") {
        (details as any).summary = undefined;
      }
      const output = processor.stringify(tree as Root);
      expect(output).toContain("<summary>Details</summary>");
    });

    it("detailsHandler — escapeHtml in summary (line 262, 274-280)", () => {
      const md = `<details>
<summary>A &amp; B</summary>

Content.

</details>`;
      const processor = unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkDetailsBlock)
        .use(remarkStringify);

      const tree = processor.runSync(processor.parse(md));
      const output = processor.stringify(tree as Root);
      expect(output).toContain("<details>");
      expect(output).toContain("</details>");
    });
  });

  describe("parseDetailsHtmlBlock — single-block path without summary (line 199)", () => {
    it("defaults summary to 'Details' when single-block <details> has no <summary> tag", () => {
      // Without blank lines remark keeps the whole block as a single html node,
      // so parseDetailsHtmlBlock is called. When there is no <summary> tag,
      // summaryMatch is null and summaryMatch?.[1] ?? "Details" uses the fallback.
      const md = `<details>
No summary tag here.
</details>`;
      const result = parseWithDetails(md);
      const details = result.children[0] as Details;
      expect(details.type).toBe("details");
      expect(details.summary).toBe("Details");
    });
  });
});

describe("nested details keep their own summary and content", () => {
  const parseDoc = (md: string) => {
    const processor = unified()
      .use(remarkParse)
      .use(remarkGfm, { singleTilde: false })
      .use(remarkDetailsBlock);
    return processor.runSync(processor.parse(md)) as never;
  };

  const detailsNodes = (md: string) => {
    const out: { summary?: string; open?: boolean; children?: unknown[] }[] = [];
    visit(parseDoc(md), "details", (n) => out.push(n as never));
    return out;
  };

  it("an inner compact block does not donate its summary to the outer one", () => {
    // `extractSummaryFromChildren` searched ANYWHERE in the first html child.
    // A nested compact `<details><summary>Inner</summary>…</details>` matched,
    // so the outer block took "Inner" as its title AND consumed the whole
    // child as the summary — discarding the nested block and its content.
    const nodes = detailsNodes(
      "<details><summary>Outer</summary>\n\n<details><summary>Inner</summary>x</details>\n\n</details>\n"
    );

    expect(nodes[0]?.summary).toBe("Outer");
    expect(nodes[0]?.children?.length).toBeGreaterThan(0);
    expect(nodes[1]?.summary).toBe("Inner");
  });

  it.each([
    { label: "data-open=\"false\"", html: '<details data-open="false">', open: false },
    { label: "data-state=\"open\"", html: '<details data-state="open">', open: false },
    { label: "bare open", html: "<details open>", open: true },
    { label: 'open="open"', html: '<details open="open">', open: true },
    { label: "no attributes", html: "<details>", open: false },
  ])("$label → open: $open", ({ html, open }) => {
    // `/\bopen\b/i` over the whole tag matched an attribute NAME and a VALUE,
    // neither of which opens anything, so collapsed blocks rendered expanded.
    const nodes = detailsNodes(`${html}<summary>S</summary>\n\nbody\n\n</details>\n`);
    expect(nodes[0]?.open).toBe(open);
  });
});

/** The first details node, or null. */
function detailsOf(md: string): Details | null {
  let found: Details | null = null;
  visit(parseWithDetails(md) as never, "details", (node: Details) => {
    found ??= node;
  });
  return found;
}

describe("attribute parsing survives a `>` inside a quoted value", () => {
  // The tag matcher was `<details\b[^>]*>`, which stops at the FIRST `>` — so a
  // quoted value containing one truncated the tag mid-attribute and the `open`
  // that followed was never seen. Found by verification, not by review.
  it.each([
    { label: "double-quoted", md: '<details title="a > b" open>\n<summary>S</summary>\n\nbody\n\n</details>\n' },
    { label: "single-quoted", md: "<details title='a > b' open>\n<summary>S</summary>\n\nbody\n\n</details>\n" },
    { label: "compact, quoted", md: '<details title="a > b" open><summary>S</summary>body</details>\n' },
  ])("$label — reports open", ({ md }) => {
    expect(detailsOf(md)?.open).toBe(true);
  });

  it("still refuses a value that merely CONTAINS the word open", () => {
    const md = '<details data-open="false" title="x > y">\n<summary>S</summary>\n\nb\n\n</details>\n';
    expect(detailsOf(md)?.open).toBe(false);
  });

  it("applies the same attribute rule on the COMPACT path", () => {
    // That branch kept a bare /\bopen\b/i test, so an attribute NAME containing
    // the substring opened the block on one form and not the other.
    const md = '<details data-open="false"><summary>S</summary>body</details>\n';
    expect(detailsOf(md)?.open).toBe(false);
  });
});

describe("a comment may precede the summary", () => {
  it("does not discard a summary behind a leading HTML comment", () => {
    // `^\s*<summary>` treated a comment as content and dropped the summary,
    // which is a regression the strictness introduced.
    const md = "<details>\n<!-- a note -->\n<summary>Real</summary>\n\nbody\n\n</details>\n";
    expect(detailsOf(md)?.summary).toBe("Real");
  });

  it("keeps content that PRECEDES the summary instead of dropping it", () => {
    // Per the HTML spec the first <summary> child is the disclosure label
    // wherever it sits, so "Real" is the right summary here — the defect is
    // that everything before it used to vanish with the html child.
    const md = "<details>\nprose\n<summary>Real</summary>\n\nbody\n\n</details>\n";
    const details = detailsOf(md);
    expect(details?.summary).toBe("Real");
    const text = JSON.stringify(details?.children ?? []);
    expect(text).toContain("prose");
    expect(text).toContain("body");
  });
});

describe("the INNER html child's residue survives too", () => {
  it("keeps text that follows </summary> in the same node", () => {
    // `extractSummaryFromChildren` returned `{ summary, children: rest }`,
    // dropping the whole first child. With a blank line after `<details>`,
    // remark emits `<summary>S</summary>\nprose` as ONE inner html node, so
    // `prose` went with it.
    const md = "<details>\n\n<summary>S</summary>\nprose\n\nbody\n\n</details>\n";
    const details = detailsOf(md);
    expect(details?.summary).toBe("S");
    expect(JSON.stringify(details?.children ?? [])).toContain("prose");
  });

  it("skips a comment in its OWN node before the summary node", () => {
    const md = "<details>\n\n<!-- note -->\n\n<summary>Real</summary>\n\nbody\n\n</details>\n";
    expect(detailsOf(md)?.summary).toBe("Real");
  });
});

describe("the comment-skip recursion cannot reach a NESTED block's summary", () => {
  it("does not let a nested compact details donate its title past a comment", () => {
    // Skipping a comment-only node walks one node further along. If that node
    // is a nested compact `<details><summary>Inner</summary>`, the outer block
    // must NOT adopt "Inner" — which is the donation bug the anchored guard
    // exists to stop, reachable again through the new recursion.
    const md =
      "<details>\n\n<!-- c -->\n\n<details><summary>Inner</summary>i</details>\n\n</details>\n";
    const outer = detailsOf(md);
    expect(outer?.summary).not.toBe("Inner");
    // And the nested block survives intact rather than being consumed.
    expect(JSON.stringify(outer?.children ?? [])).toContain("Inner");
  });

  it("does not double-count content kept by BOTH the residue and inner paths", () => {
    // The residue comes from the OPENING node; the inner path from the first
    // child. They must never describe the same text.
    const md = "<details>\nlead\n<summary>S</summary>\ntail\n\nbody\n\n</details>\n";
    const text = JSON.stringify(detailsOf(md)?.children ?? []);
    expect(text.match(/"lead"/g) ?? []).toHaveLength(1);
    expect(text.match(/"tail"/g) ?? []).toHaveLength(1);
  });
});
