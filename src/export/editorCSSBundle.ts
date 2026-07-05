/**
 * Editor CSS Bundle — Single Source of Truth for Export
 *
 * Imports the actual editor and plugin CSS files via Vite ?raw imports,
 * so the exported PDF uses the exact same styles as the WYSIWYG editor.
 * This eliminates style drift between editor and export.
 *
 * Content-relevant CSS files are imported here. Interactive-only CSS
 * (popups, resize handles, drag/drop, search, AI suggestions, etc.)
 * is intentionally excluded — non-matching selectors are harmless but
 * we keep the bundle lean.
 *
 * @module export/editorCSSBundle
 * @coordinates-with components/Editor/editor.css — main editor styles
 * @coordinates-with plugins/ — plugin-specific content styles
 * @coordinates-with htmlExportStyles.ts — composes this bundle with export overrides
 */

// --- Editor base styles ---
import editorCSS from "@/components/Editor/editor.css?raw";

// --- Plugin content styles ---
import alertBlockCSS from "@/plugins/alertBlock/alert-block.css?raw";
import detailsBlockCSS from "@/plugins/detailsBlock/details-block.css?raw";
import highlightCSS from "@/plugins/highlight/highlight.css?raw";
import cjkSpacingCSS from "@/plugins/cjkLetterSpacing/cjk-letter-spacing.css?raw";
import subSuperCSS from "@/plugins/subSuperscript/sub-super.css?raw";
import underlineCSS from "@/plugins/underline/underline.css?raw";
import footnoteNodesCSS from "@/plugins/footnotePopup/footnote-nodes.css?raw";
import taskToggleCSS from "@/plugins/taskToggle/task-toggle.css?raw";
import codeBlockLineNumsCSS from "@/plugins/codeBlockLineNumbers/code-block-line-numbers.css?raw";
import hljsSyntaxCSS from "@/plugins/codeBlockLineNumbers/hljs-syntax.css?raw";
import blockImageCSS from "@/plugins/blockImage/block-image.css?raw";
import blockMediaSharedCSS from "@/styles/block-media-shared.css?raw";
import codePreviewCSS from "@/plugins/codePreview/code-preview.css?raw";
import markdownArtifactsCSS from "@/plugins/markdownArtifacts/markdown-artifacts.css?raw";
import latexCSS from "@/plugins/latex/latex.css?raw";
import katexFixesCSS from "@/styles/katexFixes.css?raw";
import mermaidCSS from "@/plugins/mermaid/mermaid.css?raw";
// Mermaid CSS uses @import for these — imports are stripped by our filter,
// so we include them explicitly to preserve the full style chain.
import mermaidFallbackCSS from "@/plugins/mermaid/mermaid-fallback.css?raw";
import graphvizCSS from "@/plugins/graphviz/graphviz.css?raw";

/**
 * All content-relevant CSS files in import order.
 * Order matters: later rules can override earlier ones.
 */
const CSS_MODULES = [
  // Base editor styles (headings, lists, code, tables, blockquotes, images, marks)
  editorCSS,
  // Shared block media
  blockMediaSharedCSS,
  // Plugin styles
  alertBlockCSS,
  detailsBlockCSS,
  highlightCSS,
  cjkSpacingCSS,
  subSuperCSS,
  underlineCSS,
  footnoteNodesCSS,
  taskToggleCSS,
  codeBlockLineNumsCSS,
  hljsSyntaxCSS,
  blockImageCSS,
  codePreviewCSS,
  markdownArtifactsCSS,
  latexCSS,
  katexFixesCSS,
  mermaidFallbackCSS,
  mermaidCSS,
  graphvizCSS,
];

/**
 * Patterns for CSS rule blocks that are editor-interactive-only
 * and should be stripped from export output.
 * Matched against selectors — if a token appears anywhere in a selector at
 * a class-name boundary (see `isInteractiveSelector`), the rule is excluded.
 */
const INTERACTIVE_SELECTOR_PREFIXES = [
  // Editor layout (not content)
  ".editor-container",
  ".editor-content",
  // Source mode (CodeMirror)
  ".source-editor",
  // ProseMirror interactive states
  ".ProseMirror-gapcursor",
  ".ProseMirror-selectednode",
  ".ProseMirror-focused",
  ".ProseMirror-hideselection",
  ".pm-selection-",
  // Note: .media-border-*, .media-align-*, .heading-align- classes are NOT
  // stripped — they control content layout and carry over to the export
  // wrapper. (.table-fit-to-width is ephemeral, markdown-less editor state that
  // never survives the fresh export re-render; tables are instead fitted to the
  // page unconditionally by the export table CSS — see exportOverrides.ts.)
  // Interactive plugin elements
  ".code-lang-dropdown",
  ".code-block-edit-",
  ".code-block-live-preview",
  ".code-block-editing",
  ".mermaid-preview-popup",
  ".mermaid-panzoom",
  // Math editing (not rendering)
  ".math-inline.editing",
  ".math-inline-input",
  ".math-inline-content",
  ".math-inline-placeholder",
  ".math-inline-loading",
  ".math-block.editing",
  ".math-block-editor",
  ".math-block-placeholder",
  // Interactive elements
  ".resize-handle",
  ".table-ui",
];

