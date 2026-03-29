/**
 * Unified Menu Commands
 *
 * Purpose: Single dispatcher for all format/insert menu events — routes each
 *   action to the appropriate editor adapter based on current mode
 *   (WYSIWYG via Tiptap or Source via CodeMirror).
 *
 * Pipeline: Rust menu event → Tauri `listen("menu:{id}")` → MENU_TO_ACTION
 *   lookup → performWysiwygToolbarAction() or performSourceToolbarAction()
 *
 * Key decisions:
 *   - Must be mounted ONCE at EditorHost level, not per-editor
 *   - Uses actionRegistry to map menu IDs to canonical action IDs
 *   - Heading levels extracted from menu params (e.g., "heading-1" → level 1)
 *
 * @coordinates-with actionRegistry.ts — maps menu event IDs to action IDs
 * @coordinates-with wysiwygAdapter.ts — executes actions in WYSIWYG mode
 * @coordinates-with sourceAdapter.ts — executes actions in Source mode
 * @module hooks/useUnifiedMenuCommands
 */

import { useEffect, useRef } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEditorStore } from "@/stores/editorStore";
import { useActiveEditorStore } from "@/stores/activeEditorStore";
import { useSourceCursorContextStore } from "@/stores/sourceCursorContextStore";
import {
  MENU_TO_ACTION,
  ACTION_DEFINITIONS,
  getHeadingLevelFromParams,
} from "@/plugins/actions/actionRegistry";
import type { MenuEventId, ActionId } from "@/plugins/actions/types";
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
import { performUnifiedUndo, performUnifiedRedo } from "@/hooks/useUnifiedHistory";
import { shouldBlockMenuAction } from "@/utils/focusGuard";
import { runOrQueueCodeMirrorAction } from "@/utils/imeGuard";
import { safeUnlistenAll } from "@/utils/safeUnlisten";
import { menuDispatcherLog, menuDispatcherWarn, menuError } from "@/utils/debug";

/**
 * Map action IDs to the internal adapter action names.
 * Some action IDs differ from adapter action names.
 */
function mapActionIdToAdapterAction(actionId: ActionId): string {
  // Most action IDs match adapter action names directly
  // Handle special cases where they differ
  switch (actionId) {
    case "codeBlock":
      return "insertCodeBlock";
    case "blockquote":
      return "insertBlockquote";
    case "horizontalLine":
      return "insertDivider";
    case "addRowBelow":
      return "addRow";
    case "addColRight":
      return "addCol";
    case "wikiLink":
      return "link:wiki";
    case "bookmark":
      return "link:bookmark";
    default:
      return actionId;
  }
}

/**
 * Maximum retries when editor is not yet available.
 * Each retry waits 50ms, so max wait is 150ms.
 */
const MAX_EDITOR_RETRIES = 3;
const RETRY_DELAY_MS = 50;

/**
 * Dispatch action to WYSIWYG editor.
 * Returns true if action was dispatched, false otherwise.
 */
function dispatchToWysiwygImpl(
  actionId: ActionId,
  params?: Record<string, unknown>
): boolean {
  const editor = useActiveEditorStore.getState().activeWysiwygEditor;
  if (!editor) {
    return false;
  }

  const view = editor.view;
  if (!view) {
    menuDispatcherLog(`WYSIWYG editor view not available for ${actionId}`);
    return false;
  }

  // Build context for multi-selection support (cursor context is null for menu actions)
  const multiSelection = getWysiwygMultiSelectionContext(view, null);

  // Handle heading actions specially
  if (actionId === "setHeading") {
    const level = getHeadingLevelFromParams(params);
    return setWysiwygHeadingLevel(
      { surface: "wysiwyg", view, editor, context: null, multiSelection },
      level
    );
  }

  if (actionId === "paragraph") {
    return setWysiwygHeadingLevel(
      { surface: "wysiwyg", view, editor, context: null, multiSelection },
      0
    );
  }

  if (actionId === "increaseHeading" || actionId === "decreaseHeading") {
    // These require special handling - delegate to the adapter
    // which will check current heading level
    const adapterAction = mapActionIdToAdapterAction(actionId);
    return performWysiwygToolbarAction(adapterAction, {
      surface: "wysiwyg",
      view,
      editor,
      context: null,
      multiSelection,
    });
  }

  // Map to adapter action and dispatch
  const adapterAction = mapActionIdToAdapterAction(actionId);
  return performWysiwygToolbarAction(adapterAction, {
    surface: "wysiwyg",
    view,
    editor,
    context: null,
    multiSelection,
  });
}

/**
 * Dispatch action to WYSIWYG editor with retry logic.
 * If the editor is not yet available (e.g., during tab switch or initial mount),
 * retries a few times with a short delay to handle race conditions.
 */
function dispatchToWysiwyg(
  actionId: ActionId,
  params?: Record<string, unknown>
): void {
  // Try immediately first
  if (dispatchToWysiwygImpl(actionId, params)) {
    return;
  }

  // Editor not available - retry with delay
  // This handles race conditions during tab switch or initial mount
  let retryCount = 0;

  const retry = () => {
    retryCount++;
    if (dispatchToWysiwygImpl(actionId, params)) {
      menuDispatcherLog(`${actionId} succeeded after ${retryCount} retry(ies)`);
      return;
    }

    if (retryCount < MAX_EDITOR_RETRIES) {
      setTimeout(retry, RETRY_DELAY_MS);
    } else {
      menuDispatcherLog(
        `WYSIWYG editor not available for ${actionId} after ${retryCount} retries`
      );
    }
  };

  setTimeout(retry, RETRY_DELAY_MS);
}

/**
 * Dispatch action to Source editor implementation.
 * Returns true if the view was available and action was queued.
 */
