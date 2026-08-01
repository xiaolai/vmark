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
 *   2. Whether a `<details>` body re-bases its offsets depends on the FORM,
 *      which took three measurements to establish. The COMPACT single-node
 *      form re-parses an extracted substring and restarts at 0; the MULTILINE
 *      form keeps already-positioned siblings. A node does not carry which
 *      form produced it, so both are refused. This file asserted each of the
 *      two wrong generalisations in turn before measuring both.
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

const COMPACT = "padding\n\n<details><summary>S</summary>[c](./c.md)</details>\n";

describe("a link inside a details body", () => {
  it("is NOT authorised — the compact form re-bases its offsets", () => {
    // MEASURED, after two wrong claims. For the compact single-html-node form
    // the link's range is 0..N into the EXTRACTED BODY, so slicing the
    // document at it returns unrelated text. A node cannot reveal which form
    // produced it, so both are refused.
    expect(authorisedLinks(COMPACT).map((l) => l.url)).toEqual([]);
  });

  it("the compact link's raw range really does slice the wrong text", () => {
    // The concrete harm, asserted rather than asserted-about.
    const tree = parse(COMPACT);
    let inner: PositionedNode | null = null;
    visit(tree as never, "link", (node: PositionedNode & { url?: string }) => {
      if (node.url === "./c.md") inner = node;
    });
    expect(inner).not.toBeNull();

    const raw = (inner as unknown as PositionedNode).position;
    const start = raw?.start?.offset;
    const end = raw?.end?.offset;
    expect(typeof start).toBe("number");
    expect(COMPACT.slice(start as number, end as number)).not.toContain("./c.md");
  });

  it("the multiline form's offsets ARE absolute — but are refused too", () => {
    // The type is distrusted, not the form, because the node does not carry
    // which form it came from. The cost is stated: diagnostics inside a
    // multiline details body are skipped even though their ranges are good.
    // Fixing the CAUSE (shifting the re-parsed subtree by the body's absolute
    // start) removes both the cost and the entry — see positionTrust.ts.
    const tree = parse(WITH_DETAILS);
    let inner: PositionedNode | null = null;
    visit(tree as never, "link", (node: PositionedNode & { url?: string }) => {
      if (node.url === "./inner.md") inner = node;
    });
    const raw = (inner as unknown as PositionedNode).position;
    expect(WITH_DETAILS.slice(raw!.start!.offset!, raw!.end!.offset!)).toBe(
      "[inner](./inner.md)"
    );
    expect(authorisedLinks(WITH_DETAILS).map((l) => l.url)).toEqual(["./real.md"]);
  });

  it("the details NODE itself cannot authorise a range", () => {
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
