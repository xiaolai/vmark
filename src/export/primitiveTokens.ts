/**
 * Primitive Design Tokens for Export
 *
 * Purpose: the exported HTML embeds a SNAPSHOT of the theme (`themeSnapshot.ts`,
 * 79 semantic variables read off the live document). The editor's CSS also
 * consumes ~26 PRIMITIVE tokens — `--border-thin`, `--space-*`, `--font-size-*`,
 * `--duration-*`, `--radius-pill`, `--z-*` — which live only in
 * `src/styles/index.css` and are in no snapshot.
 *
 * A `var()` that resolves to nothing makes the WHOLE declaration invalid at
 * computed-value time. It does not fall back to an initial value and it does not
 * warn. So `border: var(--border-thin) solid var(--table-border-color)` — the
 * rule that draws every table border in `editor.css` — produced NO border at all
 * in exported PDFs, and the same silent deletion hit code-block padding, task
 * checkboxes, details headers and alert borders.
 *
 * This module ships those definitions with the export. It reads them out of
 * `index.css` rather than restating them, so a primitive added there is covered
 * without touching this file — restating them is exactly how the snapshot came
 * to be missing 26 of them.
 *
 * Emitted BEFORE the theme snapshot, mirroring the app's own layering: the
 * stylesheet provides statics, then `useTheme` writes the dynamic values as
 * inline styles that win.
 *
 * @module export/primitiveTokens
 * @coordinates-with themeSnapshot.ts — the semantic half of the same problem
 * @coordinates-with styles/index.css — the source of these definitions
 */

import indexCSS from "@/styles/index.css?raw";

/**
 * Extract the `:root` blocks from a stylesheet.
 *
 * Only bare `:root` — a themed override such as `.dark-theme` must not come
 * along, because the export forces light and the snapshot already carries the
 * resolved colours.
 */
export function extractRootBlocks(css: string): string {
  const blocks: string[] = [];
  // Multiline anchor: :root must START a line. `.dark-theme :root` therefore
  // does not match, while an ordinary stylesheet does — an anchor of `^|}` fails
  // outright when the file opens with a comment, which index.css does.
  const re = /^[ \t]*:root\s*\{([^}]*)\}/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const body = m[1]?.trim();
    if (body) blocks.push(body);
  }
  return blocks.length > 0 ? `:root {\n${blocks.join("\n")}\n}` : "";
}

let cached: string | null = null;

/** The primitive token definitions, as a `:root` rule ready to embed. */
export function getPrimitiveTokenCSS(): string {
  cached ??= extractRootBlocks(indexCSS);
  return cached;
}
