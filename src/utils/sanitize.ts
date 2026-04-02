/**
 * HTML Sanitization Utilities
 *
 * Purpose: Secure HTML sanitization via DOMPurify to prevent XSS attacks. Tailored
 * allowlists per content type — general HTML (including media tags), SVG, KaTeX.
 *
 * Key decisions:
 *   - Separate functions for each content type (general HTML, SVG, KaTeX) because
 *     each has different security requirements and allowed elements
 *   - SVG sanitization allows foreignObject + HTML profiles for Mermaid diagrams
 *     (Mermaid uses HTML inside SVG for text layout)
 *   - Style attribute sanitization uses a property allowlist to block
 *     expression() and javascript: attacks in inline styles
 *   - Video, audio, and source tags are allowed in sanitizeMediaHtml (separate function)
 *   - Iframe is allowed in sanitizeMediaHtml but restricted to whitelisted video domains via post-pass
 *   - escapeHtml is a simple entity escape for non-HTML text display
 *
 * @coordinates-with mermaid/index.ts — uses sanitizeSvg for Mermaid diagram output
 * @coordinates-with latex/katexLoader.ts — uses sanitizeKatex for math rendering
 * @coordinates-with htmlPaste/tiptap.ts — uses sanitizeHtml for pasted HTML
 * @module utils/sanitize
 */

import DOMPurify from "dompurify";

/**
 * Sanitize HTML content, removing potentially dangerous elements.
 * Safe for general HTML content.
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "div",
      "span",
      "p",
      "br",
      "strong",
      "em",
      "b",
      "i",
      "u",
      "s",
      "code",
      "pre",
      "blockquote",
      "ul",
      "ol",
      "li",
      "a",
      "img",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "hr",
      "sub",
      "sup",
    ],
    ALLOWED_ATTR: ["href", "src", "alt", "title", "class", "id", "target", "rel"],
    ALLOW_DATA_ATTR: false,
  });
}

const HTML_PREVIEW_TAGS_INLINE = [
  "span",
  "br",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "s",
  "code",
  "a",
  "img",
  "sub",
  "sup",
];

const HTML_PREVIEW_TAGS_BLOCK = [
  "div",
  "span",
  "p",
  "br",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "s",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "a",
  "img",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "hr",
  "sub",
  "sup",
];

const HTML_PREVIEW_ATTRS = [
  "href",
  "src",
  "alt",
  "title",
  "class",
  "id",
  "target",
  "rel",
  "width",
  "height",
  "align",
];

const HTML_PREVIEW_STYLE_PROPS = new Set([
  "color",
  "background-color",
  "font-weight",
  "font-style",
  "text-decoration",
  "text-align",
  "margin",
  "margin-left",
  "margin-right",
  "margin-top",
  "margin-bottom",
  "padding",
  "padding-left",
  "padding-right",
  "padding-top",
  "padding-bottom",
  "display",
  "max-width",
  "width",
  "height",
]);

/** Whether the HTML preview allows inline-only or block-level elements. */
export type HtmlPreviewContext = "inline" | "block";

/** Options for sanitizeHtmlPreview: context level and optional style allowlist. */
export interface HtmlPreviewOptions {
  allowStyles?: boolean;
  context?: HtmlPreviewContext;
}

/** Sanitize HTML for preview display with configurable context and optional safe style attributes. */
export function sanitizeHtmlPreview(html: string, options?: HtmlPreviewOptions): string {
  const context = options?.context ?? "inline";
  const allowStyles = options?.allowStyles ?? false;
  const allowedTags = context === "block" ? HTML_PREVIEW_TAGS_BLOCK : HTML_PREVIEW_TAGS_INLINE;
  const allowedAttrs = allowStyles ? [...HTML_PREVIEW_ATTRS, "style"] : HTML_PREVIEW_ATTRS;

  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: allowedTags,
    ALLOWED_ATTR: allowedAttrs,
    ALLOW_DATA_ATTR: false,
  });

  if (!allowStyles) {
    return sanitized;
  }

  return filterAllowedStyles(sanitized);
}

function filterAllowedStyles(html: string): string {
  if (typeof document === "undefined") {
    // No DOM available — strip style attrs entirely for safety
    return html.replace(/\s+style="[^"]*"/gi, "");
  }

  const container = document.createElement("div");
  container.innerHTML = html;

  const elements = container.querySelectorAll<HTMLElement>("[style]");
  elements.forEach((element) => {
    /* v8 ignore next -- @preserve querySelectorAll("[style]") only matches elements that have the attribute */
    const style = element.getAttribute("style") ?? "";
    const sanitizedStyle = sanitizeStyleAttribute(style);
    if (!sanitizedStyle) {
      element.removeAttribute("style");
      return;
    }
    element.setAttribute("style", sanitizedStyle);
  });

  return container.innerHTML;
}

function sanitizeStyleAttribute(style: string): string {
  const declarations = style.split(";").map((decl) => decl.trim()).filter(Boolean);
  const safeDeclarations: string[] = [];

  for (const declaration of declarations) {
    const [rawProperty, ...rest] = declaration.split(":");
    if (!rawProperty || rest.length === 0) continue;

    const property = rawProperty.trim().toLowerCase();
    if (!HTML_PREVIEW_STYLE_PROPS.has(property)) continue;

    const value = rest.join(":").trim();
    if (!isSafeStyleValue(value)) continue;

    safeDeclarations.push(`${property}: ${value}`);
  }

  return safeDeclarations.join("; ");
}

function isSafeStyleValue(value: string): boolean {
  const lowered = value.toLowerCase();
  if (lowered.includes("url(") || lowered.includes("expression(") || lowered.includes("javascript:")) {
    return false;
  }
  if (lowered.includes("<") || lowered.includes(">")) {
    return false;
  }
  return true;
}

