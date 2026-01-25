import { useCallback } from "react";
import { useWindowLabel } from "../contexts/WindowContext";
import { useDocumentStore, type CursorInfo } from "../stores/documentStore";
import { useTabStore } from "../stores/tabStore";

// Get active tab ID for current window
export function useActiveTabId(): string | null {
  const windowLabel = useWindowLabel();
  return useTabStore((state) => state.activeTabId[windowLabel] ?? null);
}

// Tab-scoped selectors (uses active tab for current window)
export function useDocumentContent(): string {
  const tabId = useActiveTabId();
  return useDocumentStore((state) => (tabId ? state.documents[tabId]?.content : "") ?? "");
}

export function useDocumentFilePath(): string | null {
  const tabId = useActiveTabId();
  return useDocumentStore((state) => (tabId ? state.documents[tabId]?.filePath : null) ?? null);
}

export function useDocumentIsDirty(): boolean {
  const tabId = useActiveTabId();
  return useDocumentStore((state) => (tabId ? state.documents[tabId]?.isDirty : false) ?? false);
}

export function useDocumentIsMissing(): boolean {
  const tabId = useActiveTabId();
  return useDocumentStore((state) => (tabId ? state.documents[tabId]?.isMissing : false) ?? false);
}

export function useDocumentIsDivergent(): boolean {
  const tabId = useActiveTabId();
  return useDocumentStore((state) => (tabId ? state.documents[tabId]?.isDivergent : false) ?? false);
}

export function useDocumentId(): number {
  const tabId = useActiveTabId();
  return useDocumentStore((state) => (tabId ? state.documents[tabId]?.documentId : 0) ?? 0);
}

export function useDocumentCursorInfo(): CursorInfo | null {
  const tabId = useActiveTabId();
  return useDocumentStore((state) => (tabId ? state.documents[tabId]?.cursorInfo : null) ?? null);
}

export function useDocumentLastAutoSave(): number | null {
  const tabId = useActiveTabId();
  return useDocumentStore(
    (state) => (tabId ? state.documents[tabId]?.lastAutoSave : null) ?? null
  );
}

// Tab-scoped actions (uses active tab for current window)
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

  return {
    getContent,
    setContent,
    loadContent,
    setFilePath,
    markSaved,
    markAutoSaved,
    setCursorInfo,
  };
}

// Direct tab access for components that need specific tab
export function useTabDocument(tabId: string | null) {
  return useDocumentStore((state) => (tabId ? state.documents[tabId] : null) ?? null);
}
