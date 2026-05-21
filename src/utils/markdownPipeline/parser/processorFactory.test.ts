import { describe, it, expect } from "vitest";
import type { Root } from "mdast";
import { createProcessor } from "./processorFactory";

/** Parse + run transforms exactly as parser.ts does, for correctness checks. */
function parseWith(processor: ReturnType<typeof createProcessor>, md: string): Root {
  return processor.runSync(processor.parse(md)) as Root;
}

describe("createProcessor caching", () => {
  it("reuses one processor for content with identical plugin needs", () => {
    const a = createProcessor("plain text");
    const b = createProcessor("more plain text");
    expect(a).toBe(b);
  });

  it("returns a distinct processor when content needs math support", () => {
    const plain = createProcessor("plain text");
    const math = createProcessor("inline $x$ math");
    expect(math).not.toBe(plain);
  });

  it("reuses the math processor across separate math documents", () => {
    const a = createProcessor("$x$");
    const b = createProcessor("text $y$ text");
    expect(a).toBe(b);
  });

  it("returns a distinct processor for frontmatter content", () => {
    const plain = createProcessor("plain");
    const fm = createProcessor("---\ntitle: x\n---\nbody");
    expect(fm).not.toBe(plain);
  });

  it("returns a distinct processor for wiki-link content", () => {
    const plain = createProcessor("plain");
    const wiki = createProcessor("see [[Page]]");
    expect(wiki).not.toBe(plain);
  });

  it("returns a distinct processor for details content", () => {
    const plain = createProcessor("plain");
    const details = createProcessor("<details><summary>x</summary>y</details>");
    expect(details).not.toBe(plain);
  });

  it("distinguishes the preserveLineBreaks option", () => {
    const without = createProcessor("plain", {});
    const withLineBreaks = createProcessor("plain", { preserveLineBreaks: true });
    expect(withLineBreaks).not.toBe(without);
  });
});

describe("createProcessor cached-processor correctness", () => {
  it("parses successive documents independently through one cached processor", () => {
    const processor = createProcessor("$seed$"); // math-enabled cache key
    const alpha1 = parseWith(processor, "# Alpha\n\n$x + 1$");
    const beta = parseWith(processor, "# Beta\n\n$y - 2$");
    const alpha2 = parseWith(processor, "# Alpha\n\n$x + 1$");

    // Re-parsing the same document after an intervening different parse must
    // be bit-identical — proves the cached processor holds no per-document
    // state that could contaminate later calls.
    expect(JSON.stringify(alpha1)).toBe(JSON.stringify(alpha2));
    // Different documents must still produce different trees.
    expect(JSON.stringify(alpha1)).not.toBe(JSON.stringify(beta));
    // The conditionally-loaded math plugin stays active on every reuse.
    expect(JSON.stringify(alpha1)).toContain("inlineMath");
    expect(JSON.stringify(beta)).toContain("inlineMath");
  });

  it("parses distinct block structures correctly through a reused processor", () => {
    const processor = createProcessor("plain seed");
    const headingDoc = parseWith(processor, "# Heading One\n\nParagraph one.");
    const listDoc = parseWith(processor, "- item a\n- item b");

    expect(headingDoc.children[0]?.type).toBe("heading");
    expect(headingDoc.children[1]?.type).toBe("paragraph");
    expect(listDoc.children[0]?.type).toBe("list");
  });

  it("keeps wiki-link parsing correct across reuse of the wiki-link processor", () => {
    const processor = createProcessor("see [[Seed]]");
    const first = parseWith(processor, "see [[Page One]]");
    const second = parseWith(processor, "see [[Page Two]]");

    // Each parse reflects only its own input — no leakage from the prior call.
    expect(JSON.stringify(first)).toContain("Page One");
    expect(JSON.stringify(first)).not.toContain("Page Two");
    expect(JSON.stringify(second)).toContain("Page Two");
    expect(JSON.stringify(first)).not.toBe(JSON.stringify(second));
  });
});
