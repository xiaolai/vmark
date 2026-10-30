/**
 * runActiveLint — the "Check Markdown" (`lint.check`) flow for the active tab.
 *
 * Live-content extraction → the linter the tab's FORMAT contributes → for a
 * markdown tab with a path, the async local-link check → refresh → toast.
 *
 * Key decisions:
 *   - The format decides. A tab whose format contributes no linter (JSON,
 *     TOML, CSV, plain text, …) is not linted at all, and `activeTabHasLinter`
 *     is the `lint.check` availability predicate, so the command is offered
 *     only where it does something.
 *   - The local-link check is markdown-only: it reads markdown link syntax,
 *     so running it over another format's raw text reports nonsense.
 *
 * @module services/lint/runActiveLint
 */

import { useSettingsStore } from "@/stores/settingsStore";
import { useUIStore } from "@/stores/uiStore";
import { useEditorStore } from "@/stores/editorStore";
import { useLintStore } from "@/stores/documentStore";
import { getActiveDocument, getActiveTabId } from "@/services/navigation/activeDocument";
import { serializeMarkdown } from "@/utils/markdownPipeline";
import { triggerLintRefresh } from "@/plugins/codemirror/sourceLint";
import { markLintRunStart } from "@/plugins/lint/docEpoch";
import { dispatchEditor } from "@/lib/formats/registry";
import type { FormatConfig } from "@/lib/formats/types";
import { imeToast as toast } from "@/services/ime/imeToast";
import { fileOpsError } from "@/utils/debug";
import i18n from "@/i18n";

/**
 * Resolve the freshest editor content for the active tab. Prefers the live
 * editor (CM doc in Source mode, serialized Tiptap otherwise) over the
 * possibly-stale document store, falling back to persisted content.
 */
function resolveActiveContent(windowLabel: string): string | undefined {
  let content: string | undefined;
  const { sourceMode } = useUIStore.getState();
  const { activeSourceView } = useEditorStore.getState().active;

  if (sourceMode && activeSourceView) {
    content = activeSourceView.state.doc.toString();
  } else {
    const tiptapEditor = useEditorStore.getState().tiptap.editor;
    if (tiptapEditor) {
      content = serializeMarkdown(tiptapEditor.state.schema, tiptapEditor.state.doc);
    }
  }

  if (content === undefined) {
    content = getActiveDocument(windowLabel)?.content;
  }
  return content;
}

/** The id of the markdown format, the only one the local-link check reads. */
const MARKDOWN_FORMAT_ID = "markdown";

/** The active tab's format, or null when no tab/document is active. */
function activeFormat(windowLabel: string): { format: FormatConfig; filePath: string | null } | null {
  if (!getActiveTabId(windowLabel)) return null;
  const doc = getActiveDocument(windowLabel);
  if (!doc) return null;
  const filePath = doc.filePath ?? null;
  return { format: dispatchEditor(filePath), filePath };
}

/**
 * Whether the active tab's format contributes a linter — the availability
 * predicate of `lint.check`.
 */
export function activeTabHasLinter(windowLabel: string): boolean {
  return activeFormat(windowLabel)?.format.lint !== undefined;
}

/**
 * Run the active tab's format linter (and, for a markdown file with a path,
 * the local-link check) and show the result toast. No-op when linting is
 * disabled, no tab is active, or the tab's format contributes no linter.
 */
export function runActiveLint(windowLabel: string): void {
  if (!useSettingsStore.getState().markdown.lintEnabled) return;
  const tabId = getActiveTabId(windowLabel);
  if (!tabId) return;
  const target = activeFormat(windowLabel);
  if (!target?.format.lint) return;

  const content = resolveActiveContent(windowLabel);
  if (content === undefined) return;

  // Snapshot the tab's doc epoch at the moment the content is captured, so
  // the WYSIWYG lint plugin can drop async completions (link check) that
  // finish after the user edits again.
  markLintRunStart(tabId);

  const { filePath } = target;
  const finalize = (totalCount: number) => {
    triggerLintRefresh();
    if (totalCount === 0) {
      toast.success(i18n.t("statusbar:lint.clean.toast"));
    } else {
      toast.info(i18n.t("dialog:toast.lintFoundIssues", { count: totalCount }));
    }
  };

  const syncDiagnostics = useLintStore
    .getState()
    .runLintForFormat(tabId, content, filePath);

  if (!filePath || target.format.id !== MARKDOWN_FORMAT_ID) {
    finalize(syncDiagnostics.length);
    return;
  }

  triggerLintRefresh();
  // Toast reflects the COMBINED (sync + async link-check) result.
  // .catch(): a filesystem / link-check rejection must not become an
  // unhandled promise rejection — log it and still finalize with the
  // sync-only count so the user gets feedback.
  void useLintStore
    .getState()
    .runLinkCheck(tabId, content, filePath)
    .then((merged) => finalize(merged.length))
    .catch((error) => {
      fileOpsError("Link check failed during validate:", filePath, error);
      finalize(syncDiagnostics.length);
    });
}
