/**
 * Unified History Hook
 *
 * Purpose: Cross-mode undo/redo — creates checkpoints when switching between
 *   WYSIWYG and Source modes so that undoing past the mode boundary restores
 *   the previous content without changing the current view mode.
 *
 * Pipeline: Mode switch → createCheckpoint(content, mode) → push to
 *   unifiedHistoryStore → user presses Cmd+Z past native history →
 *   this hook intercepts → restores content from checkpoint
 *
 * Key decisions:
 *   - Checkpoints store content only, never switch mode (view preference stays)
 *   - Both Tiptap (ProseMirror) and CodeMirror native undo are tried first
 *   - Unified history only kicks in when native undoDepth reaches 0
 *   - clearDocumentHistory exported for tab-close cleanup
 *
 * @coordinates-with unifiedHistoryStore.ts — stores checkpoint stack per tab
 * @coordinates-with useViewShortcuts.ts — calls toggleSourceModeWithCheckpoint
 * @module hooks/useUnifiedHistory
 */

import { undo, redo, undoDepth, redoDepth } from "@codemirror/commands";
import { useUnifiedHistoryStore, type HistoryCheckpoint } from "@/stores/unifiedHistoryStore";
import { useEditorStore } from "@/stores/editorStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useTiptapEditorStore } from "@/stores/tiptapEditorStore";
import { useActiveEditorStore } from "@/stores/activeEditorStore";
import { useLargeFileSessionStore } from "@/stores/largeFileSessionStore";
import { looksLikeWorkflowPath } from "@/lib/ghaWorkflow/detection";
import { imeToast } from "@/utils/imeToast";
import i18n from "@/i18n";
/**
 * Toggle source mode with checkpoint creation.
 * Use this instead of direct toggleSourceMode() to maintain history.
 *
 * @param windowLabel - The window label for multi-window support
 */
export function toggleSourceModeWithCheckpoint(windowLabel: string): void {
  const editorStore = useEditorStore.getState();
  const documentStore = useDocumentStore.getState();
  const tabStore = useTabStore.getState();
  const historyStore = useUnifiedHistoryStore.getState();
  const largeFile = useLargeFileSessionStore.getState();

  const tabId = tabStore.activeTabId[windowLabel];
  if (!tabId) {
    // Fallback: just toggle without checkpoint if no tab
    editorStore.toggleSourceMode();
    return;
  }

  const doc = documentStore.getDocument(tabId);
  if (!doc) {
    editorStore.toggleSourceMode();
    return;
  }

  // Refuse the toggle when the active tab is a `.yml`/`.yaml` workflow
  // file. WYSIWYG would round-trip the YAML through Tiptap's markdown
  // pipeline, which silently corrupts indentation and quoting. The
  // keyboard shortcut and the StatusBar button both flow through here,
  // so this single guard covers every entry point.
  if (looksLikeWorkflowPath(doc.filePath ?? undefined)) {
    imeToast.error(
      i18n.t("statusbar:yamlWysiwygBlocked", {
        defaultValue:
          "WYSIWYG mode would corrupt YAML indentation. Edit YAML in source mode.",
      }),
    );
    return;
  }

  // Effective mode respects the per-tab forced-source override.
  const isForcedSource = largeFile.isForcedSource(tabId);
  const effectiveSource = editorStore.sourceMode || isForcedSource;
  const currentMode = effectiveSource ? "source" : "wysiwyg";
  const cursorInfo = doc.cursorInfo ?? null;

  // Create checkpoint with current state before switching (per-document)
  historyStore.createCheckpoint(tabId, {
    markdown: doc.content,
    mode: currentMode,
    cursorInfo,
  });

  // If this tab is forced-source, the user explicitly toggling mode means
  // "I want to leave the forced-source state". Clear the marker; the global
  // toggle below then takes effect normally.
  if (isForcedSource) {
    largeFile.clearForcedSource(tabId);
    // If the global is already Source, clearing the marker alone does not
    // change effective mode — we must flip global too. If the global is
    // WYSIWYG, clearing the marker IS the toggle (effective: source → wysiwyg).
    if (!editorStore.sourceMode) {
      // Global is WYSIWYG, effective was forced Source; clearing marker
      // gives effective WYSIWYG. No global toggle needed.
      return;
    }
    // Global is Source; clearing marker leaves effective Source. Fall through
    // to toggle global off.
  }

  editorStore.toggleSourceMode();
}

/**
 * Check if native undo is available in the current editor.
 */
export function canNativeUndo(): boolean {
  const sourceMode = useEditorStore.getState().sourceMode;

  if (sourceMode) {
    const view = useActiveEditorStore.getState().activeSourceView;
    if (!view) return false;
    return undoDepth(view.state) > 0;
  } else {
    const editor = useTiptapEditorStore.getState().editor;
    if (!editor) return false;
    return editor.can().undo();
  }
}

/**
 * Check if native redo is available in the current editor.
 */
