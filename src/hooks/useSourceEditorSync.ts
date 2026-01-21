/**
 * Hook for syncing external state changes to the CodeMirror editor.
 * Handles content sync, wordWrap, brVisibility, and autoPair settings.
 */
import { useEffect, useRef, type MutableRefObject } from "react";
import { EditorView } from "@codemirror/view";
import { closeBrackets } from "@codemirror/autocomplete";
import { createBrHidingPlugin } from "@/plugins/codemirror";
import { runOrQueueCodeMirrorAction } from "@/utils/imeGuard";
import {
  lineWrapCompartment,
  brVisibilityCompartment,
  autoPairCompartment,
} from "@/utils/sourceEditorExtensions";

interface SyncConfig {
  viewRef: MutableRefObject<EditorView | null>;
  isInternalChange: MutableRefObject<boolean>;
  content: string;
  wordWrap: boolean;
  showBrTags: boolean;
  autoPairEnabled: boolean | undefined;
}

/**
 * Sync external content changes to CodeMirror.
 * Tracks pending content to handle cases where external updates arrive
 * while an internal change is in progress.
 */
export function useSourceEditorContentSync(
  viewRef: MutableRefObject<EditorView | null>,
  isInternalChange: MutableRefObject<boolean>,
  content: string
): void {
  // Track the latest external content to apply after internal changes settle
  const pendingContentRef = useRef<string | null>(null);
  const lastAppliedContentRef = useRef<string | null>(null);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

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
    runOrQueueCodeMirrorAction(view, () => {
      view.dispatch({
        changes: {
          from: 0,
          to: currentContent.length,
          insert: targetContent,
        },
      });
    });
  }, [viewRef, isInternalChange, content]);

  // Poll for pending content when internal change completes
  useEffect(() => {
    const checkPendingContent = (): void => {
      const view = viewRef.current;
      if (!view || isInternalChange.current || !pendingContentRef.current) return;

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
  }, [viewRef, isInternalChange]);
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
 * Combined sync hook for all settings.
 */
export function useSourceEditorSync(config: SyncConfig): void {
  const { viewRef, isInternalChange, content, wordWrap, showBrTags, autoPairEnabled } = config;

  useSourceEditorContentSync(viewRef, isInternalChange, content);
  useSourceEditorWordWrapSync(viewRef, wordWrap);
  useSourceEditorBrVisibilitySync(viewRef, showBrTags);
  useSourceEditorAutoPairSync(viewRef, autoPairEnabled);
}
