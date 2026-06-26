/**
 * selectSourceEditing — markdown is edited via the source surface when in
 * full Source mode OR in the Split view (where the editable pane is the
 * CodeMirror source). Formatting/menu/toolbar dispatch use this so split-view
 * actions target the source pane, not the read-only WYSIWYG preview.
 *
 * The split flag (`markdownSplitView`) is a global UI flag but only renders a
 * split for MARKDOWN tabs, so it must NOT report "source editing" when a
 * non-markdown tab (json/yaml/…) is active — otherwise universal edit/menu
 * actions would be misrouted (Codex audit). We therefore scope its
 * contribution to the active markdown tab.
 *
 * Structural param so it works both as a Zustand selector
 * (`useUIStore(selectSourceEditing)`) and imperatively
 * (`selectSourceEditing(useUIStore.getState())`). The tab lookup reads the
 * current store snapshot; callers re-render on tab switch, so it stays correct.
 *
 * @module stores/selectSourceEditing
 */
import { useTabStore } from "./tabStore";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";

function activeTabIsMarkdown(): boolean {
  const ts = useTabStore.getState();
  const id = ts.activeTabId[getCurrentWindowLabel()];
  return id ? ts.findTabById?.(id)?.formatId === "markdown" : false;
}

export function selectSourceEditing(s: {
  sourceMode: boolean;
  markdownSplitView: boolean;
}): boolean {
  if (s.sourceMode) return true;
  // Split view only applies to markdown — don't treat other formats as source.
  return s.markdownSplitView && activeTabIsMarkdown();
}
