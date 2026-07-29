/**
 * IME-safe cross-mode unified history dispatch (split from
 * editorActionDispatch.ts for the file-size rule).
 *
 * @coordinates-with editorActionDispatch.ts — shares origin capture/validation
 * @coordinates-with services/history/unifiedHistory.ts — the history ops
 * @module services/editor/unifiedHistoryDispatch
 */

import { useEditorStore } from "@/stores/editorStore";
import { performUnifiedUndo, performUnifiedRedo } from "@/services/history/unifiedHistory";
import {
  runOrQueueCodeMirrorAction,
  runOrQueueProseMirrorAction,
} from "@/utils/imeGuard";
import { menuDispatcherLog } from "@/utils/debug";
import { isWindowReadOnly } from "@/services/commands/commandContext";
import { getEditorActionOwner } from "./editorActionOwner";
import { captureOrigin, isOriginValid } from "./editorActionDispatch";

/**
 * Run cross-mode undo/redo behind the active surface's IME guard. When the
 * surface is composing the call is queued and runs on `compositionend`; at that
 * (possibly deferred) boundary the origin is re-validated — owner alive, same
 * tab + surface, same active view, and not read-only — exactly as the editor
 * dispatchers do, so a deferred history op can't fire against a stale, hidden,
 * torn-down, or read-only editor. No editor-mount retry: unified history is
 * per-window and needs no tab-bound remount wait (audit-fix #3).
 */
export function runUnifiedHistoryImeSafe(
  actionId: "undo" | "redo",
  windowLabel: string,
  sourceMode: boolean,
): void {
  const origin = captureOrigin(windowLabel, sourceMode);
  const owner = getEditorActionOwner(windowLabel);
  const run = () =>
    actionId === "undo" ? performUnifiedUndo(windowLabel) : performUnifiedRedo(windowLabel);

  const active = useEditorStore.getState().active;
  if (sourceMode) {
    const view = active.activeSourceView;
    if (!view || active.activeSourceTabId !== origin.tabId) {
      run();
      return;
    }
    runOrQueueCodeMirrorAction(view, () => {
      if (
        owner.isDisposed() ||
        !isOriginValid(origin) ||
        useEditorStore.getState().active.activeSourceView !== view ||
        isWindowReadOnly(origin.windowLabel)
      ) {
        menuDispatcherLog(`${actionId} dropped — origin no longer valid at deferred dispatch`);
        return;
      }
      run();
    });
    return;
  }

  const editor = active.activeWysiwygEditor;
  const view = editor?.view;
  if (!editor || !view || active.activeWysiwygTabId !== origin.tabId) {
    run();
    return;
  }
  runOrQueueProseMirrorAction(view, () => {
    if (
      owner.isDisposed() ||
      !isOriginValid(origin) ||
      useEditorStore.getState().active.activeWysiwygEditor !== editor ||
      isWindowReadOnly(origin.windowLabel)
    ) {
      menuDispatcherLog(`${actionId} dropped — origin no longer valid at deferred dispatch`);
      return;
    }
    run();
  });
}
