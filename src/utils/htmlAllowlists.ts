/**
 * HTML preview allow-lists (strict / extended) + custom-tag parsing.
 *
 * Purpose: Data + a pure parser backing `sanitizeHtmlPreview`. Kept leaf-pure
 *   (ADR-013) so both the sanitizer (`utils/sanitize.ts`) and the WYSIWYG node
 *   view can consume it without store/DOM coupling.
 *
 * Security model: these lists are the allow-side of DOMPurify. The deny-side
 *   (`DANGEROUS_TAGS`) is passed to DOMPurify's `FORBID_TAGS` and ALWAYS wins —
 *   so even a user-supplied custom tag (or a future allow-list mistake) cannot
 *   re-introduce `<script>`, `<style>`, `<iframe>`, `<form>`, etc. Event-handler
 *   (`on*`) attributes are stripped by DOMPurify regardless of these lists.
 *
 * @coordinates-with utils/sanitize.ts — consumes these in sanitizeHtmlPreview
 * @coordinates-with plugins/markdownArtifacts/HtmlNodeView.ts — parses custom tags
 * @module utils/htmlAllowlists
 */

/** Breadth of the raw-HTML preview allow-list. */
export type HtmlAllowlistLevel = "strict" | "extended";

// --- Strict (the historical default) -------------------------------------

export const PREVIEW_TAGS_INLINE_STRICT = [
  "span", "br", "strong", "em", "b", "i", "u", "s", "code", "a", "img", "sub", "sup",
];

export const PREVIEW_TAGS_BLOCK_STRICT = [
  "div", "span", "p", "br", "strong", "em", "b", "i", "u", "s", "code", "pre",
  "blockquote", "ul", "ol", "li", "a", "img", "h1", "h2", "h3", "h4", "h5", "h6",
  "table", "thead", "tbody", "tr", "th", "td", "hr", "sub", "sup",
];

export const PREVIEW_ATTRS_STRICT = [
  "href", "src", "alt", "title", "class", "id", "target", "rel", "width", "height", "align",
];

// --- Extended additions (vetted safe, opt-in) ----------------------------

/** Semantic inline tags safe to render (no scripting surface). */
const EXTENDED_TAGS_INLINE = [
  "mark", "del", "ins", "abbr", "cite", "q", "samp", "kbd", "var", "wbr",
  "small", "time", "bdi", "bdo", "dfn", "ruby", "rt", "rp",
];

/** Semantic / structural block tags safe to render. */
const EXTENDED_TAGS_BLOCK = [
  "figure", "figcaption", "details", "summary", "section", "article", "aside",
  "header", "footer", "nav", "main", "address", "dl", "dt", "dd",
  "caption", "colgroup", "col", "picture", "source",
];

/**
 * Static SVG tags. `foreignObject`, `script`, `style`, and the `animate*`
 * family are excluded — they re-open HTML/script injection inside SVG.
 * `use`/`image` are also excluded: their `href`/`xlink:href` can point at
 * external resources (DOMPurify allows http(s) URIs), an exfil/SSRF vector.
 * Decorative inline SVG (path/shape based) needs none of these. (Mermaid's
 * richer SVG goes through `sanitizeSvg`, not this path.)
 */
const EXTENDED_TAGS_SVG = [
  "svg", "g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon",
  "text", "tspan", "defs", "symbol", "title", "desc", "marker",
  "lineargradient", "radialgradient", "stop", "clippath", "mask", "pattern",
];

/** HTML attributes unlocked in extended mode (beyond the strict set). */
const EXTENDED_ATTRS_HTML = [
  "colspan", "rowspan", "headers", "scope", "open", "datetime", "cite",
  "srcset", "sizes", "media", "loading", "decoding", "start", "reversed",
  "value", "dir", "lang", "role", "aria-label", "aria-hidden", "aria-describedby",
];

