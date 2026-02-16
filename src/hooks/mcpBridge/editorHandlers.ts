/**
 * MCP Bridge — Editor Operation Handlers
 *
 * Purpose: Editor-level operations — undo, redo, focus management, and
 *   editor mode switching via the unified history system (supports cross-mode undo).
 *
 * @coordinates-with useUnifiedHistory.ts — performUnifiedUndo/Redo
 * @coordinates-with editorStore.ts — sourceMode state for editor.setMode
 * @module hooks/mcpBridge/editorHandlers
 */

import { undoDepth as pmUndoDepth, redoDepth as pmRedoDepth } from "@tiptap/pm/history";
import { undoDepth as cmUndoDepth, redoDepth as cmRedoDepth } from "@codemirror/commands";
import { respond, getEditor } from "./utils";
import { performUnifiedUndo, performUnifiedRedo, canNativeUndo, canNativeRedo } from "@/hooks/useUnifiedHistory";
import { useUnifiedHistoryStore } from "@/stores/unifiedHistoryStore";
import { useEditorStore } from "@/stores/editorStore";
import { useActiveEditorStore } from "@/stores/activeEditorStore";
import { useTabStore } from "@/stores/tabStore";
import { getCurrentWindowLabel } from "@/utils/workspaceStorage";

/**
 * Handle editor.undo request.
 * Uses the unified history system to support cross-mode undo.
 */
export async function handleUndo(id: string): Promise<void> {
  try {
    const windowLabel = getCurrentWindowLabel();
    const performed = performUnifiedUndo(windowLabel);

    await respond({ id, success: true, data: { performed } });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle editor.redo request.
 * Uses the unified history system to support cross-mode redo.
 */
export async function handleRedo(id: string): Promise<void> {
  try {
    const windowLabel = getCurrentWindowLabel();
    const performed = performUnifiedRedo(windowLabel);

    await respond({ id, success: true, data: { performed } });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle editor.focus request.
 */
export async function handleFocus(id: string): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    editor.commands.focus();

    await respond({ id, success: true, data: null });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle editor.getUndoState request.
 * Returns unified undo/redo state (native + cross-mode checkpoints).
 */
export async function handleGetUndoState(id: string): Promise<void> {
  try {
    const windowLabel = getCurrentWindowLabel();
    const tabId = useTabStore.getState().activeTabId[windowLabel];
    const historyStore = useUnifiedHistoryStore.getState();
    const isSourceMode = useEditorStore.getState().sourceMode;

    const hasNativeUndo = canNativeUndo();
    const hasNativeRedo = canNativeRedo();
    const hasCheckpointUndo = tabId ? historyStore.canUndoCheckpoint(tabId) : false;
    const hasCheckpointRedo = tabId ? historyStore.canRedoCheckpoint(tabId) : false;

    // Mode-appropriate native depths
    let nativeUndoCount = 0;
    let nativeRedoCount = 0;
    if (isSourceMode) {
      const view = useActiveEditorStore.getState().activeSourceView;
      if (view) {
        nativeUndoCount = cmUndoDepth(view.state);
        nativeRedoCount = cmRedoDepth(view.state);
      }
    } else {
      const editor = getEditor();
      if (editor) {
        nativeUndoCount = pmUndoDepth(editor.state);
        nativeRedoCount = pmRedoDepth(editor.state);
      }
    }

    await respond({
      id,
      success: true,
      data: {
        canUndo: hasNativeUndo || hasCheckpointUndo,
        canRedo: hasNativeRedo || hasCheckpointRedo,
        undoDepth: nativeUndoCount,
        redoDepth: nativeRedoCount,
        hasCheckpointUndo,
        hasCheckpointRedo,
      },
    });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle editor.setMode request.
 * Switches editor between "wysiwyg" and "source" mode.
 * This tool works in any mode, allowing MCP clients to switch
 * to WYSIWYG before using editor-dependent tools.
 */
export async function handleSetMode(id: string, args: Record<string, unknown>): Promise<void> {
  try {
    const mode = args.mode;
    if (mode !== "wysiwyg" && mode !== "source") {
      throw new Error(`Invalid mode: "${mode}". Must be "wysiwyg" or "source".`);
    }

    const currentSourceMode = useEditorStore.getState().sourceMode;
    const wantSource = mode === "source";

    if (currentSourceMode !== wantSource) {
      useEditorStore.getState().setSourceMode(wantSource);
    }

    await respond({
      id,
      success: true,
      data: {
        mode,
        changed: currentSourceMode !== wantSource,
      },
    });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
