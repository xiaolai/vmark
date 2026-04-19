/**
 * Document State Selectors
 *
 * Purpose: Convenience hooks that combine window context + tab store + document
 *   store into simple per-component selectors — avoids repeating the
 *   windowLabel → activeTabId → document lookup chain everywhere.
 *
 * Key decisions:
 *   - Each hook returns a single value (content, filePath, isDirty, etc.)
 *   - All hooks derive from useActiveTabId() for consistent window scoping
 *   - Safe defaults (empty string, null, false) when tab or document is missing
 *
 * @coordinates-with documentStore.ts — reads document state per tab
 * @coordinates-with tabStore.ts — reads activeTabId per window
 * @module hooks/useDocumentState
 */

import { useCallback } from "react";
import { useWindowLabel } from "../contexts/WindowContext";
import { useDocumentStore, type CursorInfo } from "../stores/documentStore";
import { useTabStore } from "../stores/tabStore";

/** Hook that returns the active tab ID for the current window, or null if none. */
export function useActiveTabId(): string | null {
  const windowLabel = useWindowLabel();
  return useTabStore((state) => state.activeTabId[windowLabel] ?? null);
}

/** Hook that returns the markdown content of the active tab's document. */
export function useDocumentContent(): string {
  const tabId = useActiveTabId();
  return useDocumentStore((state) => (tabId ? state.documents[tabId]?.content : "") ?? "");
}

/** Hook that returns the file path of the active tab's document, or null if untitled. */
export function useDocumentFilePath(): string | null {
  const tabId = useActiveTabId();
  return useDocumentStore((state) => (tabId ? state.documents[tabId]?.filePath : null) ?? null);
}

/** Hook that returns whether the active tab's document has unsaved changes. */
export function useDocumentIsDirty(): boolean {
  const tabId = useActiveTabId();
  return useDocumentStore((state) => (tabId ? state.documents[tabId]?.isDirty : false) ?? false);
}

/** Hook that returns whether the active tab's file has been deleted from disk. */
export function useDocumentIsMissing(): boolean {
  const tabId = useActiveTabId();
  return useDocumentStore((state) => (tabId ? state.documents[tabId]?.isMissing : false) ?? false);
}

/** Hook that returns whether the active tab's document diverged from the on-disk version. */
export function useDocumentIsDivergent(): boolean {
  const tabId = useActiveTabId();
  return useDocumentStore((state) => (tabId ? state.documents[tabId]?.isDivergent : false) ?? false);
}

/** Hook that returns the numeric document ID of the active tab (0 if none). */
export function useDocumentId(): number {
  const tabId = useActiveTabId();
  return useDocumentStore((state) => (tabId ? state.documents[tabId]?.documentId : 0) ?? 0);
}

/** Hook that returns the cursor position info of the active tab's editor. */
export function useDocumentCursorInfo(): CursorInfo | null {
  const tabId = useActiveTabId();
  return useDocumentStore((state) => (tabId ? state.documents[tabId]?.cursorInfo : null) ?? null);
}

/** Hook that returns the currently selected text of the active tab's editor (empty when no selection). */
export function useDocumentSelectedText(): string {
  const tabId = useActiveTabId();
  return useDocumentStore((state) => (tabId ? state.documents[tabId]?.selectedText : "") ?? "");
}

/** Hook that returns the timestamp of the last auto-save for the active tab. */
export function useDocumentLastAutoSave(): number | null {
  const tabId = useActiveTabId();
  return useDocumentStore(
    (state) => (tabId ? state.documents[tabId]?.lastAutoSave : null) ?? null
  );
}

/** Hook that returns memoized actions (setContent, loadContent, markSaved, etc.) scoped to the active tab. */
export function useDocumentActions() {
  const windowLabel = useWindowLabel();

  // Get active tab ID at call time
  const getActiveTabId = useCallback(
    () => useTabStore.getState().activeTabId[windowLabel] ?? null,
    [windowLabel]
  );

  // Get fresh content (useful in async callbacks where hook value may be stale)
  const getContent = useCallback(() => {
    const tabId = getActiveTabId();
    if (!tabId) return "";
    return useDocumentStore.getState().documents[tabId]?.content ?? "";
  }, [getActiveTabId]);

  const setContent = useCallback(
    (content: string) => {
      const tabId = getActiveTabId();
      if (tabId) {
        useDocumentStore.getState().setContent(tabId, content);
      }
    },
    [getActiveTabId]
  );

  const loadContent = useCallback(
    (content: string, filePath?: string | null) => {
      const tabId = getActiveTabId();
      if (tabId) {
        useDocumentStore.getState().loadContent(tabId, content, filePath);
      }
    },
    [getActiveTabId]
  );

  const setFilePath = useCallback(
    (path: string | null) => {
      const tabId = getActiveTabId();
      if (tabId) {
        useDocumentStore.getState().setFilePath(tabId, path);
        // Also update tab path for title sync
        useTabStore.getState().updateTabPath(tabId, path ?? "");
      }
    },
    [getActiveTabId]
  );

  const markSaved = useCallback(() => {
    const tabId = getActiveTabId();
    if (tabId) {
      useDocumentStore.getState().markSaved(tabId);
    }
  }, [getActiveTabId]);

  const markAutoSaved = useCallback(() => {
    const tabId = getActiveTabId();
    if (tabId) {
      useDocumentStore.getState().markAutoSaved(tabId);
    }
  }, [getActiveTabId]);

  const setCursorInfo = useCallback(
    (info: CursorInfo | null) => {
      const tabId = getActiveTabId();
      if (tabId) {
        useDocumentStore.getState().setCursorInfo(tabId, info);
      }
    },
    [getActiveTabId]
  );

  const setSelectedText = useCallback(
    (text: string) => {
      const tabId = getActiveTabId();
      if (tabId) {
        useDocumentStore.getState().setSelectedText(tabId, text);
      }
    },
    [getActiveTabId]
  );

  return {
    getContent,
    setContent,
    loadContent,
    setFilePath,
    markSaved,
    markAutoSaved,
    setCursorInfo,
    setSelectedText,
  };
}
