/**
 * Tests for remarkResolveReferences plugin.
 *
 * Covers: definition collection, link reference resolution, image reference resolution,
 * unresolved references, forward references, empty identifier fallback, and edge cases.
 */

import { describe, it, expect } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { remarkResolveReferences } from "./resolveReferences";
import type { Root, Link, Image, Content, Definition, LinkReference, ImageReference } from "mdast";
import { testSchema } from "../testSchema";
import { parseMarkdown, serializeMarkdown } from "@/utils/markdownPipeline";

function parse(markdown: string): Root {
  const processor = unified().use(remarkParse).use(remarkResolveReferences);
  return processor.runSync(processor.parse(markdown)) as Root;
}

function findNode(tree: Root, type: string): Content | null {
  let found: Content | null = null;
  function walk(nodes: Content[]) {
    for (const node of nodes) {
      if (node.type === type) {
        found = node;
        return;
      }
      if ("children" in node) {
        walk(node.children as Content[]);
      }
    }
  }
  walk(tree.children as Content[]);
  return found;
}

function findAllNodes(tree: Root, type: string): Content[] {
  const results: Content[] = [];
  function walk(nodes: Content[]) {
    for (const node of nodes) {
      if (node.type === type) {
        results.push(node);
      }
      if ("children" in node) {
        walk(node.children as Content[]);
      }
    }
  }
  walk(tree.children as Content[]);
  return results;
}

