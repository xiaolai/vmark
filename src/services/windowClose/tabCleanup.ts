/**
 * Tab State Cleanup
 *
 * Purpose: free everything keyed by a tab id — document, revision, unified
 *   history, lint, AI suggestions, forced-source flag, pending navigations,
 *   scroll offsets, save-target claim — when the tab leaves the tab store.
 *
 * Key decisions:
 *   - Cleanup is a CONSEQUENCE of removal, not a step each removal site
 *     performs. `startTabStateCleanup` subscribes to the tab-removal bus, which
 *     the tab store fires for every way a tab leaves a window (close, detach,
 *     window teardown). A site that removes a tab cannot forget its state, and
 *     a refused close (pinned tab) frees nothing because it announces nothing.
 *   - A tab id still live in some window keeps its state. Per-tab state is
 *     keyed by the id alone, so a tab applied into another window before its
 *     source lets go now owns that state; only the last removal frees it.
 *   - Synchronous. The state is gone before the removing call returns, so no
 *     later re-creation of the same id (an undone move) can be wiped by a
 *     delayed cleanup.
 *
 * @coordinates-with stores/tabRemovalBus.ts — the removal announcement
 * @coordinates-with stores/tabStore.ts — closeTab/detachTab/removeWindow announce
 * @coordinates-with services/runtimeWiring.ts — starts the subscriber with the window
 * @module services/windowClose/tabCleanup
 */
import { useDocumentStore } from "@/stores/documentStore";
import { useUnifiedHistoryStore } from "@/stores/documentStore";
import { useLintStore } from "@/stores/documentStore";
import { useRevisionStore } from "@/stores/documentStore";
import { useAiSuggestionStore } from "@/stores/aiStore";
import { useLargeFileSessionStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { onTabRemoved } from "@/stores/tabRemovalBus";
import { clearPendingContentSearchNav } from "@/services/navigation/contentSearchNavigation";
import { clearPendingLintScroll } from "@/services/lint/lintNavigation";
import { clearEditorScrollOffsets } from "@/services/editor/scrollPosition";
import { forgetShownEditorSurface } from "@/services/editor/restoreChoice";
import { forgetSaveTarget } from "@/services/persistence/saveTargetClaim";
import { forgetLintTab } from "@/plugins/lint/docEpoch";

/**
 * Free all per-tab state for `tabId`. Idempotent.
 *
 * Called by the removal-bus subscriber below; removal sites do not call it.
 */
export function cleanupTabState(tabId: string): void {
  useDocumentStore.getState().removeDocument(tabId);
  useRevisionStore.getState().clearRevision(tabId);
  useUnifiedHistoryStore.getState().clearDocument(tabId);
  useLintStore.getState().clearDiagnostics(tabId);
  useAiSuggestionStore.getState().clearForTab(tabId);
  useLargeFileSessionStore.getState().clearForcedSource(tabId);
  clearPendingContentSearchNav(tabId);
  clearPendingLintScroll(tabId);
  clearEditorScrollOffsets(tabId);
  forgetShownEditorSurface(tabId);
  forgetLintTab(tabId);
  // A save still in flight for this tab must not re-point stores that no
  // longer describe an open document.
  forgetSaveTarget(tabId);
}

/**
 * Free a tab's state whenever the tab store announces its removal. Returns the
 * disposer that removes exactly this subscription.
 */
export function startTabStateCleanup(): () => void {
  return onTabRemoved((_windowLabel, tabId) => {
    // The id still names a live tab in another window: that tab owns the state.
    if (useTabStore.getState().findTabById(tabId)) return;
    cleanupTabState(tabId);
  });
}
