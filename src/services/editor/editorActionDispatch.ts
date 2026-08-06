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
import {
  runOrQueueCodeMirrorAction,
  runOrQueueProseMirrorAction,
} from "@/utils/imeGuard";
import { menuDispatcherLog } from "@/utils/debug";
import { isEffectiveSourceMode, mapActionIdToAdapterAction } from "./editorActionGates";
import type { EditorActionOwner } from "./editorActionOwner";
import { isWindowReadOnly } from "@/services/commands/commandContext";
import { adapterActionMutates } from "@/services/commands/actionAvailability";
import type { AdapterAction } from "@/plugins/toolbarActions/adapterActions";

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
export function isOriginValid(origin: EditorActionOrigin): boolean {
  const tabId = useTabStore.getState().activeTabId[origin.windowLabel] ?? null;
  return tabId === origin.tabId && isEffectiveSourceMode(origin.windowLabel) === origin.sourceMode;
}

/** Maximum retries when the editor is not yet mounted. */
const MAX_EDITOR_RETRIES = 3;

/**
 * The adapter-vocabulary form of an ActionId invocation. Heading actions
 * carry their level in the adapter string (`heading:N`), which is what the
 * shared adapter dispatchers below execute.
 */
function adapterFormOf(actionId: ActionId, params: Record<string, unknown> | undefined): AdapterAction {
  if (actionId === "setHeading") return `heading:${getHeadingLevelFromParams(params)}` as AdapterAction;
  if (actionId === "paragraph") return "heading:0";
  return mapActionIdToAdapterAction(actionId);
}

/**
 * Dispatch one ADAPTER action ("bold", "heading:2", …) to the WYSIWYG editor
 * with the executor's full guard set. Returns true if the editor was
 * available and the action was run/queued. The action runs behind the
 * ProseMirror IME guard; when composing it is queued and executed later on
 * `compositionend`, so ownership is re-validated inside the deferred
 * callback. This is the ONE mutation path — the ActionId executor and the
 * toolbar/context-menu dispatcher both end here.
 */
export function dispatchAdapterToWysiwyg(
  action: AdapterAction,
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
    menuDispatcherLog(`WYSIWYG editor view not available for ${action}`);
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
      (adapterActionMutates(action) && isWindowReadOnly(origin.windowLabel))
    ) {
      menuDispatcherLog(`${action} dropped — origin no longer valid at deferred dispatch`);
      return;
    }
    // Build the multi-selection context from the CURRENT view state, inside the
    // callback: an IME-deferred action runs after compositionend, which can change
    // the selection — a snapshot taken before the queue would gate on stale state
    // (audit-fix #2).
    const multiSelection = getWysiwygMultiSelectionContext(view, null);
    const context = { surface: "wysiwyg", view, editor, context: null, multiSelection } as const;
    if (action.startsWith("heading:")) {
      setWysiwygHeadingLevel(context, Number(action.split(":")[1]));
      return;
    }
    performWysiwygToolbarAction(action, context);
  });

  return true;
}

/** ActionId layer over `dispatchAdapterToWysiwyg` (the executor's entry). */
export function dispatchToWysiwyg(
  actionId: ActionId,
  params: Record<string, unknown> | undefined,
  origin: EditorActionOrigin,
  owner: EditorActionOwner,
): boolean {
  return dispatchAdapterToWysiwyg(adapterFormOf(actionId, params), origin, owner);
}

/**
 * Dispatch one ADAPTER action to the Source (CodeMirror) editor with the
 * executor's full guard set — see `dispatchAdapterToWysiwyg`. Ownership is
 * re-validated inside the IME-deferred callback.
 */
export function dispatchAdapterToSource(
  action: AdapterAction,
  origin: EditorActionOrigin,
  owner: EditorActionOwner,
): boolean {
  const active = useEditorStore.getState().active;
  const view = active.activeSourceView;
  // The globally-active Source view must belong to the ORIGIN tab — see
  // dispatchAdapterToWysiwyg: guards the same tab-switch race for CodeMirror (audit-fix #1).
  if (!view || active.activeSourceTabId !== origin.tabId) return false;

  runOrQueueCodeMirrorAction(view, () => {
    // See dispatchAdapterToWysiwyg: same deferred-boundary re-validation for the
    // Source (CodeMirror) surface — owner alive, same tab, same view instance.
    if (
      owner.isDisposed() ||
      !isOriginValid(origin) ||
      useEditorStore.getState().active.activeSourceView !== view ||
      (adapterActionMutates(action) && isWindowReadOnly(origin.windowLabel))
    ) {
      menuDispatcherLog(`${action} dropped — origin no longer valid at deferred dispatch`);
      return;
    }
    // Read the cursor context and build the multi-selection context from CURRENT
    // state, inside the callback: an IME-deferred action runs after compositionend,
    // which can move the cursor/selection — a snapshot taken before the queue would
    // gate on stale state (audit-fix #2).
    const cursorContext = useEditorStore.getState().source.context;
    const multiSelection = getSourceMultiSelectionContext(view, cursorContext);
    const context = { surface: "source", view, context: cursorContext, multiSelection } as const;
    if (action.startsWith("heading:")) {
      setSourceHeadingLevel(context, Number(action.split(":")[1]));
      return;
    }
    performSourceToolbarAction(action, context);
  });

  return true;
}

/** ActionId layer over `dispatchAdapterToSource` (the executor's entry). */
export function dispatchToSource(
  actionId: ActionId,
  params: Record<string, unknown> | undefined,
  origin: EditorActionOrigin,
  owner: EditorActionOwner,
): boolean {
  return dispatchAdapterToSource(adapterFormOf(actionId, params), origin, owner);
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
