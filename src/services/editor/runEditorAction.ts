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
 * Ownership: an event is bound to the tab + effective surface active when it
 *   fired. The origin is captured BEFORE the first dispatch and re-validated at
 *   every deferred boundary — each retry AND the IME-queued callback (run later
 *   on `compositionend`). A deferred action is dropped if the tab changed, the
 *   effective surface flipped, the target editor/view remounted, or the window's
 *   owner was disposed — so it can never mutate a stale, hidden, or torn-down
 *   editor.
 *
 * @coordinates-with commands/commandContext.ts — the resolved gate context
 * @coordinates-with commands/actionAvailability.ts — isActionExecutable gate
 * @coordinates-with editorActionGates.ts — effective-surface + adapter-name map
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
import { isEffectiveSourceMode, mapActionIdToAdapterAction } from "./editorActionGates";
import { getEditorActionOwner, type EditorActionOwner } from "./editorActionOwner";
import { resolveCommandContext } from "@/services/commands/commandContext";
import { isActionExecutable } from "@/services/commands/actionAvailability";

/** Options for a single `runEditorAction` invocation. */
export interface RunEditorActionOptions {
  /** The webview window the action targets (retry + ownership are per-window). */
  windowLabel: string;
  /** Parameterized-action payload, e.g. `{ level }` for `setHeading`. */
  params?: Record<string, unknown>;
}

/** The tab + surface an action is bound to — captured when it is invoked. */
interface EditorActionOrigin {
  windowLabel: string;
  tabId: string | null;
  sourceMode: boolean;
}

/** Capture the origin (tab + effective surface) BEFORE the first dispatch, so
 * retries and the IME-deferred callback can prove nothing shifted underneath. */
function captureOrigin(windowLabel: string, sourceMode: boolean): EditorActionOrigin {
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
function dispatchToWysiwyg(
  actionId: ActionId,
  params: Record<string, unknown> | undefined,
  origin: EditorActionOrigin,
  owner: EditorActionOwner,
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
    // Re-validate at the mutation boundary: an IME-deferred action runs later
    // (on compositionend), by when the window may have torn down (owner
    // disposed), the user may have switched tabs, or the editor may have
    // remounted for the same tab — any of which makes `editor`/`view` stale.
    if (
      owner.isDisposed() ||
      !isOriginValid(origin) ||
      useEditorStore.getState().active.activeWysiwygEditor !== editor
    ) {
      menuDispatcherLog(`${actionId} dropped — origin no longer valid at deferred dispatch`);
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
  owner: EditorActionOwner,
): boolean {
  const view = useEditorStore.getState().active.activeSourceView;
  if (!view) return false;

  const cursorContext = useEditorStore.getState().source.context;
  const multiSelection = getSourceMultiSelectionContext(view, cursorContext);
  const context = { surface: "source", view, context: cursorContext, multiSelection } as const;

  runOrQueueCodeMirrorAction(view, () => {
    // See dispatchToWysiwyg: same deferred-boundary re-validation for the
    // Source (CodeMirror) surface — owner alive, same tab, same view instance.
    if (
      owner.isDisposed() ||
      !isOriginValid(origin) ||
      useEditorStore.getState().active.activeSourceView !== view
    ) {
      menuDispatcherLog(`${actionId} dropped — origin no longer valid at deferred dispatch`);
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

  if (!ACTION_DEFINITIONS[actionId]) {
    menuDispatcherWarn(`Unknown action: ${actionId}`);
    return;
  }

  // Single shared gate (WI-2.3): resolve the context once, then apply the
  // executor's correctness policy — live document + mode capability + format.
  // (Node/selection are the palette's discoverability concern, not enforced
  // here; the executor's retry handles a not-yet-mounted editor.)
  const ctx = resolveCommandContext(windowLabel);
  if (!isActionExecutable(actionId, ctx)) {
    menuDispatcherLog(`Action ${actionId} not executable in the current context`);
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

  const sourceMode = ctx.mode === "source";
  const origin = captureOrigin(windowLabel, sourceMode);
  const owner = getEditorActionOwner(windowLabel);
  if (sourceMode) {
    dispatchWithRetry(`${actionId} (source)`, origin, owner, () =>
      dispatchToSource(actionId, params, origin, owner),
    );
  } else {
    dispatchWithRetry(`${actionId} (wysiwyg)`, origin, owner, () =>
      dispatchToWysiwyg(actionId, params, origin, owner),
    );
  }
}
