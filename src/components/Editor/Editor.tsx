/**
 * Editor
 *
 * Purpose: Top-level editor container. In WI-1A.3 the markdown rendering surface
 * was extracted into MarkdownEditorSurface (under src/lib/formats/adapters);
 * this file currently delegates rendering to it. WI-1A.5 turns this into a
 * format-registry dispatcher that selects between MarkdownEditorSurface (kind
 * "wysiwyg") and SplitPaneEditor (kinds "split-pane" / "viewer").
 *
 * Key decisions:
 *   - SourceEditor and WorkflowSidePanel are lazy-loaded inside the markdown
 *     adapter so their bundles stay deferred until first markdown mount.
 *   - `keepAlive` setting (in the markdown adapter) keeps both editors mounted
 *     to preserve undo history across mode switches.
 *   - Format dispatch happens once per render via dispatchEditor(); the
 *     registry is the single source of truth for "what does this tab do."
 *
 * @coordinates-with src/lib/formats/adapters/markdown.tsx — MarkdownEditorSurface
 * @coordinates-with src/lib/formats/registry.ts — dispatchEditor (WI-1A.5)
 * @module components/Editor/Editor
 */
import { useActiveTabId } from "@/hooks/useDocumentState";
import { MarkdownEditorSurface } from "@/lib/formats/adapters/markdown";
import "./editor.css";
import "./heading-picker.css";
import "@/styles/popup-shared.css";

/** Top-level editor container. Delegates to the markdown surface today;
 *  WI-1A.5 will route through dispatchEditor() based on the active tab's path. */
export function Editor() {
  const tabId = useActiveTabId();
  /* v8 ignore next -- @preserve tabId always defined inside Editor surface */
  return <MarkdownEditorSurface tabId={tabId ?? ""} />;
}

export default Editor;
