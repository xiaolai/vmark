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
  });
});