/**
 * Sanitize media HTML content (video, audio, video embed iframes).
 * Allows media-specific tags and attributes while preventing XSS.
 *
 * Video embed iframes are restricted to whitelisted domains (YouTube, Vimeo, Bilibili)
 * via a post-sanitize DOM pass that strips non-whitelisted iframes.
 */
export function sanitizeMediaHtml(html: string): string {
  // Sanitize with DOMPurify, then post-process to strip non-whitelisted video-provider iframes
  const result = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "video",
      "audio",
      "source",
      "iframe",
    ],
    ALLOWED_ATTR: [
      "src",
      "title",
      "controls",
      "preload",
      "poster",
      "loop",
      "muted",
      "width",
      "height",
      "type",
      "allowfullscreen",
      "frameborder",
      "allow",
    ],
    ALLOW_DATA_ATTR: false,
  });

  // Post-process: strip iframes with non-whitelisted src (case-insensitive check)
  if (/<iframe\b/i.test(result)) {
    return stripNonWhitelistedIframes(result);
  }
  return result;
}

const VIDEO_EMBED_DOMAIN_RE = /^https?:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com|player\.vimeo\.com|player\.bilibili\.com)\//;

function stripNonWhitelistedIframes(html: string): string {
  if (typeof document === "undefined") {
    // No DOM — strip all iframes for safety (can't verify src)
    // Handles both paired (<iframe>...</iframe>) and self-closing (<iframe ... />) forms
    return html
      .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "")
      .replace(/<iframe\b[^>]*\/\s*>/gi, "");
  }
  const container = document.createElement("div");
  container.innerHTML = html;
  const iframes = container.querySelectorAll("iframe");
  for (const iframe of iframes) {
    const src = iframe.getAttribute("src") ?? "";
    if (!VIDEO_EMBED_DOMAIN_RE.test(src)) {
      iframe.remove();
    }
  }
  return container.innerHTML;
}

/**
 * Sanitize SVG content for safe rendering (e.g., Mermaid diagrams).
 * Allows SVG elements but removes scripts and event handlers.
 * Preserves style attributes and all SVG-specific attributes for proper rendering.
 *
 * Mermaid uses foreignObject with HTML labels (div, span) inside SVG.
 * HTML_INTEGRATION_POINTS tells DOMPurify to allow HTML inside foreignObject,
 * and the html profile provides the allowed HTML tag list. Without these,
 * DOMPurify strips the HTML wrappers (div, span) from foreignObject content,
 * losing inline styles (line-height, display, text-align) that mermaid relies
 * on for correct text sizing — causing text to clip inside node boxes.
 */
export function sanitizeSvg(svg: string): string {
  // Use a separate DOMPurify instance for SVG to avoid hook leaks
  const purify = DOMPurify();

  // Hook: sanitize dangerous CSS patterns in style attributes
  // DOMPurify does not filter CSS property values for SVG profiles,
  // so we strip expression(), javascript:, -moz-binding, and url(javascript:)
  purify.addHook("uponSanitizeAttribute", (_node, data) => {
    if (data.attrName === "style" && data.attrValue) {
      data.attrValue = sanitizeSvgStyleValue(data.attrValue);
    }
  });

  const result = purify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    ADD_TAGS: ["foreignObject", "use"],
    // Explicitly add style and common SVG attributes that might be needed
    ADD_ATTR: ["style", "fill", "stroke", "class", "transform", "d", "cx", "cy", "r", "rx", "ry", "x", "y", "width", "height", "viewBox", "xmlns", "marker-end", "marker-start", "href"],
    FORBID_TAGS: ["script"],
    FORBID_ATTR: [
      "onerror",
      "onload",
      "onclick",
      "onmouseover",
      "onfocus",
      "onblur",
    ],
    // Allow HTML elements inside SVG foreignObject (mermaid's htmlLabels)
    HTML_INTEGRATION_POINTS: { foreignobject: true },
  });

  purify.removeAllHooks();
  return result;
}

/**
 * Strip dangerous CSS patterns from SVG style attribute values.
 * Blocks expression(), -moz-binding, javascript: URLs, and similar vectors.
 */
function sanitizeSvgStyleValue(style: string): string {
  const lowered = style.toLowerCase();
  if (
    lowered.includes("expression(") ||
    lowered.includes("javascript:") ||
    lowered.includes("-moz-binding") ||
    lowered.includes("behavior:")
  ) {
    // Strip the entire style — partial removal is error-prone
    return "";
  }
  return style;
}

/**
 * Sanitize KaTeX output for safe rendering.
 */
export function sanitizeKatex(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "span",
      "math",
      "semantics",
      "mrow",
      "mi",
      "mo",
      "mn",
      "msup",
      "msub",
      "mfrac",
      "mover",
      "munder",
      "munderover",
      "msqrt",
      "mroot",
      "mtable",
      "mtr",
      "mtd",
      "mtext",
      "mspace",
      "annotation",
      "svg",
      "line",
      "path",
    ],
    ALLOWED_ATTR: [
      "class",
      "style",
      "mathvariant",
      "displaystyle",
      "scriptlevel",
      "width",
      "height",
      "viewBox",
      "preserveAspectRatio",
      "xmlns",
      "d",
      "x1",
      "y1",
      "x2",
      "y2",
      "stroke",
      "stroke-width",
    ],
    ALLOW_DATA_ATTR: false,
  });
}

/**
 * Escape HTML entities for safe text display.
 * Use when displaying raw content in error messages.
 */
export function escapeHtml(text: string): string {
  const htmlEscapes: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  /* v8 ignore next -- @preserve regex only matches chars that are keys in htmlEscapes */
  return text.replace(/[&<>"']/g, (char) => htmlEscapes[char] || char);
}
