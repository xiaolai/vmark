// WI-1A.3 — Markdown format adapter.
//
// Registers .md/.markdown/.mdown/.mkd/.mdx as kind="wysiwyg" pointing at
// the existing markdown rendering surface (Tiptap WYSIWYG + CodeMirror
// source mode + workflow side panels + heading picker).
//
// Per the build order in dev-docs/plans/20260506-multi-format-rebrand.md,
// this WI declares menuPolicy. Source-mode and forcedSourceMode logic
// remain coupled to the existing global stores in this WI; WI-1A.6 will
// migrate them into the adapter as adapter-internal concerns.

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
import { GhaWorkflowSidePanel } from "@/plugins/ghaWorkflowPreview/GhaWorkflowSidePanel";
import { registerFormat } from "../registry";
import type { FormatConfig } from "../types";

/* v8 ignore next 3 -- @preserve React.lazy wrapper; no logic to test */
const SourceEditor = lazy(() =>
  import("@/components/Editor/SourceEditor").then((m) => ({
    default: m.SourceEditor,
  })),
);
/* v8 ignore next 3 -- @preserve React.lazy wrapper; no logic to test */
const WorkflowSidePanel = lazy(() =>
  import("@/plugins/workflowPreview/WorkflowSidePanel").then((m) => ({
    default: m.WorkflowSidePanel,
  })),
);

/**
 * MarkdownEditorSurface — the markdown WYSIWYG rendering surface.
 * Extracted from the Editor.tsx body so the format registry can dispatch
 * it as kind="wysiwyg" without circular reference back through Editor().
 *
 * Behavior is byte-identical to the prior inline rendering. WI-1A.6
 * migrates the global source-mode / forcedSource reads into this surface.
 */
export function MarkdownEditorSurface({ tabId }: { tabId: string }) {
  const globalSourceMode = useUIStore((state) => state.sourceMode);
  /* v8 ignore next 3 -- @preserve tabId is always truthy inside the Editor surface; defensive fallback for null isn't exercised in tests */
  const forcedSource = useLargeFileSessionStore((s) =>
    tabId ? Boolean(s.forcedSourceTabs[tabId]) : false,
  );
  const sourceMode = globalSourceMode || forcedSource;
  // A forced-source tab (large file) must stay single-pane source — entering
  // the split would mount the WYSIWYG preview and parse the whole large doc,
  // defeating the forced-source performance path (Codex audit).
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
  const workflowEnabled = useSettingsStore((s) => s.advanced.workflowEngine);
  const readOnly = useDocumentStore((s) =>
    tabId ? (s.documents[tabId]?.readOnly ?? false) : false,
  );

  // useUnifiedMenuCommands now mounts in Editor.tsx (dispatcher) so menu
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
      {workflowEnabled && (
        <Suspense fallback={null}>
          <WorkflowSidePanel />
        </Suspense>
      )}
      <GhaWorkflowSidePanel />
      <HeadingPicker />
      <DropZoneIndicator />
    </div>
  );
}

export const markdownFormat: FormatConfig = {
  id: "markdown",
  nameI18nKey: "format.markdown",
  extensions: ["md", "markdown", "mdown", "mkd", "mdx"],
  kind: "wysiwyg",
  wysiwygComponent: MarkdownEditorSurface,
  adapters: {
    saveDialogFilters: [
      { name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd", "mdx"] },
    ],
    untitledExtension: "md",
    exportEnabled: true,
    findEnabled: true,
    searchAdapter: "tiptap",
    contentSearchIndexed: true,
    readOnlyDefault: false,
    reloadPolicy: "reload",
    menuPolicy: {
      sourceWysiwygToggle: true,
      cjkFormatActions: true,
      insertBlockActions: true,
      paragraphFormatting: true,
    },
    closeSavePolicy: "markdown-default",
  },
};

export function registerMarkdownFormat(): void {
  registerFormat(markdownFormat);
}
