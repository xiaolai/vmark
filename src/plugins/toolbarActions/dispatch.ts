/**
 * Shared editor-action dispatch — the single mode-branching entry point.
 *
 * Purpose: "resolve surface → build ToolbarContext from editorStore →
 * call the right adapter" previously lived inline in
 * `UniversalToolbar.handleAction`; the editor context menu needs the
 * identical behavior. Extracted here so both call one helper and a third
 * dispatch copy never appears (plan ADR-2).
 *
 * The surface is explicit — callers know which editing surface they act
 * on (the context-menu triggers fire from a concrete surface; the toolbar
 * resolves it via `selectSourceEditing`). This also makes forced-source
 * large-file tabs unambiguous: their triggers pass "source".
 *
 * @coordinates-with UniversalToolbar.tsx — toolbar consumer
 * @coordinates-with components/Editor/EditorContextMenu — menu consumer
 * @module plugins/toolbarActions/dispatch
 */

import { useEditorStore } from "@/stores/editorStore";
import {
  getSourceMultiSelectionContext,
  getWysiwygMultiSelectionContext,
} from "./multiSelectionContext";
import { performSourceToolbarAction, setSourceHeadingLevel } from "./sourceAdapter";
import { performWysiwygToolbarAction, setWysiwygHeadingLevel } from "./wysiwygAdapter";
import type { SourceToolbarContext, WysiwygToolbarContext } from "./types";

export type EditorDispatchSurface = "wysiwyg" | "source";

/** Build a source ToolbarContext from the live editorStore state.
 *  Exported for the context-menu snapshot provider (same construction as
 *  dispatch — one source of truth for context building). */
export function buildSourceContext(): SourceToolbarContext {
  const state = useEditorStore.getState().source;
  return {
    surface: "source",
    view: state.editorView,
    context: state.context,
    multiSelection: getSourceMultiSelectionContext(state.editorView, state.context),
  };
}

/** Build a WYSIWYG ToolbarContext from the live editorStore state. */
export function buildWysiwygContext(): WysiwygToolbarContext {
  const state = useEditorStore.getState().tiptap;
  return {
    surface: "wysiwyg",
    view: state.editorView,
    editor: state.editor,
    context: state.context,
    multiSelection: getWysiwygMultiSelectionContext(state.editorView, state.context),
  };
}

/**
 * Dispatch a toolbar-vocabulary action ("bold", "heading:2",
 * "insertBlockquote", …) to the adapter for `surface`, building the
 * context from the current editorStore state. Returns the adapter's
 * result; false for malformed heading actions.
 */
export function dispatchEditorAction(action: string, surface: EditorDispatchSurface): boolean {
  if (action.startsWith("heading:")) {
    const level = Number(action.split(":")[1]);
    if (Number.isNaN(level)) return false;
    return surface === "source"
      ? setSourceHeadingLevel(buildSourceContext(), level)
      : setWysiwygHeadingLevel(buildWysiwygContext(), level);
  }

  return surface === "source"
    ? performSourceToolbarAction(action, buildSourceContext())
    : performWysiwygToolbarAction(action, buildWysiwygContext());
}