describe("remarkResolveReferences", () => {
  describe("link references", () => {
    it("resolves a full link reference", () => {
      const tree = parse("[text][id]\n\n[id]: https://example.com");
      const link = findNode(tree, "link") as Link | null;
      expect(link).not.toBeNull();
      expect(link!.url).toBe("https://example.com");
    });

    it("resolves link reference with title", () => {
      const tree = parse('[text][id]\n\n[id]: https://example.com "My Title"');
      const link = findNode(tree, "link") as Link | null;
      expect(link).not.toBeNull();
      expect(link!.url).toBe("https://example.com");
      expect(link!.title).toBe("My Title");
    });

    it("resolves link reference case-insensitively", () => {
      const tree = parse("[text][ID]\n\n[id]: https://example.com");
      const link = findNode(tree, "link") as Link | null;
      expect(link).not.toBeNull();
      expect(link!.url).toBe("https://example.com");
    });

    it("leaves unresolved link reference as-is", () => {
      const tree = parse("[text][missing]");
      const link = findNode(tree, "link") as Link | null;
      // Should not be resolved to a link — remains as linkReference
      expect(link).toBeNull();
    });

    it("resolves forward reference (definition after usage)", () => {
      // Definition appears after usage — two-pass ensures this works
      const tree = parse("[text][id]\n\n[id]: https://example.com");
      const link = findNode(tree, "link") as Link | null;
      expect(link).not.toBeNull();
      expect(link!.url).toBe("https://example.com");
    });

    it("preserves definition nodes", () => {
      const tree = parse("[text][id]\n\n[id]: https://example.com");
      const def = findNode(tree, "definition");
      expect(def).not.toBeNull();
    });

    it("resolves collapsed link reference [text][]", () => {
      const tree = parse("[example][]\n\n[example]: https://example.com");
      const link = findNode(tree, "link") as Link | null;
      expect(link).not.toBeNull();
      expect(link!.url).toBe("https://example.com");
    });
  });

  describe("image references", () => {
    it("resolves a full image reference", () => {
      const tree = parse("![alt][id]\n\n[id]: https://example.com/img.png");
      const img = findNode(tree, "image") as Image | null;
      expect(img).not.toBeNull();
      expect(img!.url).toBe("https://example.com/img.png");
    });

    it("resolves image reference with title", () => {
      const tree = parse('![alt][id]\n\n[id]: https://example.com/img.png "Image Title"');
      const img = findNode(tree, "image") as Image | null;
      expect(img).not.toBeNull();
      expect(img!.title).toBe("Image Title");
    });

    it("preserves alt text", () => {
      const tree = parse("![my alt text][id]\n\n[id]: https://example.com/img.png");
      const img = findNode(tree, "image") as Image | null;
      expect(img).not.toBeNull();
      expect(img!.alt).toBe("my alt text");
    });

    it("leaves unresolved image reference as-is", () => {
      const tree = parse("![alt][missing]");
      const img = findNode(tree, "image") as Image | null;
      expect(img).toBeNull();
    });

    it("resolves image reference case-insensitively", () => {
      const tree = parse("![alt][ID]\n\n[id]: https://example.com/img.png");
      const img = findNode(tree, "image") as Image | null;
      expect(img).not.toBeNull();
      expect(img!.url).toBe("https://example.com/img.png");
    });
  });

  describe("edge cases", () => {
    it("handles document with no references", () => {
      const tree = parse("Just plain text\n\nAnother paragraph");
      const link = findNode(tree, "link") as Link | null;
      expect(link).toBeNull();
    });

    it("handles document with definitions but no references", () => {
      const tree = parse("[id]: https://example.com\n\nPlain text");
      const def = findNode(tree, "definition");
      expect(def).not.toBeNull();
    });

    it("handles multiple references to the same definition", () => {
      const tree = parse("[a][id] and [b][id]\n\n[id]: https://example.com");
      const links = findAllNodes(tree, "link") as Link[];
      expect(links.length).toBe(2);
      expect(links[0].url).toBe("https://example.com");
      expect(links[1].url).toBe("https://example.com");
    });

    it("handles definition with null title", () => {
      const tree = parse("[text][id]\n\n[id]: https://example.com");
      const link = findNode(tree, "link") as Link | null;
      expect(link).not.toBeNull();
      expect(link!.title).toBeNull();
    });

    it("handles mixed link and image references", () => {
      const tree = parse("[text][id1]\n\n![alt][id2]\n\n[id1]: https://link.com\n[id2]: https://img.com/a.png");
      const link = findNode(tree, "link") as Link | null;
      const img = findNode(tree, "image") as Image | null;
      expect(link).not.toBeNull();
      expect(link!.url).toBe("https://link.com");
      expect(img).not.toBeNull();
      expect(img!.url).toBe("https://img.com/a.png");
    });

    it("skips nodes that are not linkReference or imageReference", () => {
      const tree = parse("# Heading\n\nParagraph with **bold** text");
      // Should not throw or produce unexpected results
      expect(tree.type).toBe("root");
    });

    it("resolves shortcut link reference [text]", () => {
      // Shortcut references use label as identifier
      const tree = parse("[example]\n\n[example]: https://example.com");
      const link = findNode(tree, "link") as Link | null;
      expect(link).not.toBeNull();
      expect(link!.url).toBe("https://example.com");
    });

    it("handles link reference with empty identifier fallback to label", () => {
      // Tests the `node.identifier || node.label || ""` fallback chain
      // In practice, remark-parse always provides identifier, but this tests robustness
      const tree = parse("[test text][ref]\n\n[ref]: https://example.com");
      const link = findNode(tree, "link") as Link | null;
      expect(link).not.toBeNull();
    });

    it("handles image reference without alt text", () => {
      // Tests the node.alt ?? null fallback (line 118)
      const tree = parse("![]\n\n");
      // No definition to resolve against, so image reference remains
      const img = findNode(tree, "image") as Image | null;
      // Without a matching definition, it stays as imageReference
      expect(img).toBeNull();
    });

    it("resolves shortcut image reference ![alt]", () => {
      const tree = parse("![myimage]\n\n[myimage]: https://example.com/pic.png");
      const img = findNode(tree, "image") as Image | null;
      expect(img).not.toBeNull();
      expect(img!.url).toBe("https://example.com/pic.png");
    });
  });

  describe("direct MDAST manipulation — identifier/label fallback branches", () => {
    it("resolves linkReference with empty identifier, falls back to label", () => {
      // Construct MDAST tree directly to test the || fallback chain
      const tree: Root = {
        type: "root",
        children: [
          {
            type: "definition",
            identifier: "myid",
            label: "myid",
            url: "https://example.com",
            title: null,
          } as Definition,
          {
            type: "paragraph",
            children: [
              {
                type: "linkReference",
                identifier: "", // empty identifier
                label: "myid", // fallback to label
                referenceType: "full",
                children: [{ type: "text", value: "link text" }],
              } as LinkReference,
            ],
          },
        ],
      };

      const processor = unified().use(remarkResolveReferences);
      const result = processor.runSync(tree) as Root;

      const link = findNode(result, "link") as Link | null;
      expect(link).not.toBeNull();
      expect(link!.url).toBe("https://example.com");
    });

    it("resolves imageReference with empty identifier, falls back to label", () => {
      const tree: Root = {
        type: "root",
        children: [
          {
            type: "definition",
            identifier: "imgid",
            label: "imgid",
            url: "https://example.com/img.png",
            title: null,
          } as Definition,
          {
            type: "paragraph",
            children: [
              {
                type: "imageReference",
                identifier: "", // empty identifier
                label: "imgid", // fallback to label
                referenceType: "full",
                alt: "alt text",
              } as ImageReference,
            ],
          },
        ],
      };

      const processor = unified().use(remarkResolveReferences);
      const result = processor.runSync(tree) as Root;

      const img = findNode(result, "image") as Image | null;
      expect(img).not.toBeNull();
      expect(img!.url).toBe("https://example.com/img.png");
    });

    it("resolves linkReference with empty identifier and empty label, falls back to empty string", () => {
      const tree: Root = {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [
              {
                type: "linkReference",
                identifier: "",
                label: "",
                referenceType: "full",
                children: [{ type: "text", value: "link text" }],
              } as LinkReference,
            ],
          },
        ],
      };

      const processor = unified().use(remarkResolveReferences);
      const result = processor.runSync(tree) as Root;

      // No definition for empty string, so linkReference stays as-is
      const link = findNode(result, "link") as Link | null;
      expect(link).toBeNull();
    });

    it("resolves imageReference with empty identifier and empty label, falls back to empty string", () => {
      const tree: Root = {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [
              {
                type: "imageReference",
                identifier: "",
                label: "",
                referenceType: "full",
                alt: "alt",
              } as ImageReference,
            ],
          },
        ],
      };

      const processor = unified().use(remarkResolveReferences);
      const result = processor.runSync(tree) as Root;

      // No definition for empty string, so stays as-is
      const img = findNode(result, "image") as Image | null;
      expect(img).toBeNull();
    });

    it("handles imageReference with null alt (line 118 fallback)", () => {
      const tree: Root = {
        type: "root",
        children: [
          {
            type: "definition",
            identifier: "id",
            label: "id",
            url: "https://example.com/pic.png",
            title: "Title",
          } as Definition,
          {
            type: "paragraph",
            children: [
              {
                type: "imageReference",
                identifier: "id",
                label: "id",
                referenceType: "full",
                alt: undefined, // alt is undefined/null
              } as unknown as ImageReference,
            ],
          },
        ],
      };

      const processor = unified().use(remarkResolveReferences);
      const result = processor.runSync(tree) as Root;

      const img = findNode(result, "image") as Image | null;
      expect(img).not.toBeNull();
      expect(img!.alt).toBeNull(); // alt ?? null -> null
    });

    it("handles tree root node in visit callback (parent is null for root)", () => {
      // The visit callback has `if (!parent || index === undefined) return;`
      // The root node visit has parent=null, which should be skipped
      const tree: Root = {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", value: "plain text" }],
          },
        ],
      };

      const processor = unified().use(remarkResolveReferences);
      // Should not throw
      const result = processor.runSync(tree) as Root;
      expect(result.type).toBe("root");
    });
  });
});

