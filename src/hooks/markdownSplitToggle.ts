/**
 * toggleMarkdownSplitWithCheckpoint — flip the markdown split view, snapshotting
 * current state first so undo can bridge the editor swap (the split remounts the
 * editing surface, just like the source-mode toggle does). Markdown-only view
 * change — no forced-source / doc-mode semantics apply (Codex audit findings 8/9).
 *
 * @coordinates-with stores/uiStore — markdownSplitView toggle
 * @coordinates-with stores/documentStore — unified history checkpoint
 * @module hooks/markdownSplitToggle
 */
import { useUIStore } from "@/stores/uiStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore, useUnifiedHistoryStore } from "@/stores/documentStore";
import { selectSourceEditing } from "@/stores/selectSourceEditing";
import { cleanupBeforeModeSwitch } from "@/services/assembly/modeSwitchCleanup";

export function toggleMarkdownSplitWithCheckpoint(windowLabel: string): void {
  // Flush pending debounced WYSIWYG edits to the store first, so the checkpoint
  // captures current content and the editor swap doesn't drop them (Codex #8).
  cleanupBeforeModeSwitch();
  const ui = useUIStore.getState();
  const tabId = useTabStore.getState().activeTabId[windowLabel];
  const doc = tabId ? useDocumentStore.getState().getDocument(tabId) : null;
  if (tabId && doc) {
    useUnifiedHistoryStore.getState().createCheckpoint(tabId, {
      markdown: doc.content,
      mode: selectSourceEditing(ui) ? "source" : "wysiwyg",
      cursorInfo: doc.cursorInfo ?? null,
    });
  }
  ui.toggleMarkdownSplitView();
}
