// @vitest-environment node
/**
 * Unit tests for the setext-ambiguity detector in remarkPlugins.
 *
 * The detector decides whether a document keeps setext headings enabled. A
 * false positive silently downgrades a real `Title` / `-----` heading to a
 * paragraph; a false negative lets `- item` / `  -` corrupt a list. The
 * scanner therefore has to understand code regions: fenced code (CommonMark
 * fence rules — max 3 spaces of indent, closer matches the opener's char with
 * at least its length) and indented code lines are literal text, never list
 * markers.
 *
 * Integration coverage (real parse results) lives in
 * `__tests__/setextHeadings.test.ts`; this file pins the scanner itself.
 *
 * @coordinates-with ../__tests__/setextHeadings.test.ts — parser-level checks
 * @module utils/markdownPipeline/parser/remarkPlugins.test
 */
import { describe, it, expect } from "vitest";
import { analyzeContent, remarkValidateMath, remarkDepthLimit, MAX_MDAST_DEPTH } from "./remarkPlugins";

const ambiguous = (md: string): boolean => analyzeContent(md).hasAmbiguousListUnderline;

describe("hasAmbiguousListUnderline — real ambiguity is detected", () => {
  it.each([
    { name: "empty nested item under a list", md: "- item\n  -\n" },
    { name: "indented lone marker under a paragraph", md: "Paragraph\n  -\n" },
    { name: "three-space plus marker", md: "- item\n   +\n" },
    { name: "marker after a fence closed by a LONGER run", md: "```\ncode\n````\n\nPara\n  -\n" },
    { name: "marker after a properly closed tilde fence", md: "~~~\ncode\n~~~\n\nPara\n  -\n" },
    { name: "marker after a three-space-indented fence", md: "   ```\ncode\n   ```\n\nPara\n  -\n" },
  ])("flags $name", ({ md }) => {
    expect(ambiguous(md)).toBe(true);
  });

  it("does not flag a document with no marker at all", () => {
    expect(ambiguous("Title\n=====\n")).toBe(false);
  });
});

describe("hasAmbiguousListUnderline — code regions are excluded", () => {
  it("does not flag a marker inside a fenced code block", () => {
    expect(ambiguous("```yaml\nlist:\n  -\n```\n")).toBe(false);
  });

  it("does not flag a marker inside an UNCLOSED fence", () => {
    expect(ambiguous("```\n  -\n")).toBe(false);
  });

  it("does not let a tilde run close a backtick fence", () => {
    expect(ambiguous("```\n~~~\n  -\n```\n")).toBe(false);
  });

  it("does not flag a four-space-indented dash — that line is indented code", () => {
    // Indented code cannot interrupt a paragraph either, so `    -` is never a
    // setext underline; flagging it disabled setext for the whole document.
    expect(ambiguous("Para\n\n    code\n    -\n    more code\n")).toBe(false);
  });

  it("does not flag a tab-indented lone marker — a tab is code-block indentation", () => {
    expect(ambiguous("Para\n\n\t-\n")).toBe(false);
  });

  it("treats a four-space-indented fence line as indented code, not a fence opener", () => {
    // The old scanner accepted unlimited indentation, so `    \`\`\`` opened a
    // "fence" that swallowed the rest of the document and hid the real
    // ambiguous marker after it.
    expect(ambiguous("    ```\n\nPara\n  -\n")).toBe(true);
  });

  it("does not accept a four-space-indented run as a CLOSER", () => {
    // `      \`\`\`` inside a fence is content; accepting it as the closer put
    // the `  -` two lines later OUTSIDE the fence and flagged literal text.
    expect(ambiguous("```\n      ```\n  -\n```\n")).toBe(false);
  });

  it("does not accept a closer SHORTER than its opener", () => {
    // CommonMark keeps a 5-backtick block open across a 3-backtick line, so
    // the `  -` is still literal code.
    expect(ambiguous("`````\ncode\n```\n  -\n`````\n")).toBe(false);
  });
});

describe("remarkValidateMath — deep nesting (WI-5.1 regression)", () => {
  it("survives a 100k-deep mdast tree without stack overflow", () => {
    // The OSS-Fuzz soak crashed the per-child recursion with RangeError on
    // deeply nested inline emphasis; the traversal is now an explicit stack.
    interface Chain { type: string; children: Chain[] }
    const leaf: Chain = { type: "text", children: [] };
    let node: Chain = leaf;
    for (let i = 0; i < 100_000; i += 1) node = { type: "emphasis", children: [node] };
    const root = { type: "root", children: [node] };
    const transformer = (remarkValidateMath as () => (tree: unknown) => void)();
    expect(() => transformer(root)).not.toThrow();
  });
});

describe("remarkDepthLimit — direct semantics (audit round 1)", () => {
  interface Chain { type: string; value?: string; children?: Chain[] }
  const chain = (depth: number): Chain => {
    let node: Chain = { type: "text", value: "leaf" };
    for (let i = 0; i < depth; i += 1) node = { type: "emphasis", children: [node] };
    return node;
  };
  const run = (tree: Chain) =>
    (remarkDepthLimit as () => (t: unknown) => void)()(tree);

  it("is inert below the limit", () => {
    const root = { type: "root", children: [chain(10)] };
    run(root as Chain);
    let depth = 0;
    let node: Chain | undefined = root.children[0];
    while (node?.children) { depth += 1; node = node.children[0]; }
    expect(depth).toBe(10);
    expect(node?.value).toBe("leaf");
  });

  it("flattens past MAX_MDAST_DEPTH to the subtree's plain text", () => {
    const root = { type: "root", children: [chain(MAX_MDAST_DEPTH + 50)] };
    run(root as Chain);
    const texts: string[] = [];
    const stack: Chain[] = [root as Chain];
    let maxDepth = 0;
    const walk = (n: Chain, d: number) => {
      maxDepth = Math.max(maxDepth, d);
      if (n.value) texts.push(n.value);
      (n.children ?? []).forEach((c) => walk(c, d + 1));
    };
    void stack;
    walk(root as Chain, 0);
    expect(maxDepth).toBeLessThanOrEqual(MAX_MDAST_DEPTH + 2);
    expect(texts).toContain("leaf"); // content survives, structure flattens
  });
});