export function canNativeRedo(): boolean {
  const sourceMode = useEditorStore.getState().sourceMode;

  if (sourceMode) {
    const view = useActiveEditorStore.getState().activeSourceView;
    if (!view) return false;
    return redoDepth(view.state) > 0;
  } else {
    const editor = useTiptapEditorStore.getState().editor;
    /* v8 ignore start -- editor is always set when this is called; null guard is defensive */
    if (!editor) return false;
    /* v8 ignore stop */
    return editor.can().redo();
  }
}

/**
 * Perform native undo in the current editor.
 * Returns true if undo was performed.
 */
export function doNativeUndo(): boolean {
  const sourceMode = useEditorStore.getState().sourceMode;

  if (sourceMode) {
    const view = useActiveEditorStore.getState().activeSourceView;
    if (!view || undoDepth(view.state) === 0) return false;
    return undo(view);
  } else {
    const editor = useTiptapEditorStore.getState().editor;
    if (!editor || !editor.can().undo()) return false;
    return editor.commands.undo();
  }
}

/**
 * Perform native redo in the current editor.
 * Returns true if redo was performed.
 */
export function doNativeRedo(): boolean {
  const sourceMode = useEditorStore.getState().sourceMode;

  if (sourceMode) {
    const view = useActiveEditorStore.getState().activeSourceView;
    if (!view || redoDepth(view.state) === 0) return false;
    return redo(view);
  } else {
    const editor = useTiptapEditorStore.getState().editor;
    if (!editor || !editor.can().redo()) return false;
    return editor.commands.redo();
  }
}

/**
 * Restore document from a checkpoint.
 * Handles content restoration, cursor position, and mode switching.
 */
function restoreFromCheckpoint(
  tabId: string,
  checkpoint: HistoryCheckpoint
): void {
  const historyStore = useUnifiedHistoryStore.getState();
  const documentStore = useDocumentStore.getState();

  historyStore.setRestoring(true);
  try {
    documentStore.setContent(tabId, checkpoint.markdown);
    documentStore.setCursorInfo(tabId, checkpoint.cursorInfo);
    // Mode is NOT restored — undo/redo only affects content, never view preference.
    // The user's current mode is their explicit choice; undo should not override it.
  } finally {
    queueMicrotask(() => {
      historyStore.setRestoring(false);
    });
  }
}

/**
 * Clear unified history for a specific document (call when tab closes).
 */
export function clearDocumentHistory(tabId: string): void {
  useUnifiedHistoryStore.getState().clearDocument(tabId);
}

/**
 * Perform unified undo (can be called from any context).
 * 1. Try native undo first
 * 2. If native history exhausted, restore from checkpoint
 * 3. May trigger mode switch if checkpoint is from different mode
 *
 * Returns true if any undo action was performed.
 */
export function performUnifiedUndo(windowLabel: string): boolean {
  // First, try native undo (single call avoids TOCTOU gap)
  if (doNativeUndo()) {
    return true;
  }

  const historyStore = useUnifiedHistoryStore.getState();
  const tabStore = useTabStore.getState();
  const tabId = tabStore.activeTabId[windowLabel];
  if (!tabId) return false;

  // Native undo exhausted, check for checkpoint
  if (!historyStore.canUndoCheckpoint(tabId)) {
    return false;
  }

  const documentStore = useDocumentStore.getState();
  const doc = documentStore.getDocument(tabId);
  if (!doc) return false;

  const currentMode = useEditorStore.getState().sourceMode ? "source" : "wysiwyg";

  // Save current state to redo stack before restoring
  historyStore.pushRedo(tabId, {
    markdown: doc.content,
    mode: currentMode,
    cursorInfo: doc.cursorInfo ?? null,
  });

  const checkpoint = historyStore.popUndo(tabId);
  if (!checkpoint) return false;

  restoreFromCheckpoint(tabId, checkpoint);
  return true;
}

/**
 * Perform unified redo (can be called from any context).
 * 1. Try native redo first
 * 2. If native history exhausted, restore from checkpoint
 *
 * Returns true if any redo action was performed.
 */
export function performUnifiedRedo(windowLabel: string): boolean {
  // First, try native redo (single call avoids TOCTOU gap)
  if (doNativeRedo()) {
    return true;
  }

  const historyStore = useUnifiedHistoryStore.getState();
  const tabStore = useTabStore.getState();
  const tabId = tabStore.activeTabId[windowLabel];
  if (!tabId) return false;

  // Native redo exhausted, check for checkpoint
  if (!historyStore.canRedoCheckpoint(tabId)) {
    return false;
  }

  const documentStore = useDocumentStore.getState();
  const doc = documentStore.getDocument(tabId);
  if (!doc) return false;

  const currentMode = useEditorStore.getState().sourceMode ? "source" : "wysiwyg";

  // Pop redo checkpoint first (before pushing to undo, which doesn't clear redo)
  const checkpoint = historyStore.popRedo(tabId);
  if (!checkpoint) return false;

  // Save current state to undo stack (preserving remaining redo stack)
  historyStore.pushUndo(tabId, {
    markdown: doc.content,
    mode: currentMode,
    cursorInfo: doc.cursorInfo ?? null,
  });

  restoreFromCheckpoint(tabId, checkpoint);
  return true;
}
