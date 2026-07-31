/**
 * VMark-specific remark plugins: math validation and setext-heading disable.
 *
 * @module utils/markdownPipeline/parser/remarkPlugins
 */

import type { Plugin } from "unified";
import type { Root, Parent } from "mdast";
import type { InlineMath } from "mdast-util-math";

/**
 * Plugin to validate inline math and convert invalid ones back to text.
 * Invalid inline math: content with leading or trailing whitespace.
 * This prevents `$100 and $200` from being parsed as math.
 */
export const remarkValidateMath: Plugin<[], Root> = function () {
  return (tree: Root) => {
    visitAndFixMath(tree);
  };
};

function visitAndFixMath(node: Root | Parent): void {
  /* v8 ignore next -- @preserve defensive guard: always called with Root or Parent nodes; protects against leaf nodes passed in future refactors */
  if (!("children" in node) || !Array.isArray(node.children)) return;

  // Type-safe children array using unknown to avoid strict type conflicts
  const newChildren: unknown[] = [];
  let modified = false;

  for (const child of node.children) {
    if (child.type === "inlineMath") {
      const mathNode = child as InlineMath;
      /* v8 ignore next -- @preserve remark-math always sets value to a string; the || "" fallback guards against hypothetical undefined from future parser versions */
      const value = mathNode.value || "";
      // Reject math with leading/trailing whitespace
      if (/^\s/.test(value) || /\s$/.test(value)) {
        // Convert back to text with dollar delimiters
        newChildren.push({
          type: "text",
          value: `$${value}$`,
        });
        modified = true;
        continue;
      }
    }

    // Recurse into children
    if ("children" in child && Array.isArray((child as Parent).children)) {
      visitAndFixMath(child as Parent);
    }
    newChildren.push(child);
  }

  if (modified) {
    // Use type assertion to assign the modified children array
    (node as { children: unknown[] }).children = newChildren;
  }
}

/**
 * Disable setext heading parsing (underline-style headings with `---` or `===`).
 *
 * VMark always serializes headings as ATX (`#`), never setext. Disabling setext
 * parsing prevents a common misparse: an empty nested list item (`  -`) being
 * interpreted as a setext heading underline for the preceding paragraph.
 *
 * Applied ONLY to documents that contain the ambiguous line — see
 * `hasAmbiguousListUnderline`. Disabling it unconditionally traded one
 * corruption for another: an authored setext heading became a paragraph whose
 * underline was escaped to `\=====`, or a paragraph plus a thematic break, and
 * `useTiptapFlush` wrote that back to the file on the next keystroke. Only the
 * first corruption had been measured.
 *
 * VMark still SERIALIZES headings as ATX, so a setext document is normalised on
 * write — but it is read as headings first, rather than destroyed.
 */
export const remarkDisableSetextHeadings: Plugin<[], Root> = function () {
  const data = this.data();
  const micromarkExtensions =
    (data.micromarkExtensions as unknown[]) || ((data as Record<string, unknown>).micromarkExtensions = []);
  micromarkExtensions.push({
    disable: { null: ["setextUnderline"] },
  });
};

/** Flags indicating which optional remark plugins are needed. */
export interface ContentAnalysis {
  hasMath: boolean;
  hasFrontmatter: boolean;
  hasWikiLinks: boolean;
  hasDetails: boolean;
  /** An INDENTED lone list marker, the line that misparses as a setext underline. */
  hasAmbiguousListUnderline: boolean;
}

/**
 * A line that is nothing but an indented list marker — `  -`, `\t*`, `   +`.
 *
 * This is the exact shape `remarkDisableSetextHeadings` exists to protect: an
 * empty nested list item directly under a paragraph, which CommonMark reads as
 * a setext underline for that paragraph. Detecting it lets the protection apply
 * only to documents that need it, instead of costing every document its setext
 * headings.
 */
const AMBIGUOUS_LIST_UNDERLINE = /^[ \t]+[-*+][ \t]*$/m;

/** Fenced code regions, whose contents are literal text and not list markers. */
// Matches on the fence CHARACTER, not the whole opening run. `\1+` meant
// "repetitions of the entire opener", so a valid four-backtick closer after a
// three-backtick opener was not recognised and the match ran to end-of-input —
// swallowing the rest of the document and hiding genuine ambiguity after it.
// A closer shorter than its opener is accepted here, which can end the strip
// early; that errs toward DETECTING ambiguity, the safe direction.
// `(?![\s\S])` is end-of-INPUT — plain `$` under the `m` flag means end of line.
const FENCED_CODE = /^[ \t]*([`~])\1{2,}[^\n]*\n[\s\S]*?(?:^[ \t]*\1{3,}[ \t]*$|(?![\s\S]))/gm;

/**
 * Whether the document contains the ambiguous shape, OUTSIDE fenced code.
 *
 * The bare regex matches a lone indented marker anywhere — including inside a
 * fenced block, where `  -` is just a character in a code sample. One such line
 * used to disable setext headings for the WHOLE document, so a real `Title` /
 * `-----` heading elsewhere in the same file silently parsed as a paragraph and
 * could be rewritten on save.
 */
function hasAmbiguousListUnderline(markdown: string): boolean {
  return AMBIGUOUS_LIST_UNDERLINE.test(markdown.replace(FENCED_CODE, ""));
}

/**
 * Analyze markdown content to determine which plugins are needed.
 * This enables lazy loading of plugins for better performance.
 */
export function analyzeContent(markdown: string): ContentAnalysis {
  return {
    // Math: look for $ or $$ (quick heuristic)
    hasMath: markdown.includes("$"),
    // Frontmatter: must start with ---
    hasFrontmatter: markdown.startsWith("---"),
    // Wiki links: look for [[
    hasWikiLinks: markdown.includes("[["),
    // Details block: look for <details pattern
    // Case-insensitive: the details plugin accepts `<DETAILS>` and `<Details>`,
    // so a case-sensitive probe left those parsing as raw HTML instead.
    hasDetails: /<details(?:[\s>]|$)/i.test(markdown),
    hasAmbiguousListUnderline: hasAmbiguousListUnderline(markdown),
  };
}