function dispatchToSourceImpl(
  actionId: ActionId,
  params?: Record<string, unknown>
): boolean {
  const view = useActiveEditorStore.getState().activeSourceView;
  if (!view) {
    return false;
  }

  // Capture context before queuing to avoid stale state if selection changes
  const cursorContext = useSourceCursorContextStore.getState().context;
  const multiSelection = getSourceMultiSelectionContext(view, cursorContext);

  // Use IME guard for safe dispatching
  runOrQueueCodeMirrorAction(view, () => {
    // Handle heading actions specially
    if (actionId === "setHeading") {
      const level = getHeadingLevelFromParams(params);
      setSourceHeadingLevel(
        { surface: "source", view, context: cursorContext, multiSelection },
        level
      );
      return;
    }

    if (actionId === "paragraph") {
      setSourceHeadingLevel(
        { surface: "source", view, context: cursorContext, multiSelection },
        0
      );
      return;
    }

    // Map to adapter action and dispatch
    const adapterAction = mapActionIdToAdapterAction(actionId);
    performSourceToolbarAction(adapterAction, {
      surface: "source",
      view,
      context: cursorContext,
      multiSelection,
    });
  });

  return true;
}

/**
 * Dispatch action to Source editor with retry logic.
 * If the view is not yet available, retries a few times with a short delay.
 */
function dispatchToSource(
  actionId: ActionId,
  params?: Record<string, unknown>
): void {
  // Try immediately first
  if (dispatchToSourceImpl(actionId, params)) {
    return;
  }

  // View not available - retry with delay
  let retryCount = 0;

  const retry = () => {
    retryCount++;
    if (dispatchToSourceImpl(actionId, params)) {
      menuDispatcherLog(`${actionId} (source) succeeded after ${retryCount} retry(ies)`);
      return;
    }

    if (retryCount < MAX_EDITOR_RETRIES) {
      setTimeout(retry, RETRY_DELAY_MS);
    } else {
      menuDispatcherLog(
        `Source view not available for ${actionId} after ${retryCount} retries`
      );
    }
  };

  setTimeout(retry, RETRY_DELAY_MS);
}

/**
 * Unified menu command dispatcher.
 *
 * Listens to ALL menu events defined in the action registry and routes them
 * to the appropriate editor adapter based on current mode.
 *
 * Mount this hook ONCE at the EditorHost level.
 */
export function useUnifiedMenuCommands(): void {
  const unlistenRefs = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    let disposed = false;

    const setupListeners = async () => {
      // Clean up any existing listeners
      unlistenRefs.current = safeUnlistenAll(unlistenRefs.current);

      /* v8 ignore start -- disposed=true race: component unmounts between safeUnlistenAll and this check */
      if (disposed) return;
      /* v8 ignore stop */

      const currentWindow = getCurrentWebviewWindow();
      const windowLabel = currentWindow.label;

      const listenerPromises: Promise<UnlistenFn>[] = [];

      // Register handler for EVERY menu event in the registry
      for (const [menuEvent, mapping] of Object.entries(MENU_TO_ACTION)) {
        const promise = currentWindow.listen<string>(menuEvent as MenuEventId, (event) => {
          // Window filtering - payload is target window label
          if (typeof event.payload !== "string" || event.payload !== windowLabel) {
            return;
          }

          // Broader focus guard (terminal, search inputs, settings, etc.)
          if (shouldBlockMenuAction()) {
            return;
          }

          const { actionId, params } = mapping;

          // Get action definition for capability check
          const actionDef = ACTION_DEFINITIONS[actionId];
          if (!actionDef) {
            menuDispatcherWarn(`Unknown action: ${actionId}`);
            return;
          }

          // Route to appropriate adapter based on mode
          const isSourceMode = useEditorStore.getState().sourceMode;

          // Capability check
          if (isSourceMode && !actionDef.supports.source) {
            menuDispatcherLog(
              `Action ${actionId} not supported in source mode`
            );
            return;
          }
          if (!isSourceMode && !actionDef.supports.wysiwyg) {
            menuDispatcherLog(
              `Action ${actionId} not supported in WYSIWYG mode`
            );
            return;
          }

          // Undo/redo must go through the unified history system
          // (not the per-editor native adapters) to support cross-mode undo
          if (actionId === "undo") {
            performUnifiedUndo(windowLabel);
            return;
          }
          if (actionId === "redo") {
            performUnifiedRedo(windowLabel);
            return;
          }

          // Dispatch to appropriate adapter
          if (isSourceMode) {
            dispatchToSource(actionId, params);
          } else {
            dispatchToWysiwyg(actionId, params);
          }
        });

        listenerPromises.push(promise);
      }

      // Wait for all listeners to be registered using allSettled to handle partial failures
      const results = await Promise.allSettled(listenerPromises);

      /* v8 ignore start -- disposed=true race: component unmounts while awaiting allSettled */
      if (disposed) {
        // Component unmounted during setup, clean up any successful listeners
        for (const result of results) {
          if (result.status === "fulfilled") {
            result.value();
          }
        }
        return;
      }
      /* v8 ignore stop */

      // Collect successful listeners, log failures
      const unlisteners: UnlistenFn[] = [];
      for (const result of results) {
        if (result.status === "fulfilled") {
          unlisteners.push(result.value);
        } else {
          menuError("Failed to register listener:", result.reason);
        }
      }
      unlistenRefs.current = unlisteners;
    };

    setupListeners().catch((error) => {
      menuError("Failed to setup unified menu listeners:", error);
    });

    return () => {
      disposed = true;
      unlistenRefs.current = safeUnlistenAll(unlistenRefs.current);
    };
  }, []);
}
