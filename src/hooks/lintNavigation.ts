/**
 * Lint Navigation Utilities
 *
 * Purpose: Shared helpers for scrolling the active editor to the currently
 * selected lint diagnostic. Used by both the keyboard shortcut handler and
 * the menu event handler so behaviour stays in sync.
 *
 * @coordinates-with lintStore.ts — reads diagnosticsByTab, selectedIndexByTab
 * @coordinates-with activeEditorStore.ts — reads activeSourceView
 * @coordinates-with editorStore.ts — reads sourceMode
 * @module utils/lintNavigation
 */

import { useLintStore } from "@/stores/lintStore";
import { useActiveEditorStore } from "@/stores/activeEditorStore";
import { useEditorStore } from "@/stores/editorStore";
import { EditorView as CMEditorView } from "@codemirror/view";
import { getCurrentWindowLabel } from "@/utils/workspaceStorage";
import { cleanupBeforeModeSwitch } from "@/utils/modeSwitchCleanup";
import { toggleSourceModeWithCheckpoint } from "@/hooks/useUnifiedHistory";

/**
 * Scroll the active Source mode editor to the currently selected lint diagnostic.
 * In WYSIWYG mode with sourceOnly diagnostics, switch to Source mode first.
 * No-op if no diagnostic is selected or no active editor is available.
 */
export function scrollToSelectedDiagnostic(tabId: string): void {
  const { diagnosticsByTab, selectedIndexByTab } = useLintStore.getState();
  const diagnostics = diagnosticsByTab[tabId];
  if (!diagnostics || diagnostics.length === 0) return;

  const selectedIndex = selectedIndexByTab[tabId] ?? 0;
  const diag = diagnostics[selectedIndex];
  if (!diag) return;

  const { activeSourceView } = useActiveEditorStore.getState();
  const sourceMode = useEditorStore.getState().sourceMode;

  if (activeSourceView && sourceMode && activeSourceView.dom?.isConnected) {
    // Source mode: scroll CodeMirror to the diagnostic offset
    activeSourceView.dispatch({
      effects: CMEditorView.scrollIntoView(
        Math.min(diag.offset, activeSourceView.state.doc.length)
      ),
    });
    return;
  }

  // WYSIWYG mode: if diagnostic is sourceOnly, switch to Source mode
  if (!sourceMode && diag.uiHint === "sourceOnly") {
    const windowLabel = getCurrentWindowLabel();
    cleanupBeforeModeSwitch();
    toggleSourceModeWithCheckpoint(windowLabel);
    // Store pending scroll target so Source editor picks it up on mount
    pendingScrollByTab[tabId] = diag.offset;
  }
  // For non-sourceOnly WYSIWYG diagnostics, the PM decoration already marks
  // the block — no programmatic scroll needed.
}

/** Pending scroll offsets for tabs that switched to Source mode for navigation. */
const pendingScrollByTab: Record<string, number> = {};

/** Clear pending scroll for a tab (called on tab close to prevent leaks). */
export function clearPendingLintScroll(tabId: string): void {
  delete pendingScrollByTab[tabId];
}

/**
 * Consume pending scroll for a tab. Called by Source editor on mount/activation.
 * Returns the offset to scroll to, or undefined if none pending.
 */
export function consumePendingLintScroll(tabId: string): number | undefined {
  const offset = pendingScrollByTab[tabId];
  if (offset !== undefined) {
    delete pendingScrollByTab[tabId];
  }
  return offset;
}
