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
 *   2. The COMPACT `<details>` form re-parsed an extracted substring and
 *      restarted its offsets at 0 — established after two wrong
 *      generalisations, each of which this file asserted in turn. Rather than
 *      distrust the subtree (which cost every diagnostic inside a details
 *      body), `parseDetailsBody` now rebases into host coordinates. Both forms
 *      are correct and both are authorised.
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

const NESTED_DEEP = "a\n\nb\n\nc\n\n<details><summary>S</summary>[d](./d.md)</details>\n";

describe("a link inside a details body", () => {
  it.each([
    { form: "multiline", md: WITH_DETAILS, url: "./inner.md", text: "[inner](./inner.md)" },
    { form: "compact", md: COMPACT, url: "./c.md", text: "[c](./c.md)" },
    { form: "compact, deeper in the document", md: NESTED_DEEP, url: "./d.md", text: "[d](./d.md)" },
  ])("$form — authorised, and slices to the link itself", ({ md, url, text }) => {
    // The COMPACT form re-parses an extracted substring, so its offsets used to
    // restart at 0 and slice unrelated text. `parseDetailsBody` now rebases the
    // subtree into host coordinates, so both forms are correct and both are
    // authorised — the conservative distrust that cost these diagnostics is
    // gone because the cause is fixed, not because the check was relaxed.
    const found = authorisedLinks(md).find((l) => l.url === url);
    expect(found?.slice).toBe(text);
  });

  it("reports the HOST line number, not a body-local one", () => {
    // Offsets alone came out right from the base while line and column stayed
    // body-local — plausible, wrong numbers printed straight into a diagnostic.
    const tree = parse(NESTED_DEEP);
    visit(tree as never, "link", (node: PositionedNode & { url?: string }) => {
      if (node.url !== "./d.md") return;
      const start = node.position?.start as { line?: number; column?: number } | undefined;
      expect(start?.line).toBe(7);
      expect(NESTED_DEEP.split("\n")[6]).toContain("[d](./d.md)");
    });
  });

  it("the details NODE itself still cannot authorise a range", () => {
    // It is synthesised from html nodes and has no position of its own.
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

describe("content the OPENING tag swallowed keeps host coordinates", () => {
  it("slices to the link itself, not to unrelated text", () => {
    // remark keeps consecutive HTML lines in one node, so a link between
    // `<details>` and `<summary>` arrives inside the opening node. Parsing that
    // residue back as body content restarted its offsets at 0 — well-formed
    // coordinates pointing somewhere else entirely, which is precisely what
    // this file exists to catch. It is rebased from the opening node's own
    // start now.
    const md = "pad\n\npad2\n\n<details>\n[r](./r.md)\n<summary>S</summary>\n\nbody\n\n</details>\n";
    const found = authorisedLinks(md).find((l) => l.url === "./r.md");
    expect(found?.slice).toBe("[r](./r.md)");
  });

  it("does the same for content AFTER the summary in that node", () => {
    const md = "pad\n\n<details>\n<summary>S</summary>\n[q](./q.md)\n\nbody\n\n</details>\n";
    const found = authorisedLinks(md).find((l) => l.url === "./q.md");
    expect(found?.slice).toBe("[q](./q.md)");
  });
});
