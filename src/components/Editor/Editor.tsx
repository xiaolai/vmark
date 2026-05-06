/**
 * Editor
 *
 * Purpose: Format-registry dispatcher (WI-1A.5). Reads the active tab's
 *   filePath, calls dispatchEditor() to resolve a FormatConfig, and mounts
 *   either the format's wysiwygComponent (markdown today) or the generic
 *   <SplitPaneEditor> for split-pane / viewer kinds.
 *
 * Pipeline: useActiveTabId → useTabStore.findTabById → dispatchEditor →
 *   FormatConfig.kind === "wysiwyg" ? <wysiwygComponent /> : <SplitPaneEditor />
 *
 * Key decisions:
 *   - Markdown rendering surface lives in src/lib/formats/adapters/markdown.tsx
 *     as MarkdownEditorSurface; this dispatcher pulls the component reference
 *     out of the FormatConfig so the registry is the single source of truth.
 *   - Tab kind change (markdown → txt → json …) triggers an automatic
 *     remount because Tab.formatId is part of editorKey (ADR-10 / WI-1A.12).
 *   - Failure-open: if no tab is active or no format resolves, the dispatcher
 *     falls back to MarkdownEditorSurface so a fresh app start with no tabs
 *     still renders something.
 *
 * @coordinates-with src/lib/formats/registry.ts — dispatchEditor()
 * @coordinates-with src/lib/formats/adapters/markdown.tsx — MarkdownEditorSurface
 * @coordinates-with src/components/Editor/SplitPaneEditor — SplitPaneEditor
 * @module components/Editor/Editor
 */
import { useActiveTabId } from "@/hooks/useDocumentState";
import { useTabStore } from "@/stores/tabStore";
import { dispatchEditor } from "@/lib/formats/registry";
import { MarkdownEditorSurface } from "@/lib/formats/adapters/markdown";
import { SplitPaneEditor } from "./SplitPaneEditor/SplitPaneEditor";
import "./editor.css";
import "./heading-picker.css";
import "@/styles/popup-shared.css";

/** Top-level editor dispatcher. Resolves the active tab's FormatConfig and
 *  mounts the matching surface (wysiwyg or split-pane). */
export function Editor() {
  const tabId = useActiveTabId();
  /* v8 ignore next 4 -- @preserve null-tab fallback path */
  const tab = useTabStore((s) =>
    tabId ? (s.findTabById?.(tabId) ?? null) : null,
  );
  const filePath = tab?.filePath ?? null;
  const formatConfig = dispatchEditor(filePath);

  if (formatConfig.kind === "wysiwyg") {
    /* v8 ignore next -- @preserve markdown surface dispatch — the only kind="wysiwyg" today */
    const Surface = formatConfig.wysiwygComponent ?? MarkdownEditorSurface;
    return <Surface tabId={tabId ?? ""} />;
  }
  return <SplitPaneEditor tabId={tabId ?? ""} formatConfig={formatConfig} />;
}

export default Editor;
