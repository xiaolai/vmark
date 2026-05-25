import { useDocumentStore } from "@/stores/documentStore";
import { useUnifiedHistoryStore } from "@/stores/documentStore";
import { useLintStore } from "@/stores/documentStore";
import { useAiSuggestionStore } from "@/stores/aiStore";
import { useLargeFileSessionStore } from "@/stores/documentStore";
import { clearPendingContentSearchNav } from "@/hooks/contentSearchNavigation";
import { clearPendingLintScroll } from "@/hooks/lintNavigation";

/**
 * Clean up all per-tab state when a tab is closed or detached.
 * Must be called from ALL close/detach paths to prevent memory leaks.
 */
export function cleanupTabState(tabId: string): void {
  useDocumentStore.getState().removeDocument(tabId);
  useUnifiedHistoryStore.getState().clearDocument(tabId);
  useLintStore.getState().clearDiagnostics(tabId);
  useAiSuggestionStore.getState().clearForTab(tabId);
  useLargeFileSessionStore.getState().clearForcedSource(tabId);
  clearPendingContentSearchNav(tabId);
  clearPendingLintScroll(tabId);
}
