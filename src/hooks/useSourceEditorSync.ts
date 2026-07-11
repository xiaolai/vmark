/**
 * Source Editor Sync Hook
 *
 * Purpose: Syncs external state changes into the CodeMirror editor —
 *   content updates, word wrap, BR visibility, auto-pair, and line numbers.
 *
 * Key decisions:
 *   - Uses CodeMirror compartments for dynamic reconfiguration without rebuild
 *   - runOrQueueCodeMirrorAction defers updates during IME composition
 *   - Content sync lives in useSourceEditorContentSync.ts (echo-loop guard,
 *     cursor preservation, on-demand pending-content retry)
 *
 * @coordinates-with useSourceEditorContentSync.ts — content sync half
 * @coordinates-with sourceEditorExtensions.ts — compartment definitions
 * @coordinates-with editorStore.ts — reads wordWrap, showLineNumbers, etc.
 * @module hooks/useSourceEditorSync
 */
import { useEffect, type MutableRefObject } from "react";
import { EditorView, lineNumbers } from "@codemirror/view";
import { closeBrackets } from "@codemirror/autocomplete";
import { createBrHidingPlugin, createShowInvisiblesPlugin, showInvisiblesTheme } from "@/plugins/codemirror";
import { runOrQueueCodeMirrorAction } from "@/utils/imeGuard";
import { useSourceEditorContentSync } from "./useSourceEditorContentSync";
import {
  lineWrapCompartment,
  brVisibilityCompartment,
  autoPairCompartment,
  lineNumbersCompartment,
  showInvisiblesCompartment,
} from "@/services/assembly/sourceEditorExtensions";

export { useSourceEditorContentSync } from "./useSourceEditorContentSync";

interface SyncConfig {
  viewRef: MutableRefObject<EditorView | null>;
  isInternalChange: MutableRefObject<boolean>;
  content: string;
  wordWrap: boolean;
  showBrTags: boolean;
  autoPairEnabled: boolean | undefined;
  showLineNumbers: boolean;
  showInvisibles: boolean;
  getCursorInfo?: () => unknown | null;
  /** When true, skip content sync to avoid polluting undo history on a hidden editor */
  hiddenRef?: MutableRefObject<boolean>;
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
 * Sync show-invisibles setting changes to CodeMirror.
 * Internal — consumed only by `useSourceEditorSync` below (WI-1.3: dropped the
 * redundant `export`; the function is live, knip only flagged the export).
 */
function useSourceEditorShowInvisiblesSync(
  viewRef: MutableRefObject<EditorView | null>,
  showInvisibles: boolean,
): void {
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    runOrQueueCodeMirrorAction(view, () => {
      view.dispatch({
        effects: showInvisiblesCompartment.reconfigure([
          createShowInvisiblesPlugin(showInvisibles),
          showInvisiblesTheme,
        ]),
      });
    });
  }, [viewRef, showInvisibles]);
}

/**
 * Combined sync hook for all settings.
 */
export function useSourceEditorSync(config: SyncConfig): void {
  const { viewRef, isInternalChange, content, wordWrap, showBrTags, autoPairEnabled, showLineNumbers, showInvisibles, getCursorInfo, hiddenRef } = config;

  useSourceEditorContentSync(viewRef, isInternalChange, content, getCursorInfo, hiddenRef);
  useSourceEditorWordWrapSync(viewRef, wordWrap);
  useSourceEditorBrVisibilitySync(viewRef, showBrTags);
  useSourceEditorAutoPairSync(viewRef, autoPairEnabled);
  useSourceEditorLineNumbersSync(viewRef, showLineNumbers);
  useSourceEditorShowInvisiblesSync(viewRef, showInvisibles);
}
