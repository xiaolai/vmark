/**
 * Editor context-menu shared types.
 *
 * Purpose: `EditorContextMenuSnapshot` is the normalized, serializable
 * contract between the per-surface trigger providers (the Tiptap plugin
 * and the CodeMirror extension capture editor state at right-click time)
 * and the pure menu-model builder
 * (`components/Editor/EditorContextMenu/menuModel.ts`). Fixing this shape
 * here lets the builder be tested against every context before the
 * providers exist, and keeps the popup-store slice free of editor-type
 * imports.
 *
 * Plan: dev-docs/plans/20260709-editor-context-menu.md (ADR-6).
 *
 * @module types/editorContextMenu
 */

/** Which editing surface produced the snapshot (and receives dispatches). */
export type EditorMenuSurface = "wysiwyg" | "source";

/**
 * Per-format menu-policy bits, precomputed by the provider from the active
 * format's `adapters.menuPolicy` (markdown sets both true; restricted
 * formats like JSON set them false, reducing the menu to clipboard items).
 */
export interface EditorMenuFormatPolicy {
  paragraphFormatting: boolean;
  insertBlockActions: boolean;
}

/** Link state at the click position. `href: null` = on a link whose target
 *  could not be resolved (source-mode reference links before parsing).
 *  `from`/`to` are the link's document range when the surface can provide
 *  it (WYSIWYG mark range) — required by Edit Link to anchor the popup. */
interface EditorMenuLinkState {
  href: string | null;
  from?: number;
  to?: number;
}

/**
 * Normalized editor state at the moment of right-click. All fields are
 * plain data — the builder must stay pure and never touch editor objects.
 */
export interface EditorContextMenuSnapshot {
  surface: EditorMenuSurface;
  /** True when the selection is a caret (Cut/Copy disable). */
  selectionEmpty: boolean;
  /** True inside a code block (formatting sections hide). */
  inCodeBlock: boolean;
  /** Current heading level at the cursor, or null in a non-heading block. */
  headingLevel: number | null;
  /** Current list type at the cursor, or null outside lists. */
  listType: "bullet" | "ordered" | "task" | null;
  /** True inside a blockquote (item shows checked). */
  inBlockquote: boolean;
  /** Non-null when the click position is on a link. */
  link: EditorMenuLinkState | null;
  formatPolicy: EditorMenuFormatPolicy;
  /** Adapter-action strings currently active at the cursor (checkmarks). */
  activeActions: readonly string[];
  /** Adapter-action strings currently disabled by the enable rules
   *  (context mismatch, multi-selection policy, link restrictions). */
  disabledActions: readonly string[];
}
