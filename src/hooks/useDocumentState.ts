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
 *   - Pane-aware (#1081): inside a split pane, useActiveTabId resolves THAT
 *     pane's tab; outside any pane it resolves the window's focused pane. With
 *     no split open this is just `tabStore.activeTabId[windowLabel]` — single
 *     pane behaves exactly as before.
 *
 * @coordinates-with documentStore.ts — reads document state per tab
 * @coordinates-with tabStore.ts — reads activeTabId, which paneStore keeps as
 *   the focused-pane alias (ADR-1)
 * @coordinates-with contexts/PaneContext.tsx — the pane a subtree renders in
 * @module hooks/useDocumentState
 */

import { useCallback } from "react";
import { useWindowLabel } from "../contexts/WindowContext";
import { usePaneContext } from "../contexts/PaneContext";
import {
  useDocumentStore,
  type CursorInfo,
  type DocumentState,
} from "../stores/documentStore";
import { useTabStore } from "../stores/tabStore";

/**
 * Hook that returns the active tab ID for the current pane/window, or null.
 * Inside a pane (PaneContext), returns that pane's tab; otherwise the window's
 * `activeTabId`, which paneStore keeps as the focused pane's alias (ADR-1).
 */
export function useActiveTabId(): string | null {
  const pane = usePaneContext();
  const windowLabel = useWindowLabel();
  const activeTabId = useTabStore((state) => state.activeTabId[windowLabel] ?? null);
  return pane ? pane.tabId : activeTabId;
}

/**
 * Shared selector core: pick one field from the active tab's document, with a
 * safe fallback when the tab or document is missing.
 */
function useActiveDocumentField<T>(
  pick: (doc: DocumentState) => T | null | undefined,
  fallback: T,
): T {
  const tabId = useActiveTabId();
  return useDocumentStore((state) => {
    const doc = tabId ? state.documents[tabId] : undefined;
    return (doc ? pick(doc) : fallback) ?? fallback;
  });
}

/** Hook that returns the markdown content of the active tab's document. */
export function useDocumentContent(): string {
  return useActiveDocumentField((doc) => doc.content, "");
}

/** Hook that returns the file path of the active tab's document, or null if untitled. */
export function useDocumentFilePath(): string | null {
  return useActiveDocumentField((doc) => doc.filePath, null);
}

/** Hook that returns whether the active tab's document has unsaved changes. */
export function useDocumentIsDirty(): boolean {
  return useActiveDocumentField((doc) => doc.isDirty, false);
}

/** Hook that returns whether the active tab's file has been deleted from disk. */
export function useDocumentIsMissing(): boolean {
  return useActiveDocumentField((doc) => doc.isMissing, false);
}

/** Hook that returns whether the active tab's document diverged from the on-disk version. */
export function useDocumentIsDivergent(): boolean {
  return useActiveDocumentField((doc) => doc.isDivergent, false);
}

/** Hook that returns the numeric document ID of the active tab (0 if none). */
export function useDocumentId(): number {
  return useActiveDocumentField((doc) => doc.documentId, 0);
}

/** Hook that returns the cursor position info of the active tab's editor. */
export function useDocumentCursorInfo(): CursorInfo | null {
  return useActiveDocumentField<CursorInfo | null>((doc) => doc.cursorInfo, null);
}

/** Hook that returns the currently selected text of the active tab's editor (empty when no selection). */
export function useDocumentSelectedText(): string {
  return useActiveDocumentField((doc) => doc.selectedText, "");
}

/** Hook that returns the timestamp of the last auto-save for the active tab. */
export function useDocumentLastAutoSave(): number | null {
  return useActiveDocumentField<number | null>((doc) => doc.lastAutoSave, null);
}

/**
 * Hook that returns memoized actions (setContent, loadContent, markSaved, etc.)
 * scoped to the active tab — or, when `ownTabId` is given, pinned to that tab.
 *
 * Pass `ownTabId` from any surface that is keyed/remounted per tab (Tiptap and
 * CodeMirror editors). Their debounced/unmount flushes can fire AFTER the
 * focused tab changed; call-time resolution then wrote the old editor's
 * content into the newly focused tab and lost the originating tab's edit
 * (cross-tab content bleed, found by the E2E journey suite).
 */
export function useDocumentActions(ownTabId?: string | null) {
  const windowLabel = useWindowLabel();
  const pane = usePaneContext();
  // Inside a pane the surface is keyed by its tabId (remounts on change), so
  // capturing it here is stable for the surface's lifetime. Outside a pane,
  // resolve the focused pane fresh at call time.
  const inPane = pane !== null;
  const paneTabId = pane?.tabId ?? null;

  // Get the target tab ID: the owning surface's pinned tab, this pane's tab,
  // or (only for non-tab-scoped callers) the focused-pane alias at call time.
  const getActiveTabId = useCallback(() => {
    if (ownTabId) return ownTabId;
    if (inPane) return paneTabId;
    return useTabStore.getState().activeTabId[windowLabel] ?? null;
  }, [ownTabId, windowLabel, inPane, paneTabId]);

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
