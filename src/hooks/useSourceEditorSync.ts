/**
 * Source Editor Sync Hook
 *
 * Purpose: Syncs external state changes into the CodeMirror editor —
 *   content updates, word wrap, BR visibility, auto-pair, and line numbers.
 *
 * Key decisions:
 *   - Uses CodeMirror compartments for dynamic reconfiguration without rebuild
 *   - isInternalChange ref prevents echo loops (editor change → store → editor)
 *   - runOrQueueCodeMirrorAction defers updates during IME composition
 *   - Content sync preserves cursor position when possible
 *
 * @coordinates-with sourceEditorExtensions.ts — compartment definitions
 * @coordinates-with editorStore.ts — reads wordWrap, showLineNumbers, etc.
 * @module hooks/useSourceEditorSync
 */
import { useEffect, useRef, type MutableRefObject } from "react";
import { EditorView, lineNumbers } from "@codemirror/view";
import { closeBrackets } from "@codemirror/autocomplete";
import { createBrHidingPlugin } from "@/plugins/codemirror";
import { runOrQueueCodeMirrorAction } from "@/utils/imeGuard";
import {
  lineWrapCompartment,
  brVisibilityCompartment,
  autoPairCompartment,
  lineNumbersCompartment,
} from "@/utils/sourceEditorExtensions";

interface SyncConfig {
  viewRef: MutableRefObject<EditorView | null>;
  isInternalChange: MutableRefObject<boolean>;
  content: string;
  wordWrap: boolean;
  showBrTags: boolean;
  autoPairEnabled: boolean | undefined;
  showLineNumbers: boolean;
  getCursorInfo?: () => unknown | null;
  /** When true, skip content sync to avoid polluting undo history on a hidden editor */
  hiddenRef?: MutableRefObject<boolean>;
}

/**
 * Sync external content changes to CodeMirror.
 * Tracks pending content to handle cases where external updates arrive
 * while an internal change is in progress.
 */
export function useSourceEditorContentSync(
  viewRef: MutableRefObject<EditorView | null>,
  isInternalChange: MutableRefObject<boolean>,
  content: string,
  getCursorInfo?: () => unknown | null,
  hiddenRef?: MutableRefObject<boolean>
): void {
  // Track the latest external content to apply after internal changes settle
  const pendingContentRef = useRef<string | null>(null);
  const lastAppliedContentRef = useRef<string | null>(null);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    // Skip content sync when hidden — dispatching changes to a hidden CM view
    // pollutes its undo history. Content will be synced on visibility transition.
    if (hiddenRef?.current) return;

    // If internal change is in progress, store content for later
    if (isInternalChange.current) {
      pendingContentRef.current = content;
      return;
    }

    const currentContent = view.state.doc.toString();

    // Check if we have pending content that differs from current
    const targetContent = pendingContentRef.current ?? content;
    pendingContentRef.current = null;

    // Skip if content matches what's already in the editor or what we last applied
    if (currentContent === targetContent || lastAppliedContentRef.current === targetContent) {
      return;
    }

    lastAppliedContentRef.current = targetContent;
    // Track if this is a fresh document load (empty -> content)
    const wasFreshLoad = currentContent.length === 0 && targetContent.length > 0;
    runOrQueueCodeMirrorAction(view, () => {
      view.dispatch({
        changes: {
          from: 0,
          to: currentContent.length,
          insert: targetContent,
        },
      });
      // For fresh document load (no saved cursor position), set cursor to start
      // This handles the case where editor was created with empty content and
      // actual content was loaded asynchronously
      if (wasFreshLoad && getCursorInfo && !getCursorInfo()) {
        view.dispatch({
          selection: { anchor: 0 },
          scrollIntoView: true,
        });
      }
    });
  }, [viewRef, isInternalChange, content, getCursorInfo, hiddenRef]);

  // Poll for pending content when internal change completes
  useEffect(() => {
    const checkPendingContent = (): void => {
      const view = viewRef.current;
      if (!view || isInternalChange.current || !pendingContentRef.current) return;
      if (hiddenRef?.current) return;

      const currentContent = view.state.doc.toString();
      const targetContent = pendingContentRef.current;
      pendingContentRef.current = null;

      if (currentContent !== targetContent && lastAppliedContentRef.current !== targetContent) {
        lastAppliedContentRef.current = targetContent;
        runOrQueueCodeMirrorAction(view, () => {
          view.dispatch({
            changes: {
              from: 0,
              to: currentContent.length,
              insert: targetContent,
            },
          });
        });
      }
    };

    // Check periodically while component is mounted
    const intervalId = setInterval(checkPendingContent, 100);
    return () => clearInterval(intervalId);
  }, [viewRef, isInternalChange, hiddenRef]);
}

/**
 * Sync wordWrap setting changes to CodeMirror.
 */
export function useSourceEditorWordWrapSync(
  viewRef: MutableRefObject<EditorView | null>,
  wordWrap: boolean
): void {
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    runOrQueueCodeMirrorAction(view, () => {
      view.dispatch({
        effects: lineWrapCompartment.reconfigure(
          wordWrap ? EditorView.lineWrapping : []
        ),
      });
    });
  }, [viewRef, wordWrap]);
}

/**
 * Sync BR visibility setting changes to CodeMirror.
 */
export function useSourceEditorBrVisibilitySync(
  viewRef: MutableRefObject<EditorView | null>,
  showBrTags: boolean
): void {
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    runOrQueueCodeMirrorAction(view, () => {
      view.dispatch({
        effects: brVisibilityCompartment.reconfigure(
          createBrHidingPlugin(!showBrTags)
        ),
      });
    });
  }, [viewRef, showBrTags]);
}

/**
 * Sync auto-pair setting changes to CodeMirror.
 */
export function useSourceEditorAutoPairSync(
  viewRef: MutableRefObject<EditorView | null>,
  autoPairEnabled: boolean | undefined
): void {
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    runOrQueueCodeMirrorAction(view, () => {
      view.dispatch({
        effects: autoPairCompartment.reconfigure(
          autoPairEnabled ? closeBrackets() : []
        ),
      });
    });
  }, [viewRef, autoPairEnabled]);
}

/**
 * Sync line numbers setting changes to CodeMirror.
 */
export function useSourceEditorLineNumbersSync(
  viewRef: MutableRefObject<EditorView | null>,
  showLineNumbers: boolean
): void {
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    runOrQueueCodeMirrorAction(view, () => {
      view.dispatch({
        effects: lineNumbersCompartment.reconfigure(
          showLineNumbers ? lineNumbers() : []
        ),
      });
    });
  }, [viewRef, showLineNumbers]);
}

/**
 * Combined sync hook for all settings.
 */
export function useSourceEditorSync(config: SyncConfig): void {
  const { viewRef, isInternalChange, content, wordWrap, showBrTags, autoPairEnabled, showLineNumbers, getCursorInfo, hiddenRef } = config;

  useSourceEditorContentSync(viewRef, isInternalChange, content, getCursorInfo, hiddenRef);
  useSourceEditorWordWrapSync(viewRef, wordWrap);
  useSourceEditorBrVisibilitySync(viewRef, showBrTags);
  useSourceEditorAutoPairSync(viewRef, autoPairEnabled);
  useSourceEditorLineNumbersSync(viewRef, showLineNumbers);
}
