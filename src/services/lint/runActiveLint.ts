/**
 * runActiveLint — shared "validate / run lint" command.
 *
 * Extracts the live-content extraction → lint dispatch → link-check → refresh →
 * toast flow that was duplicated between the command bus (`lint.check`) and the
 * keyboard-shortcut handler (`useViewShortcuts`). Both paths now call this so
 * they can't drift in YAML routing, link-check merging, or toast wording.
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
import { isYamlFileName } from "@/utils/dropPaths";
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

/**
 * Run lint (and link-check for files with a path) for the active tab and show
 * the result toast. No-op when linting is disabled or no tab is active.
 */
export function runActiveLint(windowLabel: string): void {
  if (!useSettingsStore.getState().markdown.lintEnabled) return;
  const tabId = getActiveTabId(windowLabel);
  if (!tabId) return;

  const content = resolveActiveContent(windowLabel);
  if (content === undefined) return;

  // Snapshot the tab's doc epoch at the moment the content is captured, so
  // the WYSIWYG lint plugin can drop async completions (link check) that
  // finish after the user edits again.
  markLintRunStart(tabId);

  const filePath = getActiveDocument(windowLabel)?.filePath ?? null;
  const isYaml = filePath
    ? isYamlFileName(filePath.split(/[\\/]/).pop() ?? "")
    : false;

  const finalize = (totalCount: number) => {
    triggerLintRefresh();
    if (totalCount === 0) {
      toast.success(i18n.t("statusbar:lint.clean.toast"));
    } else {
      toast.info(i18n.t("dialog:toast.lintFoundIssues", { count: totalCount }));
    }
  };

  if (isYaml) {
    // Format-contributed linter (WI-4.3) — the store no longer needs a
    // per-format action, and a third linted format is a registration.
    const yamlDiags = useLintStore
      .getState()
      .runLintForFormat(tabId, content, filePath);
    finalize(yamlDiags.length);
    return;
  }

  const syncDiagnostics = useLintStore
    .getState()
    .runLintForFormat(tabId, content, filePath);
  triggerLintRefresh();
  // Toast reflects the COMBINED (sync + async link-check) result.
  if (filePath) {
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
  } else {
    finalize(syncDiagnostics.length);
  }
}
