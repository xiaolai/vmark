/**
 * Editor action dispatch mechanics
 *
 * Purpose: the surface-dispatch layer beneath `runEditorAction`. Owns the
 *   action ORIGIN (tab + effective surface captured before the first dispatch),
 *   the two per-surface dispatchers (WYSIWYG / Source), the tab-bound retry for a
 *   not-yet-mounted editor, and the IME-safe unified-history path. Every dispatch
 *   re-validates the origin at its mutation boundary — each retry AND the
 *   IME-queued callback (run later on `compositionend`) — so an action can never
 *   mutate a stale, hidden, torn-down, wrong-tab, or read-only editor.
 *
 * `runEditorAction` (the gate + router) is the only caller; these are its
 *   internals, split out to keep each file focused (and under the size gate).
 *
 * @coordinates-with runEditorAction.ts — the gate + router that calls these
 * @coordinates-with editorActionGates.ts — effective-surface + adapter-name map
 * @coordinates-with editorActionOwner.ts — the per-window retry owner
 * @coordinates-with wysiwygAdapter.ts / sourceAdapter.ts — execute the action
 * @coordinates-with services/history/unifiedHistory.ts — cross-mode undo/redo
 * @module services/editor/editorActionDispatch
 */

import { useTabStore } from "@/stores/tabStore";
import { useEditorStore } from "@/stores/editorStore";
import { getHeadingLevelFromParams } from "@/plugins/actions/actionRegistry";
import type { ActionId } from "@/plugins/actions/types";
import {
  performSourceToolbarAction,
  setSourceHeadingLevel,
} from "@/plugins/toolbarActions/sourceAdapter";
import {
  performWysiwygToolbarAction,
  setWysiwygHeadingLevel,
} from "@/plugins/toolbarActions/wysiwygAdapter";
import {
  getSourceMultiSelectionContext,
  getWysiwygMultiSelectionContext,
} from "@/plugins/toolbarActions/multiSelectionContext";
import { performUnifiedUndo, performUnifiedRedo } from "@/services/history/unifiedHistory";
import {
  runOrQueueCodeMirrorAction,
  runOrQueueProseMirrorAction,
} from "@/utils/imeGuard";
import { menuDispatcherLog } from "@/utils/debug";
import { isEffectiveSourceMode, mapActionIdToAdapterAction } from "./editorActionGates";
import { getEditorActionOwner, type EditorActionOwner } from "./editorActionOwner";
import { isWindowReadOnly } from "@/services/commands/commandContext";
import { mutatesDocument } from "@/services/commands/actionAvailability";

/** The tab + surface an action is bound to — captured when it is invoked. */
export interface EditorActionOrigin {
  windowLabel: string;
  tabId: string | null;
  sourceMode: boolean;
}

/** Capture the origin (tab + effective surface) BEFORE the first dispatch, so
 * retries and the IME-deferred callback can prove nothing shifted underneath. */
export function captureOrigin(windowLabel: string, sourceMode: boolean): EditorActionOrigin {
  const tabId = useTabStore.getState().activeTabId[windowLabel] ?? null;
  return { windowLabel, tabId, sourceMode };
}

/**
 * True while the action's origin is still valid to execute: the same tab is
 * active AND the effective editing surface has not flipped. A same-tab mode
 * toggle during the retry/IME window must not dispatch to the surface that was
 * selected when the event fired (the retry path keeps the original surface).
 */
function isOriginValid(origin: EditorActionOrigin): boolean {
  const tabId = useTabStore.getState().activeTabId[origin.windowLabel] ?? null;
  return tabId === origin.tabId && isEffectiveSourceMode(origin.windowLabel) === origin.sourceMode;
}

/** Maximum retries when the editor is not yet mounted. */
const MAX_EDITOR_RETRIES = 3;

/**
 * Dispatch to the WYSIWYG editor. Returns true if the editor was available and
 * the action was run/queued. The action runs behind the ProseMirror IME guard;
 * when composing it is queued and executed later on `compositionend`, so
 * ownership is re-validated inside the deferred callback.
 */
