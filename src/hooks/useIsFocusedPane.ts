/**
 * useIsFocusedPane — whether the current pane owns the window's focus (#1081).
 *
 * Used by the editor surfaces to gate editorStore-singleton registration so a
 * split's unfocused pane doesn't clobber the toolbar/find target. With no split
 * open this is always true, so the single-pane editor behaves exactly as before.
 *
 * @coordinates-with stores/paneStore.ts — split focus
 * @coordinates-with contexts/PaneContext.tsx — the pane a subtree renders in
 * @module hooks/useIsFocusedPane
 */
import { usePaneContext } from "@/contexts/PaneContext";
import { usePaneStore } from "@/stores/paneStore";

export function useIsFocusedPane(windowLabel: string): boolean {
  const paneId = usePaneContext()?.paneId;
  return usePaneStore((state) => {
    const split = state.byWindow[windowLabel];
    return !split?.enabled || split.focusedPane === (paneId ?? "primary");
  });
}
