/**
 * Give a mermaid SVG a resolvable height (#1200, #1215).
 *
 * Mermaid's `calculateSvgSizeAttrs` emits, when `useMaxWidth` is on:
 *
 *     width="100%"  style="max-width: <W>px;"      // and NO height
 *
 * and that is the default for every diagram type, so overriding it in config
 * would mean enumerating each type and re-doing so whenever mermaid adds one.
 * Normalising the emitted markup covers them all at once.
 *
 * Why it matters: VMark renders that SVG as a non-stretched flex item
 * (`display:flex; align-items:center`) styled `height: auto`. A replaced
 * element with a percentage width and no intrinsic height must derive its
 * height from the viewBox ratio, and where an engine resolves that to zero the
 * diagram is invisible — inside a `min-height:100px` container with a grey
 * background, which is exactly the "empty grey placeholder" both issues
 * describe: no error box, no log line, nothing to grep for. Markmap never hit
 * it because it sets an explicit `height`.
 *
 * The fix adds `aspect-ratio` rather than a `height` attribute, for two
 * reasons:
 *   - a `height` ATTRIBUTE is a presentation hint, so the stylesheet's
 *     `height: auto` outranks it and the element stays indefinite;
 *   - replacing `width="100%"` with pixels would shrink every diagram that
 *     currently fills the editor width — a visible change for everyone, to
 *     fix a bug only some see.
 * `aspect-ratio` leaves the width behaviour alone and lets `height: auto`
 * resolve deterministically from an explicit ratio instead of an inferred one.
 *
 * @coordinates-with plugin.ts — applied to every rendered diagram
 * @coordinates-with mermaid.css — the `max-width: 100%; height: auto` rules
 * @module plugins/mermaid/ensureSvgSize
 */

/** `viewBox="minX minY W H"`, space- or comma-separated. */
const VIEWBOX_RE = /\bviewBox\s*=\s*"\s*([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)\s*"/;

/** The opening tag of the ROOT `<svg>` element. */
const ROOT_SVG_TAG_RE = /^(\s*)(<svg\b[^>]*>)/;

/**
 * Add an explicit `aspect-ratio` derived from the viewBox so `height: auto`
 * always resolves. Input without a root `<svg>`, without a usable viewBox,
 * already carrying a height or an aspect-ratio, is returned unchanged.
 */
export function ensureSvgSize(svg: string): string {
  const tagMatch = ROOT_SVG_TAG_RE.exec(svg);
  if (!tagMatch) return svg;

  const [, leading, openTag] = tagMatch;
  // An explicit height, or a ratio someone already set, resolves on its own.
  if (/\bheight\s*=/.test(openTag) || /aspect-ratio\s*:/.test(openTag)) return svg;

  const viewBox = VIEWBOX_RE.exec(openTag);
  if (!viewBox) return svg;

  const width = Number(viewBox[3]);
  const height = Number(viewBox[4]);
  // A degenerate viewBox would pin the diagram flat — worse than leaving the
  // engine to guess.
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return svg;
  }

  const ratio = `aspect-ratio: ${width} / ${height};`;
  const styled = /\bstyle\s*=\s*"/.test(openTag)
    ? openTag.replace(/\bstyle\s*=\s*"([^"]*)"/, (_m, css: string) => {
        const sep = css.trim().endsWith(";") || css.trim() === "" ? "" : ";";
        return `style="${css}${sep} ${ratio}"`;
      })
    : openTag.replace(/^<svg\b/, `<svg style="${ratio}"`);

  return leading + styled + svg.slice(tagMatch[0].length);
}