export function dispatchToWysiwyg(
  actionId: ActionId,
  params: Record<string, unknown> | undefined,
  origin: EditorActionOrigin,
  owner: EditorActionOwner,
): boolean {
  const active = useEditorStore.getState().active;
  const editor = active.activeWysiwygEditor;
  // The globally-active editor must belong to the ORIGIN tab. During a tab
  // switch `activeTabId` can already point at the new tab while `activeWysiwygEditor`
  // still references the old tab's editor; dispatching then would mutate the wrong
  // document. Treat that as "not available yet" so the retry waits for the new
  // tab's editor to mount (audit-fix #1).
  if (!editor || active.activeWysiwygTabId !== origin.tabId) return false;

  const view = editor.view;
  if (!view) {
    menuDispatcherLog(`WYSIWYG editor view not available for ${actionId}`);
    return false;
  }

  runOrQueueProseMirrorAction(view, () => {
    // Re-validate at the mutation boundary: an IME-deferred action runs later
    // (on compositionend), by when the window may have torn down (owner
    // disposed), the user may have switched tabs, or the editor may have
    // remounted for the same tab — any of which makes `editor`/`view` stale.
    if (
      owner.isDisposed() ||
      !isOriginValid(origin) ||
      useEditorStore.getState().active.activeWysiwygEditor !== editor ||
      (mutatesDocument(actionId) && isWindowReadOnly(origin.windowLabel))
    ) {
      menuDispatcherLog(`${actionId} dropped — origin no longer valid at deferred dispatch`);
      return;
    }
    // Build the multi-selection context from the CURRENT view state, inside the
    // callback: an IME-deferred action runs after compositionend, which can change
    // the selection — a snapshot taken before the queue would gate on stale state
    // (audit-fix #2).
    const multiSelection = getWysiwygMultiSelectionContext(view, null);
    const context = { surface: "wysiwyg", view, editor, context: null, multiSelection } as const;
    if (actionId === "setHeading") {
      setWysiwygHeadingLevel(context, getHeadingLevelFromParams(params));
      return;
    }
    if (actionId === "paragraph") {
      setWysiwygHeadingLevel(context, 0);
      return;
    }
    performWysiwygToolbarAction(mapActionIdToAdapterAction(actionId), context);
  });

  return true;
}

/**
 * Dispatch to the Source (CodeMirror) editor. Returns true if the view was
 * available and the action was run/queued. Ownership is re-validated inside the
 * IME-deferred callback, as for WYSIWYG.
 */
export function dispatchToSource(
  actionId: ActionId,
  params: Record<string, unknown> | undefined,
  origin: EditorActionOrigin,
  owner: EditorActionOwner,
): boolean {
  const active = useEditorStore.getState().active;
  const view = active.activeSourceView;
  // The globally-active Source view must belong to the ORIGIN tab — see
  // dispatchToWysiwyg: guards the same tab-switch race for CodeMirror (audit-fix #1).
  if (!view || active.activeSourceTabId !== origin.tabId) return false;

  runOrQueueCodeMirrorAction(view, () => {
    // See dispatchToWysiwyg: same deferred-boundary re-validation for the
    // Source (CodeMirror) surface — owner alive, same tab, same view instance.
    if (
      owner.isDisposed() ||
      !isOriginValid(origin) ||
      useEditorStore.getState().active.activeSourceView !== view ||
      (mutatesDocument(actionId) && isWindowReadOnly(origin.windowLabel))
    ) {
      menuDispatcherLog(`${actionId} dropped — origin no longer valid at deferred dispatch`);
      return;
    }
    // Read the cursor context and build the multi-selection context from CURRENT
    // state, inside the callback: an IME-deferred action runs after compositionend,
    // which can move the cursor/selection — a snapshot taken before the queue would
    // gate on stale state (audit-fix #2).
    const cursorContext = useEditorStore.getState().source.context;
    const multiSelection = getSourceMultiSelectionContext(view, cursorContext);
    const context = { surface: "source", view, context: cursorContext, multiSelection } as const;
    if (actionId === "setHeading") {
      setSourceHeadingLevel(context, getHeadingLevelFromParams(params));
      return;
    }
    if (actionId === "paragraph") {
      setSourceHeadingLevel(context, 0);
      return;
    }
    performSourceToolbarAction(mapActionIdToAdapterAction(actionId), context);
  });

  return true;
}

/**
 * Run `dispatch` now; if the editor is not mounted yet (tab switch, first
 * mount), retry a few times. A retry belongs to the origin tab: if the user
 * switches tabs inside the retry window the action is dropped, and retries are
 * scheduled through the per-window owner so disposal cancels them.
 */
export function dispatchWithRetry(
  label: string,
  origin: EditorActionOrigin,
  owner: EditorActionOwner,
  dispatch: () => boolean,
): void {
  if (dispatch()) return;

  let retryCount = 0;
  const retry = () => {
    retryCount++;
    if (!isOriginValid(origin)) {
      menuDispatcherLog(`${label} dropped — active tab changed during retry`);
      return;
    }
    if (dispatch()) {
      menuDispatcherLog(`${label} succeeded after ${retryCount} retry(ies)`);
      return;
    }
    if (retryCount < MAX_EDITOR_RETRIES) {
      owner.scheduleRetry(retry);
    } else {
      menuDispatcherLog(`${label} — editor not available after ${retryCount} retries`);
    }
  };

  owner.scheduleRetry(retry);
}

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
