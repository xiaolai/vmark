/**
 * Source Editor Content Sync Hook
 *
 * Purpose: Syncs external content changes into the CodeMirror editor.
 *
 * Key decisions:
 *   - isInternalChange ref prevents echo loops (editor change → store → editor)
 *   - runOrQueueCodeMirrorAction defers updates during IME composition
 *   - Cheap short-circuit pairs the last-applied content string with the
 *     CodeMirror doc identity, so the O(N) doc.toString() comparison only
 *     runs when either changed
 *   - The current render's `content` prop is authoritative: a payload
 *     deferred during an internal change is never newer than the prop, so
 *     the main effect always applies `content` and drops the pending value
 *   - Deferred external content retries on an on-demand timer armed only
 *     while a payload is pending — idle editors carry no timer
 *
 * @coordinates-with useSourceEditorSync.ts — composes this into the combined hook
 * @module hooks/useSourceEditorContentSync
 */
import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { EditorView } from "@codemirror/view";
import { runOrQueueCodeMirrorAction } from "@/utils/imeGuard";

/** Retry cadence for a deferred external payload (ms). */
const PENDING_RETRY_MS = 100;

/**
 * Replace the editor document with `targetContent` (IME-safe), restoring the
 * cursor to the start on a fresh load with no saved position. Shared by the
 * main sync effect and the pending-retry path so cache bookkeeping and
 * dispatch semantics can never diverge between them.
 */
function applyExternalContent(
  view: EditorView,
  targetContent: string,
  lastAppliedContentRef: MutableRefObject<string | null>,
  lastSyncedDocRef: MutableRefObject<unknown>,
  getCursorInfo?: () => unknown | null,
): void {
  lastAppliedContentRef.current = targetContent;
  runOrQueueCodeMirrorAction(view, () => {
    // Fresh-load eligibility is decided INSIDE the queued action: an IME
    // composition can change the doc between queueing and execution, and
    // cursor-reset behavior must reflect the doc actually being replaced.
    const wasFreshLoad = view.state.doc.length === 0 && targetContent.length > 0;
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length, // fresh value — avoids stale closure during IME
        insert: targetContent,
      },
    });
    // For fresh document load (no saved cursor position), set cursor to start.
    // This handles the case where the editor was created with empty content
    // and actual content was loaded asynchronously.
    if (wasFreshLoad && getCursorInfo && !getCursorInfo()) {
      view.dispatch({
        selection: { anchor: 0 },
        scrollIntoView: true,
      });
    }
    // Record the post-dispatch doc identity so future short-circuits know
    // they are still in sync. Done inside the queued action so it runs
    // after dispatch (which is sync in CM6) regardless of IME queueing.
    lastSyncedDocRef.current = view.state.doc;
  });
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
  // Track the editor's doc identity that lastAppliedContentRef was paired with.
  // CodeMirror docs are immutable — same reference ⇒ contents have not changed.
  // Pairing both refs catches out-of-band doc mutations (plugin transforms,
  // unrelated dispatches) where lastApplied alone would lie.
  const lastSyncedDocRef = useRef<unknown>(null);
  const pendingTimerRef = useRef<number | null>(null);
  // Latest cursor accessor for the retry path (identity may change per render).
  const getCursorInfoRef = useRef(getCursorInfo);
  getCursorInfoRef.current = getCursorInfo;

  // Retry applying a deferred external payload until it lands (or is consumed
  // by the main sync effect). Armed ONLY while a payload is pending — idle
  // editors carry no timer. This replaced a permanent 10 Hz setInterval that
  // ran for the lifetime of every source editor.
  const armPendingRetry = useCallback(
    function retry(): void {
      if (pendingTimerRef.current !== null) return; // already armed
      pendingTimerRef.current = window.setTimeout(() => {
        pendingTimerRef.current = null;
        const targetContent = pendingContentRef.current;
        if (targetContent === null) return; // consumed by the main effect — stop

        const view = viewRef.current;
        if (!view || isInternalChange.current || hiddenRef?.current) {
          retry(); // still blocked — keep the payload, try again
          return;
        }

        pendingContentRef.current = null;
        if (view.state.doc.toString() !== targetContent) {
          applyExternalContent(
            view,
            targetContent,
            lastAppliedContentRef,
            lastSyncedDocRef,
            getCursorInfoRef.current,
          );
        }
      }, PENDING_RETRY_MS);
    },
    [viewRef, isInternalChange, hiddenRef]
  );

  // Disarm on unmount so a pending retry can't fire into a destroyed view.
  useEffect(() => {
    return () => {
      if (pendingTimerRef.current !== null) {
        window.clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    // Skip content sync when hidden — dispatching changes to a hidden CM view
    // pollutes its undo history. Content will be synced on visibility transition.
    if (hiddenRef?.current) return;

    // If internal change is in progress, store content for later
    if (isInternalChange.current) {
      pendingContentRef.current = content;
      armPendingRetry();
      return;
    }

    // This render's `content` is authoritative — any pending payload was
    // captured from an earlier render and can only be as old or older.
    const targetContent = content;
    pendingContentRef.current = null;

    // Cheap short-circuit: same content reference AND same doc identity since
    // we last looked. The doc-identity check guards against out-of-band edits
    // that would invalidate the lastApplied content cache.
    if (
      lastAppliedContentRef.current === targetContent &&
      lastSyncedDocRef.current === view.state.doc
    ) {
      return;
    }

    // Fall back to comparing actual document content (expensive on large docs).
    const currentContent = view.state.doc.toString();
    if (currentContent === targetContent) {
      // Remember both so the next call short-circuits via the cheap path.
      lastAppliedContentRef.current = targetContent;
      lastSyncedDocRef.current = view.state.doc;
      return;
    }

    applyExternalContent(
      view,
      targetContent,
      lastAppliedContentRef,
      lastSyncedDocRef,
      getCursorInfo,
    );
  }, [viewRef, isInternalChange, content, getCursorInfo, hiddenRef, armPendingRetry]);
}
