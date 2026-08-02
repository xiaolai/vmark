/**
 * Purpose: micromark-authoritative facts about a raw markdown string,
 * for the math source guards. Instead of re-implementing CommonMark
 * container/HTML/code grammar in hand-rolled scanners (which
 * demonstrably diverged — tabs, nested lists, HTML block types, quoted
 * attributes, escaped labels…), a probe parse with the pipeline's own
 * processor answers two questions exactly:
 *
 *   1. Which UTF-16 offset ranges are OPAQUE to source rewrites —
 *      code, HTML (all seven CommonMark block classes and inline tags,
 *      via `html` nodes), frontmatter (`yaml`), reference definitions,
 *      and link/image destinations (whole autolinks). Existing math is
 *      deliberately NOT opaque — see OPAQUE_TYPES.
 *   2. Where each math-flow node actually starts and ends — containers,
 *      indentation, and fence grammar all resolved by micromark itself.
 *
 * The probe is `processor.parse()` only (no transforms), so positions
 * are pristine offsets into the probed text. It runs only for
 * documents that contain math-ish markers, at document-parse time (not
 * per keystroke).
 *
 * @coordinates-with ./processorFactory.ts — the probe processor
 * @coordinates-with ./mathDelimiterSpans.ts — opaque-mask consumer
 * @coordinates-with ./mathSourceGuards.ts — math-extent consumer
 * @module utils/markdownPipeline/parser/mathProbe
 */

import type { Node, Parent, Root } from "mdast";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatter from "remark-frontmatter";
import { createProcessor } from "./processorFactory";

/** Parse `text` with the pipeline's processor, transforms skipped. */
export function probeParse(text: string): Root {
  return createProcessor(text, {}).parse(text) as Root;
}

/**
 * Parse with math DISABLED. Used by the guard's fail-closed sweep: a
 * violating math node hides the code/HTML blocks it swallowed, so
 * opacity for the sweep must come from a tree where `$$` is inert and
 * those blocks are visible again. Core CommonMark (code, HTML) plus
 * frontmatter is enough — the sweep only needs the opaque classes.
 */
export function probeParseWithoutMath(text: string): Root {
  return unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ["yaml"])
    .parse(text) as Root;
}

interface Positioned {
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
}

function spanOf(node: Node): [number, number] | null {
  const pos = (node as Positioned).position;
  const start = pos?.start.offset;
  const end = pos?.end.offset;
  return typeof start === "number" && typeof end === "number"
    ? [start, end]
    : null;
}

function visit(node: Node, fn: (node: Node) => void): void {
  fn(node);
  const children = (node as Parent).children;
  if (Array.isArray(children)) {
    for (const child of children) visit(child, fn);
  }
}

/** Node types whose entire span is opaque to source rewrites.
 *  Existing math nodes are deliberately NOT opaque: a `\[ … \]` span
 *  whose content merely LOOKS like `$$` math would otherwise be
 *  half-claimed by the probe and never convert. Literal `\(`/`\[`
 *  inside real dollar-math is invalid LaTeX to begin with, and the
 *  escape-parity rule still protects `\\[4pt]` row spacing. */
const OPAQUE_TYPES = new Set([
  "code",
  "inlineCode",
  "html",
  "yaml",
  "definition",
]);

/** Link-ish parents whose destination tail (after the label) is opaque. */
const LINKISH_TYPES = new Set(["link", "image", "linkReference", "imageReference"]);

/**
 * Per-offset mask (UTF-16 indexing, same as String) of regions the
 * math source guards must not rewrite, derived from the probe parse
 * rather than regex approximations.
 */
export function buildProbeOpaqueMask(
  text: string,
  tree: Root = probeParse(text),
): Uint8Array {
  const mask = new Uint8Array(text.length);
  const cover = (from: number, to: number) => {
    for (let i = Math.max(0, from); i < Math.min(text.length, to); i++) {
      mask[i] = 1;
    }
  };

  visit(tree, (node) => {
    const span = spanOf(node);
    if (!span) return;
    if (OPAQUE_TYPES.has(node.type)) {
      cover(span[0], span[1]);
      return;
    }
    if (LINKISH_TYPES.has(node.type)) {
      // An authored `[label](dest)` link: the label may contain
      // convertible math; the tail (destination, title, reference) may
      // not — mask from the last child's end. But an AUTOLINK's child
      // span IS the URL (`https://…` or `<https://…>`), so tail-only
      // masking leaves the URL exposed. Geometric discriminator: an
      // authored link carries ≥4 syntax chars outside its children
      // (`[](…)`), an autolink at most 2 (the angle brackets) — mask
      // the whole node when the overhead is that small.
      const children = (node as Parent).children;
      const lastChild = Array.isArray(children)
        ? children[children.length - 1]
        : undefined;
      const lastSpan = lastChild ? spanOf(lastChild) : null;
      const firstSpan =
        Array.isArray(children) && children[0] ? spanOf(children[0]) : null;
      const overhead =
        firstSpan && lastSpan
          ? firstSpan[0] - span[0] + (span[1] - lastSpan[1])
          : Number.POSITIVE_INFINITY;
      // Only `link` nodes can be autolinks. Reference labels are
      // authored prose and stay convertible for FULL references only
      // (`[label][id]` — the separate id does the matching). SHORTCUT
      // (`[label]`) and COLLAPSED (`[label][]`) references use the
      // label itself as the identifier: converting it would break the
      // match to the definition, so mask those nodes whole.
      const refType = (node as { referenceType?: string }).referenceType;
      const labelIsId = refType === "shortcut" || refType === "collapsed";
      if ((node.type === "link" && overhead <= 2) || labelIsId) {
        cover(span[0], span[1]);
        return;
      }
      cover(lastSpan ? lastSpan[1] : span[0], span[1]);
    }
  });

  return mask;
}

export interface MathFlowExtent {
  /** Offset of the node's first character — the fence's opening `$`;
   *  container prefixes (`> `, list indent) sit BEFORE this offset. */
  start: number;
  /** Offset just past the node. */
  end: number;
  /** The node's value (content between the fences). */
  value: string;
}

/** All math FLOW nodes (block `$$` fences) with usable offsets. */
export function collectMathFlowExtents(tree: Root): MathFlowExtent[] {
  const extents: MathFlowExtent[] = [];
  visit(tree, (node) => {
    if (node.type !== "math") return;
    const span = spanOf(node);
    if (!span) return;
    extents.push({
      start: span[0],
      end: span[1],
      value: (node as unknown as { value?: string }).value ?? "",
    });
  });
  return extents;
}
