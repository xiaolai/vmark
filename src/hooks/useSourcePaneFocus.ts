/**
 * useSourcePaneFocus — focused-pane gating for the Source editor (#1081).
 *
 * Returns a ref the creation effect reads to decide whether to register itself
 * as the active source view, and runs a reactive effect that re-registers when
 * split focus moves to this pane (the creation effect fires only once). No-op
 * in single-pane (always focused). Extracted from SourceEditor to keep it lean.
 *
 * @coordinates-with stores/editorStore.ts — active source view + context
 * @coordinates-with hooks/useIsFocusedPane.ts — focus resolution
 * @module hooks/useSourcePaneFocus
 */
import { useEffect, useRef, type MutableRefObject } from "react";
import type { EditorView } from "@codemirror/view";
import { useIsFocusedPane } from "@/hooks/useIsFocusedPane";
import { useEditorStore } from "@/stores/editorStore";
import { useTabStore } from "@/stores/tabStore";
import { computeSourceCursorContext } from "@/plugins/sourceContextDetection/cursorContext";

export function useSourcePaneFocus(
  viewRef: MutableRefObject<EditorView | null>,
  windowLabel: string,
  hidden: boolean,
): MutableRefObject<boolean> {
  const isFocusedPane = useIsFocusedPane(windowLabel);
  const ref = useRef(true);
  /* eslint-disable-next-line react-hooks/refs */
  ref.current = isFocusedPane;

  useEffect(() => {
    if (hidden || !isFocusedPane) return;
    const view = viewRef.current;
    if (!view) return;
    const tabId = useTabStore.getState().activeTabId[windowLabel] ?? undefined;
    useEditorStore.getState().setActiveSourceView(view, tabId);
    useEditorStore.getState().setSourceContext(computeSourceCursorContext(view), view);
  }, [isFocusedPane, hidden, windowLabel, viewRef]);

  return ref;
}