/** SVG presentation/geometry attributes (DOMPurify matches case-insensitively). */
const EXTENDED_ATTRS_SVG = [
  "viewBox", "xmlns", "xmlns:xlink", "fill", "stroke", "stroke-width",
  "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset",
  "stroke-miterlimit", "d", "cx", "cy", "r", "rx", "ry", "x", "y",
  "x1", "y1", "x2", "y2", "points", "transform", "gradientUnits",
  "gradientTransform", "offset", "stop-color", "stop-opacity", "fill-opacity",
  "stroke-opacity", "opacity", "font-size", "font-family", "font-weight",
  "text-anchor", "dominant-baseline", "alignment-baseline", "dx", "dy",
  "preserveAspectRatio", "clip-path", "clip-rule", "fill-rule", "mask",
  "patternUnits", "patternTransform", "markerWidth",
  "markerHeight", "refX", "refY", "orient", "markerUnits", "spreadMethod",
  "fx", "fy", "vector-effect",
  // Note: href / xlink:href deliberately omitted — see EXTENDED_TAGS_SVG.
];

export const PREVIEW_TAGS_INLINE_EXTENDED = [
  ...PREVIEW_TAGS_INLINE_STRICT,
  ...EXTENDED_TAGS_INLINE,
  ...EXTENDED_TAGS_SVG,
];

export const PREVIEW_TAGS_BLOCK_EXTENDED = [
  ...PREVIEW_TAGS_BLOCK_STRICT,
  ...EXTENDED_TAGS_INLINE,
  ...EXTENDED_TAGS_BLOCK,
  ...EXTENDED_TAGS_SVG,
];

export const PREVIEW_ATTRS_EXTENDED = [
  ...PREVIEW_ATTRS_STRICT,
  ...EXTENDED_ATTRS_HTML,
  ...EXTENDED_ATTRS_SVG,
];

export const PREVIEW_STYLE_PROPS = new Set([
  "color", "background-color", "font-weight", "font-style", "text-decoration",
  "text-align", "margin", "margin-left", "margin-right", "margin-top",
  "margin-bottom", "padding", "padding-left", "padding-right", "padding-top",
  "padding-bottom", "display", "max-width", "width", "height",
]);

/**
 * Tags that must NEVER render in the preview, regardless of allow-list level
 * or custom additions. Passed to DOMPurify `FORBID_TAGS`, which overrides
 * `ALLOWED_TAGS` — this is what makes the custom-tag field safe.
 */
export const DANGEROUS_TAGS = [
  "script", "style", "iframe", "frame", "frameset", "object", "embed", "applet",
  "form", "input", "button", "select", "option", "textarea", "label", "fieldset",
  "link", "meta", "base", "noscript", "template", "slot", "foreignobject",
  "animate", "animatetransform", "animatemotion", "set", "math",
];

const DANGEROUS_TAGS_SET = new Set(DANGEROUS_TAGS);

/** A syntactically valid, lowercase HTML/SVG tag name (custom elements allowed). */
const VALID_TAG_RE = /^[a-z][a-z0-9-]*$/;

/**
 * Parse the user's "also allow these tags" field into a clean tag list.
 *
 * Accepts comma- and/or whitespace-separated names. Normalizes to lowercase,
 * drops anything that isn't a valid tag name, de-duplicates, and removes
 * dangerous tags (so the field can't be used to allow `<script>`). The result
 * is still run through DOMPurify, so this is a usability filter layered on top
 * of the hard `FORBID_TAGS` guarantee — not the sole line of defense.
 */
export function parseCustomTags(raw: unknown): string[] {
  // Accept unknown and guard: a corrupted/migrated persisted value could be a
  // non-string, and raw.split() would otherwise throw.
  if (typeof raw !== "string" || !raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of raw.split(/[\s,]+/)) {
    const tag = token.trim().toLowerCase();
    if (!tag || !VALID_TAG_RE.test(tag)) continue;
    if (DANGEROUS_TAGS_SET.has(tag)) continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}
