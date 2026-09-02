/**
 * Primitive Design Tokens for Export
 *
 * Purpose: the exported HTML embeds a SNAPSHOT of the theme
 * (`themeSnapshot.ts`), but the bundled editor CSS also consumes PRIMITIVE
 * tokens — `--border-thin`, `--space-*`, `--font-size-*`, `--duration-*` —
 * which live only in `src/styles/index.css` and are in no snapshot.
 *
 * A `var()` that resolves to nothing makes the WHOLE declaration invalid at
 * computed-value time. It does not fall back and it does not warn. So
 * `border: var(--border-thin) solid var(--table-border-color)` — the rule that
 * draws every table border — produced NO border at all in exported PDFs, and
 * the same silent deletion hit code-block padding, task checkboxes, details
 * headers and alert borders.
 *
 * **Why the values are inlined rather than read from `index.css?raw`.** A raw
 * import puts the ENTIRE stylesheet (12.8 kB) into the export chunk, which blew
 * the size-limit budget by 5.79 kB; only ~2.1 kB of it is ever consumed. The
 * usual objection to restating tokens — that a copy drifts — is answered by a
 * gate rather than by discipline: `exportCssVarCoverage.test.ts` reads
 * `index.css` FROM DISK and fails if any consumed primitive is missing here OR
 * if any value here disagrees with it. Adding a primitive to index.css and
 * consuming it from bundled CSS therefore fails until it is added here too.
 *
 * @module export/primitiveTokens
 * @coordinates-with themeSnapshot.ts — the semantic half of the same problem
 * @coordinates-with styles/index.css — the authority these values are pinned to
 */

/** The primitives the bundled editor CSS consumes, pinned to index.css. */
const PRIMITIVES = `
  --accent-bg: rgba(0, 102, 204, 0.1);
  --accent-primary: #0066cc;
  --alert-important: #8250df;
  --alert-note: #0969da;
  --alert-tip: #1a7f37;
  --alert-warning: #9a6700;
  --bar-height: 40px;
  --bg-color: #eeeded;
  --bg-secondary: #e5e4e4;
  --bg-tertiary: #f0f0f0;
  --border-color: #d5d4d4;
  --border-medium: 2px;
  --border-thick: 4px;
  --border-thin: 1px;
  --code-bg-color: var(--bg-secondary);
  --code-text-color: #1a1a1a;
  --contrast-text: white;
  --duration-1s: 1s;
  --duration-base: 0.15s;
  --duration-fast: 0.1s;
  --editor-content-padding: 36px;
  --editor-font-size-mono: 15.3px;
  --editor-line-height-px: 32.4px;
  --emphasis-color: rgb(91, 4, 17);
  --error-bg: #ffebe9;
  --error-color: #cf222e;
  --font-mono: ui-monospace, monospace;
  --font-sans: system-ui, -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  --font-ui: system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  --font-size-base: 13px;
  --font-size-sm: 12px;
  --font-size-xs: 11px;
  --highlight-bg: #fff3a3;
  --highlight-text: inherit;
  --hover-bg: rgba(0, 0, 0, 0.06);
  --icon-size-sm: 24px;
  --target-min: 24px;
  --line-height-tight: 1.25;
  --line-height-normal: 1.5;
  --md-char-color: #777777;
  --meta-content-color: var(--md-char-color);
  --opacity-half-faded: 0.7;
  --opacity-muted: 0.5;
  --popup-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  --popup-shadow-dark: 0 4px 12px rgba(0, 0, 0, 0.4);
  --primary-color: var(--accent-primary);
  --radius-lg: 8px;
  --radius-md: 5px;
  --radius-pill: 100px;
  --radius-sm: 3px;
  --selection-color: rgba(0, 102, 204, 0.2);
  --space-1: 4px;
  --space-1-5: 6px;
  --space-10: 40px;
  --space-15: 60px;
  --space-2: 8px;
  --space-2-5: 10px;
  --space-3: 12px;
  --space-half: 2px;
  --strong-color: rgb(63, 86, 99);
  --subtle-bg: rgba(0, 0, 0, 0.03);
  --subtle-bg-hover: rgba(0, 0, 0, 0.04);
  --success-color: #16a34a;
  --success-color-dark: #4ade80;
  --table-border-color: var(--border-color);
  --text-color: #1a1a1a;
  --quote-text: var(--text-secondary);
  --syntax-keyword: #b3303d;
  --syntax-type: #6f42c1;
  --syntax-function: #6f42c1;
  --syntax-property: #005cc5;
  --syntax-variable: #1a1a1a;
  --syntax-string: #032f62;
  --syntax-number: #005cc5;
  --syntax-operator: #b3303d;
  --syntax-punctuation: #1a1a1a;
  --syntax-comment: #5b626b;
  --syntax-escape: #005cc5;
  --syntax-constant: #005cc5;
  --syntax-attribute: #6f42c1;
  --syntax-tag: #1d7031;
  --syntax-link: #032f62;
  --syntax-invalid: #bd212e;
  --text-secondary: #666666;
  --text-tertiary: #999999;
  --z-popup: 9999;
  --z-resize-handle: 10;
`;

/**
 * Extract the `:root` blocks from a stylesheet.
 *
 * Only bare `:root` — a themed override such as `.dark-theme` must not come
 * along, because the export forces light and the snapshot already carries the
 * resolved colours. Used by the gate to read index.css; kept exported so the
 * test and the shipped values are derived the same way.
 */
export function extractRootBlocks(css: string): string {
  const blocks: string[] = [];
  // Multiline anchor: :root must START a line, so `.dark-theme :root` does not
  // match, while an anchor of `^|}` would fail outright on a file that opens
  // with a comment — which index.css does.
  const re = /^[ \t]*:root\s*\{([^}]*)\}/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const body = m[1]?.trim();
    if (body) blocks.push(body);
  }
  return blocks.length > 0 ? `:root {\n${blocks.join("\n")}\n}` : "";
}

/** The primitive token definitions, as a `:root` rule ready to embed. */
export function getPrimitiveTokenCSS(): string {
  return `:root {${PRIMITIVES}}`;
}
