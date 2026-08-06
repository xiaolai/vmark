/**
 * MarkdownEditorSurface — the markdown WYSIWYG rendering surface.
 *
 * Purpose: the component the markdown adapter's `wysiwygComponent` thunk
 *   loads. Split out of `markdown.tsx` by WI-13: the adapter module is
 *   evaluated by `bootstrapFormats()` in EVERY window before
 *   `import("./App")`, so keeping the surface in it meant Settings and
 *   PDF-export windows statically imported Tiptap + the CodeMirror markdown
 *   pack at cold start. Behavior is unchanged — only the module boundary
 *   moved, and with it the whole WYSIWYG chunk off the cold-start graph.
 *
 *   Extracted from the Editor.tsx body originally (WI-1A.3) so the format
 *   registry could dispatch it as kind="wysiwyg" without a circular reference
 *   back through Editor().
 *
 * Key decisions:
 *   - Named export only. The adapter's thunk maps it to `{ default }` at the
 *     import site (`.then((m) => ({ default: m.MarkdownEditorSurface }))`),
 *     which is the shape React.lazy wants and the convention every other lazy
 *     boundary here already uses. Exporting the same component twice reads as
 *     duplicate dead code to knip, and it is.
 *   - A forced-source tab (large file) stays single-pane source — entering the
 *     split would mount the WYSIWYG preview and parse the whole large doc,
 *     defeating the forced-source performance path (Codex audit).
 *
 * @coordinates-with lib/formats/adapters/markdown.tsx — declares the thunk that loads this
 * @coordinates-with components/Editor/FormatSurface.tsx — mounts it behind Suspense
 * @module lib/formats/adapters/markdownSurface
 */
import { lazy, Suspense } from "react";
import { useUIStore } from "@/stores/uiStore";
import { useLargeFileSessionStore } from "@/stores/documentStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useDocumentId } from "@/hooks/useDocumentState";
import { TiptapEditorInner } from "@/components/Editor/TiptapEditor";
import { MarkdownSplitView } from "@/components/Editor/MarkdownSplitView";
import { HeadingPicker } from "@/components/Editor/HeadingPicker";
import { DropZoneIndicator } from "@/components/Editor/DropZoneIndicator";
// WI-19: the engine flag and its lazy panel live behind this slot, which has a
// test. The surface no longer knows the workflow engine exists.
import { WorkflowEngineSlot } from "@/components/Editor/WorkflowPanel/WorkflowEngineSlot";

/* v8 ignore next 3 -- @preserve React.lazy wrapper; no logic to test */
const SourceEditor = lazy(() =>
  import("@/components/Editor/SourceEditor").then((m) => ({
    default: m.SourceEditor,
  })),
);

export function MarkdownEditorSurface({ tabId }: { tabId: string }) {
  const globalSourceMode = useUIStore((state) => state.sourceMode);
  /* v8 ignore next 3 -- @preserve tabId is always truthy inside the Editor surface; defensive fallback for null isn't exercised in tests */
  const forcedSource = useLargeFileSessionStore((s) =>
    tabId ? Boolean(s.forcedSourceTabs[tabId]) : false,
  );
  const sourceMode = globalSourceMode || forcedSource;
  const splitView = useUIStore((state) => state.markdownSplitView) && !forcedSource;
  const documentId = useDocumentId();
  const mediaBorderStyle = useSettingsStore((s) => s.markdown.mediaBorderStyle);
  const mediaAlignment = useSettingsStore((s) => s.markdown.mediaAlignment);
  const headingAlignment = useSettingsStore((s) => s.markdown.headingAlignment);
  const htmlRenderingMode = useSettingsStore(
    (s) => s.markdown.htmlRenderingMode,
  );
  const tableFitToWidth = useSettingsStore((s) => s.markdown.tableFitToWidth);
  const keepAlive = useSettingsStore((s) => s.advanced.keepBothEditorsAlive);
  const readOnly = useDocumentStore((s) =>
    tabId ? (s.documents[tabId]?.readOnly ?? false) : false,
  );

  // useUnifiedMenuCommands mounts in Editor.tsx (dispatcher) so menu
  // events reach both markdown and non-markdown surfaces.

  const editorKey = `${tabId}-doc-${documentId}`;
  /* v8 ignore next -- @preserve tableFitToWidth conditional class appended at runtime */
  const containerClass = `editor-container media-border-${mediaBorderStyle} media-align-${mediaAlignment} heading-align-${headingAlignment}${tableFitToWidth ? " table-fit-to-width" : ""}`;
  /* v8 ignore next -- @preserve view-mode ternary branches require mode toggle */
  const activeEditor = splitView ? "split" : sourceMode ? "source" : "wysiwyg";
  /* v8 ignore next 18 -- @preserve split / keepAlive / sourceMode branches require view toggles + advanced settings */
  // Split view (opt-in): editable source pane + live read-only WYSIWYG preview.
  // The preview registers no active editor, so formatting targets the source.
  // Distinct keys are required when both editors mount side-by-side — React
  // keys siblings at the same level, so a shared key reuses elements wrongly.
  const editorContent = splitView ? (
    <MarkdownSplitView
      source={
        <Suspense fallback={null}>
          <SourceEditor key={`${editorKey}-source`} readOnly={readOnly} />
        </Suspense>
      }
      preview={<TiptapEditorInner key={`${editorKey}-preview`} readOnly preview />}
    />
  ) : keepAlive ? (
    <>
      <Suspense fallback={null}>
        <SourceEditor key={`${editorKey}-source`} hidden={!sourceMode} readOnly={readOnly} />
      </Suspense>
      <TiptapEditorInner key={`${editorKey}-wysiwyg`} hidden={sourceMode} readOnly={readOnly} />
    </>
  ) : sourceMode ? (
    <Suspense fallback={null}>
      <SourceEditor key={`${editorKey}-source`} readOnly={readOnly} />
    </Suspense>
  ) : (
    <TiptapEditorInner key={`${editorKey}-wysiwyg`} readOnly={readOnly} />
  );

  return (
    <div className={containerClass} data-html-rendering-mode={htmlRenderingMode}>
      <div className="editor-content" data-active-editor={activeEditor}>
        {editorContent}
      </div>
      <WorkflowEngineSlot />
      <HeadingPicker />
      <DropZoneIndicator />
    </div>
  );
}
