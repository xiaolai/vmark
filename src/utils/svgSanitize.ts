/**
 * SVG sanitization.
 *
 * Purpose: make an untrusted SVG safe to render — strip scripting, and stop
 * the document fetching anything when it is merely opened. Split out of
 * `sanitize.ts` so each file stays within its size budget and the SVG rules
 * sit next to the policy that decides them.
 *
 * Mermaid uses foreignObject with HTML labels (div, span) inside SVG.
 * HTML_INTEGRATION_POINTS tells DOMPurify to allow HTML inside foreignObject,
 * and the html profile provides the allowed HTML tag list. Without these,
 * DOMPurify strips the HTML wrappers from foreignObject content, losing the
 * inline styles mermaid relies on for text sizing.
 *
 * @coordinates-with svgResourcePolicy.ts — which references may reach the network
 * @coordinates-with sanitize.ts — re-exports sanitizeSvg for existing callers
 * @module utils/svgSanitize
 */

import DOMPurify from "dompurify";
import {
  isSameDocumentOrInlineRef,
  isResourceLoadingRef,
  hasExternalUrlReference,
  PAINT_URL_ATTRS,
} from "./svgResourcePolicy";
import { sanitizeStylesheetText, isSafeStyleAttribute } from "./styleSafety";

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
  // A `<style>` element inside SVG is where a remote `@import` or an
  // external `url()` hides — the attribute hook below never sees it, because
  // the payload is TEXT. Mermaid ships its theming this way, so the sheet is
  // filtered rule-by-rule rather than dropped.
  purify.addHook("uponSanitizeElement", (node, data) => {
    if (data.tagName !== "style") return;
    const el = node as { textContent?: string | null };
    if (typeof el.textContent === "string" && el.textContent) {
      el.textContent = sanitizeStylesheetText(el.textContent);
    }
  });

  purify.addHook("uponSanitizeAttribute", (node, data) => {
    const element = node?.nodeName ?? "";
    if (data.attrName === "style" && data.attrValue) {
      // Shared predicate — a private copy here is how SVG and HTML preview
      // came to enforce different rules.
      if (!isSafeStyleAttribute(data.attrValue)) data.attrValue = "";
      // A style value fetches through url() exactly as an href does.
      if (hasExternalUrlReference(data.attrValue)) data.attrValue = "";
    }
    // A resource-loading reference must not reach the network: an untrusted
    // diagram would otherwise beacon the reader's IP and open time on open.
    // Element-aware by design — `<a href>` is navigation, not a fetch (see
    // svgResourcePolicy.ts).
    if (
      data.attrValue &&
      isResourceLoadingRef(element, data.attrName) &&
      !isSameDocumentOrInlineRef(data.attrValue)
    ) {
      data.attrValue = "";
      data.keepAttr = false;
    }
    // Paint attributes fetch through url(…) — `url(#gradient)` stays.
    if (
      data.attrValue &&
      PAINT_URL_ATTRS.includes(data.attrName.toLowerCase()) &&
      hasExternalUrlReference(data.attrValue)
    ) {
      data.attrValue = "";
      data.keepAttr = false;
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
