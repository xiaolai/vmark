/**
 * LaTeX Plugin
 *
 * Adds math/LaTeX support to the editor:
 * - Inline math: $E=mc^2$
 * - Block math: $$ ... $$ or ```latex code blocks
 *
 * Uses KaTeX for rendering and remark-math for parsing.
 */

import { escapeHtml } from "@/utils/sanitize";
import { loadKatex, type KatexOptions } from "./katexLoader";

export interface LatexConfig {
  katexOptions?: KatexOptions;
}

/**
 * Render LaTeX content to HTML using KaTeX.
 */
export async function renderLatex(
  content: string,
  options?: KatexOptions
): Promise<string> {
  try {
    const katex = await loadKatex();
    return katex.default.renderToString(content, {
      ...options,
      throwOnError: false,
      displayMode: true,
    });
  } catch {
    return `<pre class="math-error">${escapeHtml(content)}</pre>`;
  }
}
