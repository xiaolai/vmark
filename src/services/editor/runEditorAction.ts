/**
 * Editor action executor
 *
 * Purpose: the single semantic executor for editor actions. Both the native
 *   menu (`useUnifiedMenuCommands`) and — once the bridge lands — the Command
 *   Palette call `runEditorAction`, so an action runs IDENTICALLY regardless of
 *   invocation source: same effective-mode/target resolution, format +
 *   capability gates, unified cross-mode undo/redo, IME-safe dispatch, and
 *   tab-bound retry.
 *
 * NOT here (by design): the focus gate (`shouldBlockMenuAction`). It rejects
 *   focus inside the palette's own `.quick-open` container, so pulling it into
 *   the executor would make the palette block its own commands. It stays at the
 *   native-menu boundary; the executor is invocation-source agnostic.
 *   (ADR-017 / command-registry WI-1.2.)
 *
 * Ownership: an event is bound to the tab that was active when it fired. The
 *   origin tab is captured BEFORE the first dispatch and re-validated at every
 *   deferred boundary — each retry AND the IME-queued callback (which runs
 *   later, on `compositionend`) — so a queued or retried action can never mutate
 *   a document the user has since switched away from.
 *
 * @coordinates-with editorActionGates.ts — format/capability/mode resolution
 * @coordinates-with editorActionOwner.ts — the per-window retry owner
 * @coordinates-with wysiwygAdapter.ts / sourceAdapter.ts — execute the action
 * @coordinates-with services/history/unifiedHistory.ts — cross-mode undo/redo
 * @module services/editor/runEditorAction
 */

import { useTabStore } from "@/stores/tabStore";
import { useEditorStore } from "@/stores/editorStore";
import { ACTION_DEFINITIONS, getHeadingLevelFromParams } from "@/plugins/actions/actionRegistry";
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
import { menuDispatcherLog, menuDispatcherWarn } from "@/utils/debug";
import {
  isActionAllowedForActiveFormat,
  isEffectiveSourceMode,
  mapActionIdToAdapterAction,
} from "./editorActionGates";
import { getEditorActionOwner, type EditorActionOwner } from "./editorActionOwner";

/** Options for a single `runEditorAction` invocation. */
export interface RunEditorActionOptions {
  /** The webview window the action targets (retry + ownership are per-window). */
  windowLabel: string;
  /** Parameterized-action payload, e.g. `{ level }` for `setHeading`. */
  params?: Record<string, unknown>;
}

/** The tab an action is bound to — captured when the action is invoked. */
interface EditorActionOrigin {
  windowLabel: string;
  tabId: string | null;
}

/** Capture the origin tab BEFORE the first dispatch, so retries and the
 * IME-deferred callback can prove the tab has not changed underneath them. */
function captureOrigin(windowLabel: string): EditorActionOrigin {
  const tabId = useTabStore.getState().activeTabId[windowLabel] ?? null;
  return { windowLabel, tabId };
}

/** True while the origin tab is still the active tab of its window. */
function isOriginTabActive(origin: EditorActionOrigin): boolean {
  const current = useTabStore.getState().activeTabId[origin.windowLabel] ?? null;
  return current === origin.tabId;
}

/** Maximum retries when the editor is not yet mounted. */
const MAX_EDITOR_RETRIES = 3;

/**
 * Dispatch to the WYSIWYG editor. Returns true if the editor was available and
 * the action was run/queued. The action runs behind the ProseMirror IME guard;
 * when composing it is queued and executed later on `compositionend`, so
 * ownership is re-validated inside the deferred callback.
 */
function dispatchToWysiwyg(
  actionId: ActionId,
  params: Record<string, unknown> | undefined,
  origin: EditorActionOrigin,
): boolean {
  const editor = useEditorStore.getState().active.activeWysiwygEditor;
  if (!editor) return false;

  const view = editor.view;
  if (!view) {
    menuDispatcherLog(`WYSIWYG editor view not available for ${actionId}`);
    return false;
  }

  const multiSelection = getWysiwygMultiSelectionContext(view, null);
  const context = { surface: "wysiwyg", view, editor, context: null, multiSelection } as const;

  runOrQueueProseMirrorAction(view, () => {
    // Ownership re-validated at the mutation boundary: an IME-deferred action
    // runs later, and the user may have switched tabs in the meantime.
    if (!isOriginTabActive(origin)) {
      menuDispatcherLog(`${actionId} dropped — active tab changed before deferred dispatch`);
      return;
    }
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
function dispatchToSource(
  actionId: ActionId,
  params: Record<string, unknown> | undefined,
  origin: EditorActionOrigin,
): boolean {
  const view = useEditorStore.getState().active.activeSourceView;
  if (!view) return false;

  const cursorContext = useEditorStore.getState().source.context;
  const multiSelection = getSourceMultiSelectionContext(view, cursorContext);
  const context = { surface: "source", view, context: cursorContext, multiSelection } as const;

  runOrQueueCodeMirrorAction(view, () => {
    if (!isOriginTabActive(origin)) {
      menuDispatcherLog(`${actionId} dropped — active tab changed before deferred dispatch`);
      return;
    }
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
function dispatchWithRetry(
  label: string,
  origin: EditorActionOrigin,
  owner: EditorActionOwner,
  dispatch: () => boolean,
): void {
  if (dispatch()) return;

  let retryCount = 0;
  const retry = () => {
    retryCount++;
    if (!isOriginTabActive(origin)) {
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
 * Execute an editor action. Resolves the effective surface, enforces the
 * format-policy + capability gates at execution time (never delegated to a
 * caller's stale `when()`), routes undo/redo through unified history, and
 * dispatches to the active editor with IME-safe, tab-bound retry.
 *
 * The caller is responsible for any invocation-source policy (e.g. the native
 * menu's focus gate) BEFORE calling this.
 */
export function runEditorAction(actionId: ActionId, options: RunEditorActionOptions): void {
  const { windowLabel, params } = options;

  const actionDef = ACTION_DEFINITIONS[actionId];
  if (!actionDef) {
    menuDispatcherWarn(`Unknown action: ${actionId}`);
    return;
  }

  if (!isActionAllowedForActiveFormat(actionDef, windowLabel)) {
    menuDispatcherLog(`Action ${actionId} disabled by active format menuPolicy`);
    return;
  }

  const sourceMode = isEffectiveSourceMode(windowLabel);
  if (sourceMode && !actionDef.supports.source) {
    menuDispatcherLog(`Action ${actionId} not supported in source mode`);
    return;
  }
  if (!sourceMode && !actionDef.supports.wysiwyg) {
    menuDispatcherLog(`Action ${actionId} not supported in WYSIWYG mode`);
    return;
  }

  // Undo/redo go through unified history (cross-mode), not the per-editor
  // adapters — and carry no tab-bound retry (the history system is per-window).
  if (actionId === "undo") {
    performUnifiedUndo(windowLabel);
    return;
  }
  if (actionId === "redo") {
    performUnifiedRedo(windowLabel);
    return;
  }

  const origin = captureOrigin(windowLabel);
  const owner = getEditorActionOwner(windowLabel);
  if (sourceMode) {
    dispatchWithRetry(`${actionId} (source)`, origin, owner, () =>
      dispatchToSource(actionId, params, origin),
    );
  } else {
    dispatchWithRetry(`${actionId} (wysiwyg)`, origin, owner, () =>
      dispatchToWysiwyg(actionId, params, origin),
    );
  }
}
