/**
 * selectSourceEditing — markdown is edited via the source surface when in
 * full Source mode OR in the Split view (where the editable pane is the
 * CodeMirror source). Formatting/menu/toolbar dispatch use this so split-view
 * actions target the source pane, not the read-only WYSIWYG preview.
 *
 * The split flag (`markdownSplitView`) is a global UI flag but only renders a
 * split for MARKDOWN tabs, so it must NOT report "source editing" when a
 * non-markdown tab (json/yaml/…) is active — otherwise universal edit/menu
 * actions would be misrouted (Codex audit). We therefore scope its
 * contribution to the active markdown tab.
 *
 * Structural param so it works both as a Zustand selector
 * (`useUIStore(selectSourceEditing)`) and imperatively
 * (`selectSourceEditing(useUIStore.getState())`). The tab lookup reads the
 * current store snapshot; callers re-render on tab switch, so it stays correct.
 *
 * @module stores/selectSourceEditing
 */
import { useTabStore } from "./tabStore";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";

/** The two mutually-exclusive editor-mode flags every selector here reads
 *  (structurally satisfied by `uiStore`'s state). */
export interface EditorModeFlags {
  sourceMode: boolean;
  markdownSplitView: boolean;
}

function activeTabIsMarkdown(): boolean {
  const ts = useTabStore.getState();
  const id = ts.activeTabId[getCurrentWindowLabel()];
  const t = id ? ts.findTabById?.(id) : null;
  return t?.kind === "document" ? t.formatId === "markdown" : false;
}

export function selectSourceEditing(s: EditorModeFlags): boolean {
  if (s.sourceMode) return true;
  // Split view only applies to markdown — don't treat other formats as source.
  return s.markdownSplitView && activeTabIsMarkdown();
}

/** The three mutually-exclusive editor modes. */
export type EditorMode = "wysiwyg" | "source" | "split";

/**
 * selectEditorMode — the canonical tri-state read-model derived from the two
 * exclusive UI flags. WYSIWYG is the implicit default (neither flag set).
 *
 * The View-menu state sync (#1070) consumes this so the active mode can be
 * reflected as a single checked item among WYSIWYG / Source / Split, instead
 * of inferring it from two independent-looking booleans. Pure — no store/tab
 * lookups; the flags are already kept mutually exclusive by their mutators in
 * uiStore, so `sourceMode` taking precedence here only matters defensively.
 */
export function selectEditorMode(s: EditorModeFlags): EditorMode {
  if (s.sourceMode) return "source";
  if (s.markdownSplitView) return "split";
  return "wysiwyg";
}

/** The View-menu state the native menu mirrors (#1070). */
export interface ViewMenuModeState {
  /** Which mode item is checked. */
  mode: EditorMode;
  /** The WYSIWYG/Source/Split trio applies (focused tab is markdown). */
  modeApplies: boolean;
  /** Word Wrap applies — a CodeMirror source surface is active. Disabled for
   *  markdown in WYSIWYG (the case #1070 reported) and when nothing is open. */
  wordWrapApplies: boolean;
  /** Line Numbers applies. Kept separate from Word Wrap: in markdown WYSIWYG
   *  the toggle still drives code-block gutters (relocation tracked in #1082),
   *  so it stays enabled there — only disabled when no tab is open. */
  lineNumbersApplies: boolean;
}

/** Focused-tab context for the View-menu policy. */
export interface ViewMenuTabContext {
  /** A tab is open/focused at all. */
  hasActiveTab: boolean;
  /** The focused tab is markdown. */
  isMarkdown: boolean;
  /** The focused markdown tab is force-opened in source (large-file session). */
  forcedSource: boolean;
}

/**
 * Pure policy mapping the editor flags + focused-tab context to the native
 * View menu's desired state. Leaf-pure so the menu-sync hook is a thin adapter
 * and the policy is unit-tested without Tauri.
 *
 * - Word Wrap is disabled ONLY for markdown in WYSIWYG (it drives CodeMirror
 *   only) and when nothing is open. Non-markdown tabs edit in CodeMirror, so it
 *   keeps applying there.
 * - Line Numbers stays enabled in WYSIWYG (still toggles code-block gutters
 *   until #1082 relocates that); disabled only when no tab is open.
 * - A large-file forced-source markdown tab reads as Source mode even though
 *   the global flags say WYSIWYG.
 */
export function selectViewMenuModeState(
  s: EditorModeFlags,
  ctx: ViewMenuTabContext,
): ViewMenuModeState {
  const mode: EditorMode = ctx.forcedSource ? "source" : selectEditorMode(s);
  const sourceSurfaceActive = ctx.hasActiveTab && (ctx.isMarkdown ? mode !== "wysiwyg" : true);
  return {
    mode,
    modeApplies: ctx.hasActiveTab && ctx.isMarkdown,
    wordWrapApplies: sourceSurfaceActive,
    lineNumbersApplies: ctx.hasActiveTab,
  };
}
