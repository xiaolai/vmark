/**
 * useTiptapFlush
 *
 * Purpose: Serialization/flush machinery for the WYSIWYG editor — owns the
 * PM-doc → markdown → documentStore flush (flushToStore) plus the adaptive
 * debounce scheduling that drives it from onUpdate. Extracted verbatim from
 * TiptapEditor.tsx (effect-stack split); ref identities are created here and
 * shared with the unmount-flush and content-sync hooks by the caller.
 *
 * Key decisions:
 *   - flushToStore marks the write as internal (isInternalChange +
 *     lastExternalContent) so the external-sync effect doesn't round-trip it
 *     back into the editor.
 *   - flushToStoreRef is synced during render by the CALLER so the
 *     unmount-flush cleanup sees the latest flusher even if a passive effect
 *     hasn't run yet (#755).
 *   - scheduleFlush uses RAF for small docs (≤100ms tier) and a debounced
 *     timeout for large docs — see getAdaptiveDebounceDelay.
 *
 * @coordinates-with components/Editor/TiptapEditor.tsx — sole consumer
 * @coordinates-with hooks/useTiptapUnmountFlush.ts — consumes the pending-timer refs
 * @module components/Editor/useTiptapFlush
 */
import { useCallback, useRef } from "react";
import type { MutableRefObject } from "react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { HardBreakStyleOnSave } from "@/utils/linebreakDetection";
import { serializeMarkdown } from "@/utils/markdownPipeline";
import { resolveHardBreakStyle } from "@/utils/linebreaks";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { getAdaptiveDebounceDelay } from "./tiptapEditorHelpers";

interface TiptapFlushOptions {
  /** Tab this editor is pinned to (#1081) — store writes target this tab. */
  activeTabId: string | undefined;
  windowLabel: string;
  setContent: (markdown: string) => void;
  preserveLineBreaksRef: MutableRefObject<boolean>;
  hardBreakStyleOnSaveRef: MutableRefObject<HardBreakStyleOnSave>;
}

export interface TiptapFlushHandle {
  /** True while a store write initiated by this editor is settling. */
  isInternalChange: MutableRefObject<boolean>;
  /** Last markdown value synced either direction (loop-guard for external sync). */
  lastExternalContent: MutableRefObject<string>;
  pendingRaf: MutableRefObject<number | null>;
  pendingDebounceTimeout: MutableRefObject<number | null>;
  internalChangeRaf: MutableRefObject<number | null>;
  /** Serialize the PM doc and push it into the document store NOW. */
  flushToStore: (editor: TiptapEditor) => void;
  /** Latest flushToStore — caller syncs this during render for unmount flush (#755). */
  flushToStoreRef: MutableRefObject<((editor: TiptapEditor) => void) | null>;
  /** Debounced flush used by onUpdate — RAF for small docs, timeout for large. */
  scheduleFlush: (editor: TiptapEditor) => void;
}

/** Owns the WYSIWYG serialize-to-store flush and its adaptive debounce timers. */
export function useTiptapFlush(options: TiptapFlushOptions): TiptapFlushHandle {
  const { activeTabId, windowLabel, setContent, preserveLineBreaksRef, hardBreakStyleOnSaveRef } = options;

  const isInternalChange = useRef(false);
  const lastExternalContent = useRef<string>("");
  const pendingRaf = useRef<number | null>(null);
  const pendingDebounceTimeout = useRef<number | null>(null);
  const internalChangeRaf = useRef<number | null>(null);
  const flushToStoreRef = useRef<((editor: TiptapEditor) => void) | null>(null);

  const flushToStore = useCallback(
    (editor: TiptapEditor) => {
      if (pendingRaf.current) {
        cancelAnimationFrame(pendingRaf.current);
        pendingRaf.current = null;
      }

      const markdown = serializeMarkdown(editor.schema, editor.state.doc, {
        preserveLineBreaks: preserveLineBreaksRef.current,
        hardBreakStyle: (() => {
          const tabId = activeTabId ?? useTabStore.getState().activeTabId[windowLabel];
          /* v8 ignore next -- @preserve reason: no active tabId only if tab store is uninitialized; always set during normal editor lifecycle */
          if (!tabId) return resolveHardBreakStyle("unknown", hardBreakStyleOnSaveRef.current);
          const doc = useDocumentStore.getState().getDocument(tabId);
          /* v8 ignore next -- @preserve reason: doc?.hardBreakStyle ?? fallback only when doc is null; doc always present for active tab */
          return resolveHardBreakStyle(doc?.hardBreakStyle ?? "unknown", hardBreakStyleOnSaveRef.current);
        })(),
      });

      isInternalChange.current = true;
      lastExternalContent.current = markdown;
      setContent(markdown);

      // Cancel previous RAF if pending, then schedule reset
      if (internalChangeRaf.current) {
        cancelAnimationFrame(internalChangeRaf.current);
      }
      internalChangeRaf.current = requestAnimationFrame(() => {
        internalChangeRaf.current = null;
        isInternalChange.current = false;
      });
    },
    [setContent, windowLabel, activeTabId, preserveLineBreaksRef, hardBreakStyleOnSaveRef]
  );

  const scheduleFlush = useCallback(
    (editor: TiptapEditor) => {
      // Cancel any pending flush
      if (pendingRaf.current) {
        cancelAnimationFrame(pendingRaf.current);
        pendingRaf.current = null;
      }
      if (pendingDebounceTimeout.current) {
        clearTimeout(pendingDebounceTimeout.current);
        pendingDebounceTimeout.current = null;
      }

      // Use adaptive delay based on document size
      const docSize = editor.state.doc.content.size;
      const delay = getAdaptiveDebounceDelay(docSize);

      if (delay <= 100) {
        // Small documents: use RAF for immediate updates
        pendingRaf.current = requestAnimationFrame(() => {
          pendingRaf.current = null;
          flushToStore(editor);
        });
      } else {
        // Large documents: use debounced timeout
        pendingDebounceTimeout.current = window.setTimeout(() => {
          pendingDebounceTimeout.current = null;
          flushToStore(editor);
        }, delay);
      }
    },
    [flushToStore]
  );

  return {
    isInternalChange,
    lastExternalContent,
    pendingRaf,
    pendingDebounceTimeout,
    internalChangeRaf,
    flushToStore,
    flushToStoreRef,
    scheduleFlush,
  };
}
