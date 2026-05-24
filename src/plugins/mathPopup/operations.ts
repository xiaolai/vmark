/**
 * mathPopup operations — ADR-010 pattern.
 *
 * Both controllers (Tiptap inline-math nodes; CodeMirror $$...$$ blocks)
 * call these helpers to normalize and validate LaTeX before committing
 * the edit. Engine-specific transaction dispatch stays in controllers.
 *
 * @module plugins/mathPopup/operations
 */

/** Strip surrounding whitespace; leave the LaTeX body intact. */
export function normalizeLatex(input: string): string {
  return input.trim();
}

/** Empty or whitespace-only is not a valid math expression. */
export function isValidLatex(input: string): boolean {
  return normalizeLatex(input).length > 0;
}

/**
 * Wrap a raw LaTeX string in the source-mode delimiters expected by
 * the markdown parser. `display=true` wraps in `$$...$$`; `false` wraps
 * in inline `$...$`.
 */
export function wrapForSource(latex: string, display: boolean): string {
  const body = normalizeLatex(latex);
  return display ? `$$${body}$$` : `$${body}$`;
}

/** Detect whether a source-mode string is a display ($$...$$) block. */
export function isDisplayBlock(source: string): boolean {
  return source.startsWith("$$") && source.endsWith("$$");
}
