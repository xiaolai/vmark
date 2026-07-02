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
];

/**
 * Patterns for CSS rule blocks that are editor-interactive-only
 * and should be stripped from export output.
 * Matched against selectors — if a selector starts with any of these,
 * the rule is excluded.
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
 * Strip interactive-only CSS rules from raw CSS text.
 * Uses a simple state machine to parse rule blocks and filter by selector.
 */
function stripInteractiveRules(css: string): string {
  const lines = css.split("\n");
  const output: string[] = [];
  let depth = 0;
  let skipBlock = false;
  let currentSelector = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip @import statements (already resolved by Vite for normal loads)
    if (trimmed.startsWith("@import")) continue;

    // Track nesting depth
    const opens = (line.match(/{/g) || []).length;
    const closes = (line.match(/}/g) || []).length;

    if (depth === 0 && opens > 0) {
      // Starting a new top-level rule block
      currentSelector = trimmed.replace(/\s*\{.*$/, "");

      // Check if this selector should be excluded
      skipBlock = isInteractiveSelector(currentSelector);

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
      currentSelector = "";
    }
  }

  return output.join("\n");
}

/**
 * Check if a CSS selector targets interactive-only elements.
 */
function isInteractiveSelector(selector: string): boolean {
  // Check against prefix list
  for (const prefix of INTERACTIVE_SELECTOR_PREFIXES) {
    if (selector.includes(prefix)) return true;
  }

  // Skip :hover and :focus-visible rules (non-interactive in export)
  if (selector.includes(":hover") || selector.includes(":focus-visible")) {
    return true;
  }

  return false;
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
