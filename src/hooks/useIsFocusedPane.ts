/**
 * useIsFocusedPane — whether the current pane owns the window's focus (#1081).
 *
 * Used by the editor surfaces to gate editorStore-singleton registration so a
 * split's unfocused pane doesn't clobber the toolbar/find target. With no split
 * open this is always true, so the single-pane editor behaves exactly as before.
 *
 * `useFocusedPaneState` adds a render-synced ref of the same flag for work that
 * runs AFTER commit — the editors' deferred mount/show focus. Only the focused
 * pane may take DOM focus: the split records DOM focus as the focused pane, so
 * a background pane focusing itself moves the pane focus (#1554).
 *
 * @coordinates-with stores/paneStore.ts — split focus
 * @coordinates-with contexts/PaneContext.tsx — the pane a subtree renders in
 * @module hooks/useIsFocusedPane
 */
import { useRef, type MutableRefObject } from "react";
import { usePaneContext } from "@/contexts/PaneContext";
import { usePaneStore } from "@/stores/paneStore";

export function useIsFocusedPane(windowLabel: string): boolean {
  const paneId = usePaneContext()?.paneId;
  return usePaneStore((state) => {
    const split = state.byWindow[windowLabel];
    return !split?.enabled || split.focusedPane === (paneId ?? "primary");
  });
}

export interface FocusedPaneState {
  isFocusedPane: boolean;
  /** Stable ref, synced every render — read it from timers and frames. */
  isFocusedPaneRef: MutableRefObject<boolean>;
}

export function useFocusedPaneState(windowLabel: string): FocusedPaneState {
  const isFocusedPane = useIsFocusedPane(windowLabel);
  const isFocusedPaneRef = useRef(isFocusedPane);
  /* eslint-disable-next-line react-hooks/refs -- render-synced so deferred focus reads the current focused pane before effects flush */
  isFocusedPaneRef.current = isFocusedPane;
  return { isFocusedPane, isFocusedPaneRef };
}
