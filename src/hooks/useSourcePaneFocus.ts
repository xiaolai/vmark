/**
 * useSourcePaneFocus — focused-pane gating for the Source editors (#1081).
 *
 * Returns a ref the creation effect reads to decide whether to register itself
 * as the active source view, and runs a reactive effect that re-registers when
 * split focus moves to this pane (the creation effect fires only once). No-op
 * in single-pane (always focused). Extracted from SourceEditor to keep it lean.
 *
 * Two editors use it (WI-LX2.4). The markdown `SourceEditor` registers with
 * the window's active tab and publishes the markdown cursor context. The
 * split-pane `SourcePane` (yaml, json, toml, …) used to register NOTHING, so
 * every reader of `editorStore.active.activeSourceView` — the workflow
 * diagnostics banner's line jump, `JobNode`'s Escape, undo in source mode, the
 * IME guard — found no view, or a stale one from another document. It now
 * registers under its OWN tab (`options.tabId`) and skips the cursor context,
 * which is markdown-only (`options.cursorContext: false`) — and DROPS any
 * markdown context another pane published, so the toolbar and context menu
 * (which act on `source.editorView`) cannot format that pane's document while
 * this one is focused.
 *
 * The registration lasts only while the pane is focused and visible:
 * focus moving to a pane with no source editor — a preview, a
 * media viewer, a WYSIWYG pane — forgets this view by identity, as the Tiptap
 * registration does, instead of leaving lint, IME and selection readers
 * aimed at a document the user left.
 *
 * @coordinates-with stores/editorStore.ts — active source view + context
 * @coordinates-with hooks/useIsFocusedPane.ts — focus resolution
 * @coordinates-with components/Editor/SplitPaneEditor/SourcePane.tsx — `bindSplitSourceView`
 * @module hooks/useSourcePaneFocus
 */
import { useEffect, type MutableRefObject } from "react";
import type { EditorView } from "@codemirror/view";
import { useFocusedPaneState } from "@/hooks/useIsFocusedPane";
import { useEditorStore } from "@/stores/editorStore";
import { useTabStore } from "@/stores/tabStore";
import { computeSourceCursorContext } from "@/plugins/sourceContextDetection/cursorContext";

export interface SourcePaneFocusOptions {
  /** Register under this tab rather than the window's active tab. */
  tabId?: string;
  /** Publish the markdown cursor context (default true — markdown only). */
  cursorContext?: boolean;
}

export function useSourcePaneFocus(
  viewRef: MutableRefObject<EditorView | null>,
  windowLabel: string,
  hidden: boolean,
  options: SourcePaneFocusOptions = {},
): MutableRefObject<boolean> {
  const { isFocusedPane, isFocusedPaneRef } = useFocusedPaneState(windowLabel);
  const { tabId: ownTabId, cursorContext = true } = options;

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (hidden || !isFocusedPane) {
      // By identity, not by undoing this effect's own registration: the view
      // may have been registered by its creation effect (the first run here
      // saw no view), and the pane that took focus may already own the slot.
      useEditorStore.getState().clearSourceViewIfMatch(view);
      return;
    }
    const tabId = ownTabId ?? useTabStore.getState().activeTabId[windowLabel] ?? undefined;
    activateSourceView(view, tabId, cursorContext);
  }, [isFocusedPane, hidden, windowLabel, viewRef, ownTabId, cursorContext]);

  return isFocusedPaneRef;
}

/** Publish `view` as the active source view — with its markdown cursor
 *  context, or (non-markdown) with the previous pane's context dropped. */
function activateSourceView(view: EditorView, tabId: string | undefined, cursorContext: boolean): void {
  const store = useEditorStore.getState();
  store.setActiveSourceView(view, tabId);
  if (cursorContext) store.setSourceContext(computeSourceCursorContext(view), view);
  else if (store.source.editorView !== null) store.clearSourceContext();
}

/**
 * The creation-time half for a split-pane source view: register `view` now if
 * its pane is focused, and return the release its teardown must call. The
 * release forgets `view` only if it is still the registered one — another
 * pane may have taken over meanwhile.
 */
export function bindSplitSourceView(view: EditorView, tabId: string, focused: boolean): () => void {
  if (focused) activateSourceView(view, tabId, false);
  return () => useEditorStore.getState().clearSourceViewIfMatch(view);
}