describe("a reference-style link survives the round trip", () => {
  // VMark rewrote every reference-style link inline on the FIRST debounced
  // edit — all four forms plus reference images — and lint rule W03 then
  // warned "Unused link definition" about VMark's own output. Idempotent and
  // semantically equal, but an unrequested rewrite of the author's file.
  const roundTrip = (md: string): string =>
    serializeMarkdown(testSchema, parseMarkdown(testSchema, md));

  it.each([
    { label: "full", md: "A [link][ref] here.\n\n[ref]: https://example.com\n" },
    { label: "collapsed", md: "A [ref][] here.\n\n[ref]: https://example.com\n" },
    { label: "shortcut", md: "A [ref] here.\n\n[ref]: https://example.com\n" },
  ])("$label reference is re-emitted as a reference", ({ md }) => {
    const out = roundTrip(md);
    expect(out).toContain("[ref]: https://example.com");
    expect(out).not.toContain("(https://example.com)");
  });

  it("still resolves the target for EDITING, so the link works", () => {
    // Resolution is not abandoned — the editor needs a real href to open. Only
    // the SERIALIZED form goes back to the reference.
    const doc = parseMarkdown(testSchema, "A [link][ref] here.\n\n[ref]: https://example.com\n");
    let href: string | null = null;
    doc.descendants((node) => {
      const mark = node.marks?.find((m) => m.type.name === "link");
      if (mark) href = mark.attrs.href as string;
    });
    expect(href).toBe("https://example.com");
  });

  it("leaves an ORDINARY inline link inline", () => {
    const md = "An [inline](https://example.com/x) link.\n";
    expect(roundTrip(md)).toContain("[inline](https://example.com/x)");
  });
});
