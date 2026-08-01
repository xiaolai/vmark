/**
 * Link-check offsets are canonical, or the ref is skipped — never guessed.
 *
 * `extractLocalRefs` used `node.position.start.offset ?? 0`, so a node without
 * an offset silently reported the START OF THE FILE and sent the user to
 * unrelated text. It now asks `createRangeAuthorizer`, which refuses instead.
 *
 * The audit that prompted this observed `positionTrust` had no production
 * consumer, while this file was doing the exact thing it exists to prevent.
 * Two findings came out of wiring them together, and the second corrected me:
 *
 *   1. The `?? 0` was real, and is gone.
 *   2. The claim that a `<details>` body carries offsets local to an extracted
 *      substring is FALSE. Measured node by node, every descendant carries a
 *      correct ABSOLUTE offset. Links inside details are therefore authorised,
 *      and these tests pin that — an earlier version of this file asserted the
 *      opposite from an inherited assumption and had to be rewritten.
 *
 * @coordinates-with utils/markdownPipeline/positionTrust.ts — createRangeAuthorizer
 * @coordinates-with lib/markdownLinkCheck/check.ts — extractLocalRefs
 * @module lib/markdownLinkCheck/detailsOffsets.test
 */
import { describe, it, expect } from "vitest";
import { visit } from "unist-util-visit";
import "@/utils/markdownPipeline/dialect";
import { createMarkdownProcessor } from "@/utils/markdownPipeline/parser/processorFactory";
import {
  createRangeAuthorizer,
  type PositionedNode,
} from "@/utils/markdownPipeline/positionTrust";

const WITH_DETAILS = [
  "# Title",
  "",
  "A [top-level](./real.md) link.",
  "",
  "<details><summary>S</summary>",
  "",
  "An [inner](./inner.md) link.",
  "",
  "</details>",
].join("\n");

function parse(md: string): PositionedNode {
  const processor = createMarkdownProcessor();
  return processor.runSync(processor.parse(md)) as unknown as PositionedNode;
}

/** Every link the authorizer vouches for, with its sliced source text. */
function authorisedLinks(md: string): { url: string; slice: string }[] {
  const tree = parse(md);
  const authorizer = createRangeAuthorizer(tree);
  const out: { url: string; slice: string }[] = [];
  visit(tree as never, "link", (node: PositionedNode & { url?: string }) => {
    const range = authorizer.rangeOf(node);
    if (!range) return;
    out.push({ url: node.url ?? "", slice: md.slice(range.start, range.end) });
  });
  return out;
}

describe("a link inside a details body", () => {
  it("IS authorised — its offsets are absolute and correct", () => {
    expect(authorisedLinks(WITH_DETAILS).map((l) => l.url)).toEqual([
      "./real.md",
      "./inner.md",
    ]);
  });

  it("slices to the link itself, wherever the block sits in the document", () => {
    // Two documents put the block at different offsets. If the body were
    // re-based, one of these would slice the wrong text.
    const padded = WITH_DETAILS.replace(
      "# Title",
      "# Title\n\nA much longer padding paragraph placed before the block."
    );
    for (const md of [WITH_DETAILS, padded]) {
      const inner = authorisedLinks(md).find((l) => l.url === "./inner.md");
      expect(inner?.slice).toBe("[inner](./inner.md)");
    }
  });

  it("the details NODE itself still cannot authorise a range", () => {
    const tree = parse(WITH_DETAILS);
    const authorizer = createRangeAuthorizer(tree);
    let details: PositionedNode | null = null;
    visit(tree as never, (node: PositionedNode) => {
      if (node.type === "details") details = node;
    });

    expect(details).not.toBeNull();
    expect(authorizer.rangeOf(details as unknown as PositionedNode)).toBeNull();
  });
});

describe("ordinary documents are unaffected", () => {
  it("authorises every link and slices each correctly", () => {
    const md = "A [one](./a.md) and [two](./b.md).\n";
    expect(authorisedLinks(md)).toEqual([
      { url: "./a.md", slice: "[one](./a.md)" },
      { url: "./b.md", slice: "[two](./b.md)" },
    ]);
  });

  it("authorises images the same way", () => {
    const md = "![alt](./pic.png)\n";
    const tree = parse(md);
    const authorizer = createRangeAuthorizer(tree);
    visit(tree as never, "image", (node: PositionedNode) => {
      const range = authorizer.rangeOf(node);
      expect(range).not.toBeNull();
      expect(md.slice(range!.start, range!.end)).toBe("![alt](./pic.png)");
    });
  });
});

describe("the refusal path", () => {
  it("refuses a synthesised node rather than reporting offset 0", () => {
    // The `?? 0` this replaced: any node without an offset pointed the user at
    // the first character of the file.
    const tree: PositionedNode = {
      type: "root",
      position: { start: { offset: 0 }, end: { offset: 20 } },
      children: [{ type: "wikiLink" }],
    };
    const authorizer = createRangeAuthorizer(tree);
    const synthesised = tree.children![0];

    expect(authorizer.rangeOf(synthesised)).toBeNull();
    expect(() => authorizer.require(synthesised, "linkCheck")).toThrow(/linkCheck/);
  });
});
