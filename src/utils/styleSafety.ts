/**
 * CSS safety — one place that decides whether a style value is dangerous.
 *
 * Purpose: the same three questions ("does this fetch?", "does this
 * execute?", "does this escape its box?") were answered by three different
 * pieces of code — `isSafeStyleValue` for HTML preview, `sanitizeSvgStyleValue`
 * for SVG, and nothing at all for KaTeX. Divergent copies of a security
 * predicate are how one surface quietly ends up weaker than its siblings,
 * which is exactly what happened: KaTeX accepted `url(https://…)` beacons and
 * `position: fixed` viewport overlays.
 *
 * Key decisions:
 *   - Values are CSS-unescaped before inspection, so `u\72l(` cannot walk
 *     past a scanner that only knows the literal spelling of `url(`.
 *   - `position` is value-restricted rather than banned: KaTeX genuinely
 *     emits `relative` and `absolute` for layout, while `fixed`/`sticky`
 *     pin content to the viewport — a clickjacking surface, never math.
 *   - Stylesheet TEXT (an SVG `<style>` element) is filtered rule-by-rule
 *     rather than dropped wholesale, because Mermaid ships its theming that
 *     way and forbidding the element would break every themed diagram.
 *
 * @coordinates-with sanitize.ts — HTML preview and KaTeX
 * @coordinates-with svgSanitize.ts — SVG attribute and stylesheet filtering
 * @coordinates-with svgResourcePolicy.ts — which references may reach the network
 * @module utils/styleSafety
 */

import { hasExternalUrlReference } from "./svgResourcePolicy";
import { normalizeCss } from "./cssNormalize";

/**
 * CSS properties KaTeX emits.
 *
 * Derived from KaTeX's SOURCE (every `style.<prop> =` assignment), not from
 * a sample render — sampling missed `text-shadow` (`\pmb`) and
 * `border-right-style` (array separators), so those constructs lost their
 * formatting after sanitization. Re-derive with:
 *
 *   grep -rhoE "style\.[a-zA-Z]+ =" node_modules/…/katex/src
 *
 * A few layout properties KaTeX does not currently emit are included where
 * the omission would be arbitrary (`margin-bottom`, the padding side that
 * matches `padding-left`, `right`); the value rules below are what keep the
 * list safe, not its narrowness.
 */
export const KATEX_STYLE_PROPS: ReadonlySet<string> = new Set([
  "height",
  "width",
  "min-width",
  "max-width",
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
  "top",
  "left",
  "bottom",
  "right",
  "position",
  "vertical-align",
  "display",
  "text-align",
  "line-height",
  "white-space",
  "color",
  "background-color",
  "font-size",
  "font-family",
  "font-weight",
  "font-style",
  "border",
  "border-color",
  "border-width",
  "border-style",
  "border-top-width",
  "border-bottom-width",
  "border-left-width",
  "border-right-width",
  "border-right-style",
  "text-shadow",
  "transform",
]);

/** `position` values that pin content to the viewport rather than the flow. */
const UNSAFE_POSITION_VALUES: ReadonlySet<string> = new Set(["fixed", "sticky"]);

/**
 * True when a declaration value is safe to keep. `property` is optional and
 * only narrows the check further (currently `position`).
 */
export function isSafeStyleValue(value: string, property?: string): boolean {
  const lowered = normalizeCss(value).toLowerCase();
  if (
    lowered.includes("url(") ||
    lowered.includes("expression(") ||
    lowered.includes("javascript:") ||
    lowered.includes("-moz-binding") ||
    lowered.includes("behavior:")
  ) {
    return false;
  }
  if (lowered.includes("<") || lowered.includes(">")) return false;
  if (property === "position" && UNSAFE_POSITION_VALUES.has(lowered.trim())) {
    return false;
  }
  return true;
}

/**
 * Keep only declarations whose property is allowed and whose value is safe.
 * Returns a `prop: value; …` string, empty when nothing survives.
 */
export function sanitizeDeclarations(
  style: string,
  allowedProps: ReadonlySet<string>,
): string {
  const kept: string[] = [];
  for (const declaration of style.split(";")) {
    const trimmed = declaration.trim();
    if (!trimmed) continue;
    const [rawProperty, ...rest] = trimmed.split(":");
    if (!rawProperty || rest.length === 0) continue;
    const property = rawProperty.trim().toLowerCase();
    if (!allowedProps.has(property)) continue;
    const value = rest.join(":").trim();
    if (!isSafeStyleValue(value, property)) continue;
    kept.push(`${property}: ${value}`);
  }
  return kept.join("; ");
}

/**
 * Filter stylesheet TEXT (an SVG `<style>` element's content).
 *
 * `@import` is removed outright — it exists to fetch. Remaining rules are
 * dropped only when they reference something external or carry an execution
 * vector, so a themed Mermaid diagram survives intact while a beacon does
 * not.
 */
export function sanitizeStylesheetText(css: string): string {
  const withoutImports = normalizeCss(css).replace(/@import[^;]*;?/gi, "");
  const dangerous = (chunk: string) => {
    const lowered = chunk.toLowerCase();
    return (
      lowered.includes("expression(") ||
      lowered.includes("javascript:") ||
      lowered.includes("-moz-binding") ||
      hasExternalUrlReference(chunk)
    );
  };
  // Split on rule boundaries, keeping the brace so a kept rule round-trips.
  const rules = withoutImports.match(/[^{}]*\{[^{}]*\}|[^{}]+/g) ?? [];
  return rules
    .filter((rule) => !dangerous(rule))
    .join("")
    .trim();
}

/**
 * Rewrite every `style` attribute in `html` through the shared declaration
 * filter, using the given property allow-list. Without a DOM (SSR, worker)
 * the attributes are dropped entirely — the safe direction.
 */
export function filterStyleAttributes(
  html: string,
  allowedProps: ReadonlySet<string>,
): string {
  if (typeof document === "undefined") {
    return html.replace(/\s+style="[^"]*"/gi, "");
  }
  const container = document.createElement("div");
  container.innerHTML = html;
  for (const element of container.querySelectorAll<HTMLElement>("[style]")) {
    const filtered = sanitizeDeclarations(
      element.getAttribute("style") ?? "",
      allowedProps,
    );
    if (filtered) element.setAttribute("style", filtered);
    else element.removeAttribute("style");
  }
  return container.innerHTML;
}

/**
 * True when an ENTIRE `style` attribute is safe, checking each declaration
 * with its own property.
 *
 * The SVG path used to hand the whole attribute to `isSafeStyleValue`, which
 * only applies the `position` rule when it is told the property — so
 * `style="position:fixed"` sailed through the very check written to stop it.
 */
export function isSafeStyleAttribute(style: string): boolean {
  for (const declaration of normalizeCss(style).split(";")) {
    const trimmed = declaration.trim();
    if (!trimmed) continue;
    const [rawProperty, ...rest] = trimmed.split(":");
    const property = rawProperty.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (!isSafeStyleValue(value || trimmed, property)) return false;
  }
  return true;
}