/**
 * Neutralize CSS block comments and string literals in one line so brace
 * counting and selector matching never see braces inside a comment or a
 * string value such as `content: "{"`.
 * Comment/string contents are replaced with spaces; structural characters
 * are preserved. Returns the sanitized line plus whether a block comment is
 * still open at end of line (CSS strings cannot legally span lines, so
 * string state never carries across lines).
 */
function sanitizeLine(
  line: string,
  startInComment: boolean,
): { sanitized: string; inComment: boolean } {
  let out = "";
  let inComment = startInComment;
  let quote: '"' | "'" | null = null;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (inComment) {
      if (ch === "*" && line[i + 1] === "/") {
        inComment = false;
        out += "  ";
        i += 2;
      } else {
        out += " ";
        i += 1;
      }
    } else if (quote) {
      if (ch === "\\") {
        out += "  "; // escape sequence — neutralize both characters
        i += 2;
      } else if (ch === quote) {
        quote = null;
        out += ch;
        i += 1;
      } else {
        out += " ";
        i += 1;
      }
    } else if (ch === "/" && line[i + 1] === "*") {
      inComment = true;
      out += "  ";
      i += 2;
    } else {
      if (ch === '"' || ch === "'") quote = ch;
      out += ch;
      i += 1;
    }
  }
  return { sanitized: out, inComment };
}

/**
 * Strip interactive-only CSS rules from raw CSS text.
 * Uses a simple state machine to parse rule blocks and filter by selector.
 * Depth tracking and selector extraction run over comment/string-neutralized
 * lines (see `sanitizeLine`) so braces inside comments or string values
 * cannot desync the block parser; output lines are always the raw originals.
 * Exported for direct unit testing (this is a hand-rolled parser on the
 * export path — see editorCSSBundle.test.ts for its behavioral contract).
 */
export function stripInteractiveRules(css: string): string {
  const lines = css.split("\n");
  const output: string[] = [];
  let depth = 0;
  let skipBlock = false;
  let inComment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const state = sanitizeLine(line, inComment);
    inComment = state.inComment;
    const sanitized = state.sanitized;
    const trimmed = sanitized.trim();

    // Skip @import statements (already resolved by Vite for normal loads)
    if (trimmed.startsWith("@import")) continue;

    // Track nesting depth
    const opens = (sanitized.match(/{/g) || []).length;
    const closes = (sanitized.match(/}/g) || []).length;

    if (depth === 0 && opens > 0) {
      // Starting a new top-level rule block
      const selector = trimmed.replace(/\s*\{.*$/, "");

      // Check if this selector should be excluded
      skipBlock = isInteractiveSelector(selector);

      // Also skip @keyframes
      if (trimmed.startsWith("@keyframes")) {
        skipBlock = true;
      }

      // Skip @media (prefers-reduced-motion)
      if (trimmed.includes("prefers-reduced-motion")) {
        skipBlock = true;
      }
    }

    depth += opens - closes;

    if (!skipBlock) {
      output.push(line);
    }

    if (depth <= 0) {
      depth = 0;
      skipBlock = false;
    }
  }

  return output.join("\n");
}

/**
 * True when `token` occurs in `selector` ending on a class-name boundary:
 * end of selector, or a character that cannot continue an identifier word.
 * A hyphen counts as same-family continuation (`.code-block-live-preview`
 * matches `.code-block-live-preview-error`), but a letter/digit does not
 * (`.editor-content` does NOT match `.editor-contents`). Tokens ending in
 * `-` are explicit family prefixes and match any continuation.
 */
function matchesAtClassBoundary(selector: string, token: string): boolean {
  if (token.endsWith("-")) return selector.includes(token);
  let from = 0;
  for (;;) {
    const idx = selector.indexOf(token, from);
    if (idx === -1) return false;
    const after = selector[idx + token.length];
    if (after === undefined || !/[A-Za-z0-9_]/.test(after)) return true;
    from = idx + 1;
  }
}

/**
 * Check if a CSS selector targets interactive-only elements.
 *
 * Matching contract (verified against the real ?raw CSS inputs):
 * - Tokens match ANYWHERE in the selector — descendant and compound
 *   positions are load-bearing (`.dark-theme .code-lang-dropdown`,
 *   `.math-inline.ProseMirror-selectednode`), not just prefixes.
 * - Matches must end on a class-name boundary so unrelated classes that
 *   merely contain a token as substring survive (see
 *   `matchesAtClassBoundary`).
 * - Comma groups are stripped whole when ANY member matches — the
 *   line-based parser cannot split a block.
 */
function isInteractiveSelector(selector: string): boolean {
  for (const token of INTERACTIVE_SELECTOR_PREFIXES) {
    if (matchesAtClassBoundary(selector, token)) return true;
  }

  // Strip :hover and :focus-visible rules (non-interactive in export)
  return (
    matchesAtClassBoundary(selector, ":hover") ||
    matchesAtClassBoundary(selector, ":focus-visible")
  );
}

/** Cached result — built once, reused across exports. */
let cachedBundle: string | null = null;

/**
 * Get the editor CSS bundle for export.
 *
 * Returns the actual editor + plugin CSS, stripped of interactive-only rules.
 * This is the single source of truth — any change to editor CSS automatically
 * flows to export output.
 */
export function getEditorCSSBundle(): string {
  if (cachedBundle) return cachedBundle;

  const raw = CSS_MODULES.join("\n\n");
  cachedBundle = stripInteractiveRules(raw);
  return cachedBundle;
}
