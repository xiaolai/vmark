/**
 * useTiptapUnmountFlush
 *
 * Purpose: on unmount, flush pending WYSIWYG content to the store BEFORE
 * cancelling timers/RAFs — keystrokes in the debounce window live only in
 * PM's doc (#755) — then cancel every pending timer/RAF. Extracted verbatim
 * from TiptapEditor.tsx (effect stack split).
 *
 * Every parameter is a React ref: identities are stable across renders, so
 * the dependency array keeps the effect mount-once/cleanup-on-unmount,
 * exactly like the original inline `[]` effect.
 *
 * @coordinates-with components/Editor/TiptapEditor.tsx — sole consumer; owns the refs
 * @module hooks/useTiptapUnmountFlush
 */
import { useEffect, type MutableRefObject } from "react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { tiptapError } from "@/utils/debug";

interface TiptapUnmountFlushRefs {
  pendingRaf: MutableRefObject<number | null>;
  pendingDebounceTimeout: MutableRefObject<number | null>;
  pendingCursorRaf: MutableRefObject<number | null>;
  internalChangeRaf: MutableRefObject<number | null>;
  trackingTimeoutId: MutableRefObject<number | null>;
  cvIdleTimeoutRef: MutableRefObject<number | null>;
  editorRef: MutableRefObject<TiptapEditor | null>;
  flushToStoreRef: MutableRefObject<((editor: TiptapEditor) => void) | null>;
}

/** Flush pending content and cancel pending timers/RAFs on unmount (#755). */
export function useTiptapUnmountFlush({
  pendingRaf,
  pendingDebounceTimeout,
  pendingCursorRaf,
  internalChangeRaf,
  trackingTimeoutId,
  cvIdleTimeoutRef,
  editorRef,
  flushToStoreRef,
}: TiptapUnmountFlushRefs): void {
  // Cleanup pending timers/RAFs on unmount. Flush pending content BEFORE
  // cancelling — keystrokes in the debounce window live only in PM's doc (#755).
  // Reading the LATEST .current values inside the cleanup is deliberate — the
  // flush must use the live editor/flusher at unmount time, not a mount-time
  // snapshot. All deps are refs (stable identities), so the effect still runs
  // exactly once, like the original inline `[]` effect.
  useEffect(() => {
    return () => {
      // Flush directly via this instance's editor: the global flushActiveWysiwygNow()
      // registry was racy — React cleans effects up in reverse registration order, so
      // the flusher deregistration ran first and the flush no-op'd, losing data (#755).
      if ((pendingRaf.current || pendingDebounceTimeout.current) && editorRef.current && flushToStoreRef.current) {
        try {
          // Latest-ref read is the point (#755) — see hook doc comment.
          // eslint-disable-next-line react-hooks/exhaustive-deps
          flushToStoreRef.current(editorRef.current);
        } catch (error) {
          // Surface the failure — a failed final serialization means edits
          // from the debounce window were lost with this unmount.
          tiptapError(" Unmount flush failed; edits in the debounce window may be lost:", error);
        }
      }
      if (pendingRaf.current) {
        cancelAnimationFrame(pendingRaf.current);
        pendingRaf.current = null;
      }
      if (pendingDebounceTimeout.current) {
        clearTimeout(pendingDebounceTimeout.current);
        pendingDebounceTimeout.current = null;
      }
      if (pendingCursorRaf.current) {
        cancelAnimationFrame(pendingCursorRaf.current);
        pendingCursorRaf.current = null;
      }
      if (internalChangeRaf.current) {
        cancelAnimationFrame(internalChangeRaf.current);
        internalChangeRaf.current = null;
      }
      if (trackingTimeoutId.current !== null) {
        window.clearTimeout(trackingTimeoutId.current);
        trackingTimeoutId.current = null;
      }
      if (cvIdleTimeoutRef.current !== null) {
        window.clearTimeout(cvIdleTimeoutRef.current);
        cvIdleTimeoutRef.current = null;
      }
    };
  }, [
    pendingRaf,
    pendingDebounceTimeout,
    pendingCursorRaf,
    internalChangeRaf,
    trackingTimeoutId,
    cvIdleTimeoutRef,
    editorRef,
    flushToStoreRef,
  ]);
}
