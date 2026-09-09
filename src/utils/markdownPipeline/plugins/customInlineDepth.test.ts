// @vitest-environment node
/**
 * `walkAndReplace` must not recurse per inline nesting level (#1374).
 *
 * This is the case the weekly soak actually fails on. Its stderr names the
 * input directly:
 *
 *   Error: [MarkdownPipeline] Parse failed: Maximum call stack size exceeded
 *   Input preview: "*a **a *a **a *a **a *a **a …"
 *
 * That is the `nested-strong-emph` class, not deep blockquotes — and the
 * recursion is VMark's own. `walkAndReplace` descended once per non-text child,
 * so `*a **a ` repeated N times cost N frames before the transform finished.
 *
 * Distinct from the container guard in `nestingDepth.ts`, which bounds
 * blockquote and list depth up front. That guard does NOT cover this shape and
 * should not: inline markers do not reliably build a deep tree, so charging for
 * them would reject documents that parse perfectly well. This one is fixed by
 * removing the recursion instead of by refusing the input.
 *
 * The old code was also MARGINAL rather than reliably broken — measured on this
 * machine at the soak's scale, three consecutive runs on byte-identical input
 * gave ok, overflow, ok. That is what a stack ceiling looks like from below,
 * and why the soak reads as flaky rather than as a defect.
 *
 * @coordinates-with customInlineTransform.ts — the transform under test
 * @module utils/markdownPipeline/plugins/customInlineDepth.test
 */
import { describe, it, expect } from "vitest";
import type { Root } from "mdast";
import { parseMarkdownToMdast } from "../parser";
import { customInlineFromMarkdown } from "./customInlineTransform";

/** The mdast the transform actually operates on, as JSON for shape assertions. */
const parsed = (markdown: string) => JSON.stringify(parseMarkdownToMdast(markdown));

/** The transform itself, so depth can be tested without paying for a parse. */
const transform = customInlineFromMarkdown().transforms[0];

/**
 * `emphasis` nested `depth` deep around one text node.
 *
 * Built directly rather than parsed: `"*a **a ".repeat(2400)` takes a minute or
 * more to PARSE on this machine and several minutes at 3x, which would make a
 * unit test one of the slowest files in the repo while measuring mostly
 * micromark. The recursion under test is per tree LEVEL, so a synthetic tree
 * exercises it exactly and returns instantly.
 */
function nestedEmphasis(depth: number): Root {
  let node: unknown = { type: "text", value: "a" };
  for (let i = 0; i < depth; i += 1) node = { type: "emphasis", children: [node] };
  return { type: "root", children: [node] } as unknown as Root;
}

describe("deep inline nesting (#1374)", () => {
  it("walks a tree far deeper than the soak's failing input", () => {
    // The soak's nested-strong-emph at scale 8 nests a few thousand deep and
    // sat right at the ceiling — three runs on identical input gave ok,
    // overflow, ok. 20000 is far past it, so this cannot pass by luck.
    expect(() => transform(nestedEmphasis(20000))).not.toThrow();
  });

  it("is what the recursive version could not do", () => {
    // Not decoration: without it, restoring the recursion would still pass
    // every behaviour test in this file. A plain recursive walk over the same
    // tree is what the transform used to be.
    const recursive = (node: { children?: unknown[] }): void => {
      if (!Array.isArray(node.children)) return;
      for (const child of node.children) recursive(child as { children?: unknown[] });
    };
    expect(() => recursive(nestedEmphasis(20000) as unknown as { children?: unknown[] })).toThrow(
      /call stack/i,
    );
  });

  it("still applies custom marks, nested and split across siblings", () => {
    // The transform's actual job. An iterative walk that stopped doing this
    // would pass both tests above while breaking every document that uses
    // highlight, subscript, superscript or underline.
    const json = parsed("==highlight **bold**== and ~sub~ and ^sup^\n");
    expect(json).toContain("highlight");
    expect(json).toContain("subscript");
    expect(json).toContain("superscript");
  });

  it("applies a mark nested inside emphasis", () => {
    // Proves children are processed before their parent: the inner mark has to
    // be resolved by the time the outer node's sibling-spanning pass runs.
    expect(parsed("*outer ==inner== outer*\n")).toContain("highlight");
  });
});
