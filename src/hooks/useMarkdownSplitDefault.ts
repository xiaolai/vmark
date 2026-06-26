/**
 * useMarkdownSplitDefault — seed the live markdown split view from the
 * persisted `markdown.splitViewByDefault` preference, once per document-window
 * mount. The Settings dialog edits the persisted default; the palette/menu
 * command toggles the live `uiStore.markdownSplitView` for the session.
 *
 * @coordinates-with stores/settingsStore — markdown.splitViewByDefault
 * @coordinates-with stores/uiStore — markdownSplitView (live)
 * @module hooks/useMarkdownSplitDefault
 */
import { useEffect } from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUIStore } from "@/stores/uiStore";

export function useMarkdownSplitDefault(): void {
  useEffect(() => {
    const def = useSettingsStore.getState().markdown.splitViewByDefault;
    useUIStore.getState().setMarkdownSplitView(def);
  }, []);
}
