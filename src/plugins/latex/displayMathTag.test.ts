// @vitest-environment node
/**
 * `\tag{…}` on display math must sit at the right edge of the BLOCK, not of
 * the equation (#1376).
 *
 * The mechanism, from KaTeX's own stylesheet:
 *
 *   .katex-display > .katex > .katex-html      { display: block; position: relative }
 *   .katex-display > .katex > .katex-html > .katex-tag { position: absolute; right: 0 }
 *
 * So the tag is placed against the right edge of `.katex-html`, which fills
 * `.katex-display`. Everywhere else that works, because `.katex-display` is a
 * plain block filling its container.
 *
 * VMark's preview is a FLEX container (`display: flex; justify-content:
 * center`), which makes `.katex-display` a flex ITEM — and a flex item with
 * `width: auto` shrink-wraps to its content. The block then ends where the
 * equation ends, `right: 0` resolves to the equation's own right edge, and the
 * tag lands on top of the last term: `[\Delta V] \tag{9}` renders as
 * `[\Delta V(9)]`.
 *
 * `width: 100%` restores the block's full width. Centring is unaffected —
 * KaTeX centres display math itself with `text-align: center`, which is how it
 * behaves outside a flex parent; `justify-content` was never what centred it.
 *
 * A layout assertion is not available here: jsdom computes no geometry, so a
 * test that rendered the equation and measured the tag would pass on a broken
 * stylesheet. The stylesheet is therefore the subject, in the same shape as
 * `src/test/reducedMotionGlobal.test.ts`.
 *
 * @coordinates-with latex.css — the rule under test
 * @module plugins/latex/displayMathTag.test
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const raw = readFileSync("src/plugins/latex/latex.css", "utf8");

/**
 * Comments are stripped BEFORE any rule is matched, not after.
 *
 * A body matched with `[^}]*` ends at the first `}` in the file, and a CSS
 * comment may contain one — the comment on the rule under test cites
 * `` `\tag{…}` ``, whose closing brace truncated the body and failed the
 * assertion against the very fix that had just been applied.
 */
const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");

/** The body of the first rule whose selector matches. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, "m").exec(css);
  expect(match, `no rule for \`${selector}\``).not.toBeNull();
  return match![1];
}

describe("display-math \\tag placement (#1376)", () => {
  it("the preview centres with flex, which is what shrink-wraps the block", () => {
    // Pinned because it is the PREMISE of the fix below, not decoration: if the
    // preview ever stops being a flex container, `width: 100%` is no longer
    // load-bearing and this whole test should be revisited rather than kept
    // passing out of habit.
    const preview = ruleBody(".math-block-preview");
    expect(preview).toMatch(/display:\s*flex/);
  });

  it("gives .katex-display the full block width so the tag reaches the edge", () => {
    const rule = ruleBody(".math-block-preview .katex-display");
    expect(
      rule,
      "a flex item shrink-wraps without an explicit width, which puts `right: 0` " +
        "on the equation's edge instead of the block's — that is #1376",
    ).toMatch(/width:\s*100%/);
  });

  it("does not try to fix it by overriding KaTeX's tag positioning", () => {
    // The tempting alternative is to re-place `.katex-tag` by hand. That fights
    // KaTeX's own layout, breaks `leqno` (which flips the tag to the left), and
    // has to be re-tuned whenever KaTeX changes. Widening the block leaves
    // KaTeX's rule doing exactly what it was written to do.
    expect(css).not.toMatch(/\.katex-tag\s*\{/);
  });
});
