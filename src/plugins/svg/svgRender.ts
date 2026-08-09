/**
 * SVG Block Renderer
 *
 * Validates that a code block's content is well-formed SVG.
 * Unlike mermaid (DSL → SVG), the content IS the SVG — just validate it.
 *
 * `parseSvg` is the single parse implementation (WI-4.7). The `.svg` format
 * adapter previously carried its own DOMParser + `parsererror` check, so the
 * same document was parsed twice with two independently maintained notions of
 * "well-formed". Both now call this; they differ only in how they PRESENT the
 * result — the renderer wants a string or null, the validator wants a message.
 *
 * @coordinates-with lib/formats/adapters/svg.tsx — the validator consumer
 */

/** Why `parseSvg` rejected the content, or `null` when it is well-formed. */
type SvgParseError =
  | { kind: "empty" }
  | { kind: "not-svg" }
  | { kind: "malformed"; message: string }
  | { kind: "wrong-root"; tagName: string };

export interface SvgParseResult {
  /** The trimmed source when well-formed, otherwise null. */
  svg: string | null;
  error: SvgParseError | null;
}

/**
 * Parse and validate SVG source once.
 *
 * The single source of truth for "is this well-formed SVG" — see the module
 * header. Callers choose their own presentation.
 */
export function parseSvg(content: string): SvgParseResult {
  const trimmed = content.trim();
  if (!trimmed) return { svg: null, error: { kind: "empty" } };

  // Must start with <svg or <?xml (check for <svg followed by space, >, or /)
  if (!/^<svg[\s>/]/.test(trimmed) && !trimmed.startsWith("<?xml")) {
    return { svg: null, error: { kind: "not-svg" } };
  }

  /* v8 ignore next 3 -- @preserve jsdom DOMParser fallback path */
  if (typeof DOMParser === "undefined") {
    return { svg: trimmed, error: null };
  }

  const doc = new DOMParser().parseFromString(trimmed, "image/svg+xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    return {
      svg: null,
      error: { kind: "malformed", message: parserError.textContent ?? "XML parse error" },
    };
  }

  // If it started with <?xml, verify the root element is <svg>
  if (doc.documentElement.tagName !== "svg") {
    return { svg: null, error: { kind: "wrong-root", tagName: doc.documentElement.tagName } };
  }

  return { svg: trimmed, error: null };
}

export function renderSvgBlock(content: string): string | null {
  return parseSvg(content).svg;
}
