/**
 * Shared editor-action dispatch — the toolbar / context-menu entry point.
 *
 * Purpose: "resolve surface → dispatch to the right adapter" previously lived
 * inline in `UniversalToolbar.handleAction`; the editor context menu needs the
 * identical behavior. Extracted here so both call one helper (plan ADR-2).
 *
 * This is a thin adapter-vocabulary layer over the SAME guarded mechanics the
 * ActionId executor (`runEditorAction`) uses: origin capture (tab + surface),
 * tab-ownership validation, IME-safe dispatch with deferred re-validation,
 * read-only enforcement at the mutation boundary, and tab-bound retry. There
 * is exactly ONE mutation path — a toolbar click and a palette command cannot
 * drift apart, and a stale context-menu action can no longer mutate whichever
 * document became current (it is dropped when its origin is gone).
 *
 * The surface is explicit — callers know which editing surface they act
 * on (the context-menu triggers fire from a concrete surface; the toolbar
 * resolves it via `selectSourceEditing`). This also makes forced-source
 * large-file tabs unambiguous: their triggers pass "source". If the surface
 * flips between capture and execution, the origin check refuses the dispatch.
 *
 * @coordinates-with services/editor/editorActionDispatch.ts — the guarded mechanics
 * @coordinates-with UniversalToolbar.tsx — toolbar consumer
 * @coordinates-with components/Editor/EditorContextMenu — menu consumer
 * @module plugins/toolbarActions/dispatch
 */

import { hostEditors } from "@/plugins/shared/hostEditors";
import {
  captureOrigin,
  dispatchAdapterToSource,
  dispatchAdapterToWysiwyg,
  dispatchWithRetry,
} from "@/services/editor/editorActionDispatch";
import { getEditorActionOwner } from "@/services/editor/editorActionOwner";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { isAdapterAction } from "./adapterActions";
import {
  getSourceMultiSelectionContext,
  getWysiwygMultiSelectionContext,
} from "./multiSelectionContext";
import type { SourceToolbarContext, WysiwygToolbarContext } from "./types";

export type EditorDispatchSurface = "wysiwyg" | "source";

/** Build a source ToolbarContext from the live editorStore state.
 *  Exported for the context-menu snapshot provider (context READING only —
 *  dispatch goes through the guarded mechanics below). */
export function buildSourceContext(): SourceToolbarContext {
  const state = hostEditors.source() as ReturnType<typeof hostEditors.source> & {
    editorView: SourceToolbarContext["view"];
    context: SourceToolbarContext["context"];
  };
  return {
    surface: "source",
    view: state.editorView,
    context: state.context,
    multiSelection: getSourceMultiSelectionContext(state.editorView, state.context),
  };
}

/** Build a WYSIWYG ToolbarContext from the live editorStore state. */
export function buildWysiwygContext(): WysiwygToolbarContext {
  const state = hostEditors.wysiwyg() as ReturnType<typeof hostEditors.wysiwyg> & {
    editorView: WysiwygToolbarContext["view"];
    editor: WysiwygToolbarContext["editor"];
    context: WysiwygToolbarContext["context"];
  };
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
 * "insertBlockquote", …) for `surface` through the executor's guarded
 * mechanics. Returns whether the action was accepted for dispatch (run,
 * IME-queued, or awaiting the mount retry); false for unknown action ids.
 */
export function dispatchEditorAction(action: string, surface: EditorDispatchSurface): boolean {
  // Boundary guard (WI-4): consumers are typed against AdapterAction, but
  // this entry still takes `string` for callers outside the typed surface —
  // an unknown id is refused here instead of silently falling through the
  // adapter switches.
  if (!isAdapterAction(action)) return false;

  const windowLabel = getCurrentWindowLabel();
  const origin = captureOrigin(windowLabel, surface === "source");
  const owner = getEditorActionOwner(windowLabel);
  const dispatch = () =>
    surface === "source"
      ? dispatchAdapterToSource(action, origin, owner)
      : dispatchAdapterToWysiwyg(action, origin, owner);
  dispatchWithRetry(`${action} (${surface})`, origin, owner, dispatch);
  return true;
}
