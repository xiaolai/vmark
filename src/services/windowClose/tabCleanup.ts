/**
 * Tab State Cleanup
 *
 * Purpose: free everything keyed by a tab id — document, revision, unified
 *   history, lint, AI suggestions, forced-source flag, pending navigations,
 *   scroll offsets and the surface last shown, save-target claim, agent-journal
 *   bases and window names — when the tab leaves the tab store.
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
 *   - Every step runs even when an earlier one throws, so one failing store
 *     cannot leave the tab's journal state or save windows held; the failure
 *     is rethrown afterwards (an AggregateError when several steps failed).
 *   - The bus subscriber does not let that failure into the removal bus: it
 *     reports it as an uncaught error on a microtask instead, so one tab's
 *     failed cleanup cannot stop a window teardown freeing its later tabs.
 *   - Synchronous. The state is gone before the removing call returns, so no
 *     later re-creation of the same id (an undone move) can be wiped by a
 *     delayed cleanup.
 *
 * @coordinates-with stores/tabRemovalBus.ts — the removal announcement
 * @coordinates-with stores/tabStore.ts — closeTab/detachTab/removeWindow announce
 * @coordinates-with services/runtimeWiring.ts — starts the subscriber with the window
 * @coordinates-with services/agentJournal/documentIdentity.ts — releases the tab's journal state
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
import { releaseTabJournal } from "@/services/agentJournal/documentIdentity";

/**
 * Free all per-tab state for `tabId`. Idempotent.
 *
 * Called by the removal-bus subscriber below; removal sites do not call it.
 */
export function cleanupTabState(tabId: string): void {
  const failures: unknown[] = [];
  const step = (free: () => void) => {
    try {
      free();
    } catch (error) {
      failures.push(error);
    }
  };
  step(() => useDocumentStore.getState().removeDocument(tabId));
  step(() => useRevisionStore.getState().clearRevision(tabId));
  step(() => useUnifiedHistoryStore.getState().clearDocument(tabId));
  step(() => useLintStore.getState().clearDiagnostics(tabId));
  step(() => useAiSuggestionStore.getState().clearForTab(tabId));
  step(() => useLargeFileSessionStore.getState().clearForcedSource(tabId));
  step(() => clearPendingContentSearchNav(tabId));
  step(() => clearPendingLintScroll(tabId));
  step(() => clearEditorScrollOffsets(tabId));
  step(() => forgetShownEditorSurface(tabId));
  step(() => forgetLintTab(tabId));
  // A save still in flight for this tab must not re-point stores that no
  // longer describe an open document.
  step(() => forgetSaveTarget(tabId));
  // Its journal bases go, and its save windows are released in the journal.
  step(() => releaseTabJournal(tabId));
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, `cleanup of tab ${tabId} failed in ${failures.length} steps`);
}

/**
 * Free a tab's state whenever the tab store announces its removal. Returns the
 * disposer that removes exactly this subscription. A cleanup failure goes to
 * `report` (by default: rethrown on a microtask), never into the bus.
 */
export function startTabStateCleanup(report: (error: unknown) => void = reportAsync): () => void {
  return onTabRemoved((_windowLabel, tabId) => {
    // The id still names a live tab in another window: that tab owns the state.
    if (useTabStore.getState().findTabById(tabId)) return;
    // @edge-case: a failing cleanup must not throw into the synchronous
    // removal bus — that would abort `removeWindow` before its later tabs are
    // announced and freed, and silence every later subscriber for this one.
    try {
      cleanupTabState(tabId);
    } catch (error) {
      report(error);
    }
  });
}

/** Surface a cleanup failure as an uncaught error, outside the removal in progress. */
function reportAsync(error: unknown): void {
  queueMicrotask(() => {
    throw error;
  });
}
