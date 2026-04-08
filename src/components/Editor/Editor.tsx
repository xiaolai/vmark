/**
 * Editor
 *
 * Purpose: Top-level editor container that switches between WYSIWYG (TiptapEditor) and Source
 * (CodeMirror) editing modes.
 *
 * User interactions: Mode switching is driven by editorStore.sourceMode; the user toggles
 * via the status bar button or keyboard shortcut.
 *
 * Key decisions:
 *   - SourceEditor and WorkflowSidePanel are lazy-loaded via React.lazy() so their
 *     bundles (CodeMirror, React Flow) are deferred until first use.
 *   - `keepAlive` setting keeps both editors mounted (hidden) to preserve undo history
 *     across mode switches — at the cost of double memory usage.
 *   - `editorKey` includes both tabId and documentId to force remount on tab switch AND
 *     content reload within the same tab.
 *
 * @coordinates-with SourceEditor.tsx, TiptapEditor.tsx — mounts one or both based on mode
 * @coordinates-with stores/editorStore.ts — reads sourceMode for mode switching
 * @coordinates-with plugins/workflowPreview/WorkflowSidePanel.tsx — renders workflow panel for .yml files
 * @module components/Editor/Editor
 */
import { lazy, Suspense } from "react";
import { useEditorStore } from "@/stores/editorStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useActiveTabId, useDocumentId } from "@/hooks/useDocumentState";
import { useUnifiedMenuCommands } from "@/hooks/useUnifiedMenuCommands";
import { TiptapEditorInner } from "./TiptapEditor";
import { HeadingPicker } from "./HeadingPicker";

/* v8 ignore next 3 -- @preserve React.lazy wrapper; no logic to test */
const SourceEditor = lazy(() =>
  import("./SourceEditor").then((m) => ({ default: m.SourceEditor }))
);
import { DropZoneIndicator } from "./DropZoneIndicator";
/* v8 ignore next 3 -- @preserve React.lazy wrapper; no logic to test */
const WorkflowSidePanel = lazy(() =>
  import("@/plugins/workflowPreview/WorkflowSidePanel").then((m) => ({ default: m.WorkflowSidePanel }))
);
import "./editor.css";
import "./heading-picker.css";
import "@/styles/popup-shared.css";
// Note: katex.min.css is imported in main.tsx for consistent dev/prod cascade order

/** Top-level editor container that switches between WYSIWYG and Source editing modes. */
export function Editor() {
  const sourceMode = useEditorStore((state) => state.sourceMode);
  const tabId = useActiveTabId();
  const documentId = useDocumentId();
  const mediaBorderStyle = useSettingsStore((s) => s.markdown.mediaBorderStyle);
  const mediaAlignment = useSettingsStore((s) => s.markdown.mediaAlignment);
  const headingAlignment = useSettingsStore((s) => s.markdown.headingAlignment);
  const htmlRenderingMode = useSettingsStore((s) => s.markdown.htmlRenderingMode);
  const tableFitToWidth = useSettingsStore((s) => s.markdown.tableFitToWidth);
  const keepAlive = useSettingsStore((s) => s.advanced.keepBothEditorsAlive);
  const workflowEnabled = useSettingsStore((s) => s.advanced.workflowEngine);
  const readOnly = useDocumentStore((s) => tabId ? s.documents[tabId]?.readOnly ?? false : false);
  // lintEnabled not used directly — lint checks the setting at invocation time

  // Mount unified menu dispatcher (handles routing based on mode)
  useUnifiedMenuCommands();

  // Include tabId in key to ensure editor remounts when switching tabs.
  // documentId handles content reloads within the same tab.
  // Note: lintEnabled is NOT in the key — remount would drop unsaved edits.
  // Lint checks the setting at invocation time instead.
  const editorKey = `${tabId}-doc-${documentId}`;
  /* v8 ignore next -- @preserve tableFitToWidth conditional class appended at runtime */
  const containerClass = `editor-container media-border-${mediaBorderStyle} media-align-${mediaAlignment} heading-align-${headingAlignment}${tableFitToWidth ? " table-fit-to-width" : ""}`;
  /* v8 ignore next -- @preserve sourceMode ternary branches require mode toggle */
  const activeEditor = sourceMode ? "source" : "wysiwyg";
  /* v8 ignore next 10 -- @preserve keepAlive and sourceMode ternary branches require advanced settings */
  const editorContent = keepAlive ? (
    <>
      <Suspense fallback={null}>
        <SourceEditor key={editorKey} hidden={!sourceMode} readOnly={readOnly} />
      </Suspense>
      <TiptapEditorInner key={editorKey} hidden={sourceMode} readOnly={readOnly} />
    </>
  ) : (
    sourceMode
      ? <Suspense fallback={null}><SourceEditor key={editorKey} readOnly={readOnly} /></Suspense>
      : <TiptapEditorInner key={editorKey} readOnly={readOnly} />
  );

  return (
    <div
      className={containerClass}
      data-html-rendering-mode={htmlRenderingMode}
    >
      <div className="editor-content" data-active-editor={activeEditor}>
        {editorContent}
      </div>
      {workflowEnabled && <Suspense fallback={null}><WorkflowSidePanel /></Suspense>}
      <HeadingPicker />
      <DropZoneIndicator />
    </div>
  );
}

export default Editor;
