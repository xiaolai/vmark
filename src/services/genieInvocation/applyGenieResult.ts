/**
 * applyGenieResult — what happens to a genie run's finished text.
 *
 * Split out of `streamRunner.ts` (file-size gate) at its natural seam: that
 * module drives the STREAM — lock, listener, invoke — and this one decides
 * where the terminal result may be written.
 *
 * Three refusals live here, each a defect the audit named, and all three take
 * the SAME fallback the stale-target guard already used — keep the result as a
 * suggestion against the originating tab, so it is never lost and never
 * written blind:
 *   - the registered editor is not the one showing the originating tab (#963),
 *   - the originating document is read-only (#964),
 *   - the document changed under the captured range mid-stream (#965).
 *
 * @coordinates-with streamRunner.ts — the only consumer; owns RunContext
 * @coordinates-with stores/aiStore/suggestion.ts — where a refused result goes
 * @module services/genieInvocation/applyGenieResult
 */

import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import i18n from "@/i18n";
import type { GenieAction } from "@/types/aiGenies";
import { useAiSuggestionStore, useAiInvocationStore } from "@/stores/aiStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useEditorStore } from "@/stores/editorStore";
import { captureAiEdit } from "@/services/coherence/captureFunnel";
import { useGeniePickerStore } from "@/stores/geniePickerStore";
import { createMarkdownPasteSlice } from "@/plugins/markdownPaste/tiptap";
import type { ExtractionResult } from "./extraction";
import { failInvocation, type ApplyOutcome, type RunContext } from "./streamRunnerContext";

/**
 * Suggestion payload shared by BOTH suggestion paths (auto-approve with a
 * mid-stream tab switch, and the normal preview flow) — single builder so
 * the two cannot drift.
 */
function buildSuggestionParams(
  tabId: string,
  action: GenieAction,
  extraction: ExtractionResult,
  content: string,
): Parameters<ReturnType<typeof useAiSuggestionStore.getState>["addSuggestion"]>[0] {
  const isInsert = action === "insert";
  return {
    tabId,
    type: isInsert ? "insert" : "replace",
    from: isInsert ? extraction.to : extraction.from,
    to: extraction.to,
    wholeDoc: !isInsert && (extraction.wholeDoc ?? false),
    newContent: content,
    originalContent: isInsert ? "" : extraction.text,
  };
}

/**
 * The editor that is showing `tabId`, or null (audit #963).
 *
 * `tiptap.editor` is whichever editor registered LAST — with a split pane, or a
 * Source pane holding focus, that is not the editor showing the originating
 * document, and a programmatic dispatch into it edits the wrong file. The
 * active slice is the one that carries the tab it belongs to.
 */
export function editorForTab(tabId: string) {
  const active = useEditorStore.getState().active;
  return active.activeWysiwygTabId === tabId ? active.activeWysiwygEditor : null;
}

/**
 * Auto-approve path: apply the result straight into the live editor.
 *
 * `"suggest"` means the result must NOT be written — the caller then keeps it
 * as a suggestion against the originating tab, the same fallback the
 * stale-target guard already uses.
 */
function applyDirectly(ctx: RunContext, content: string): ApplyOutcome {
  const editor = editorForTab(ctx.tabId);
  if (!editor) {
    failInvocation(i18n.t("dialog:toast.genieEditorUnavailable"), ctx.requestId);
    return "failed";
  }
  const doc = useDocumentStore.getState().getDocument(ctx.tabId);
  // A read-only document refuses the USER's keystrokes, and a programmatic
  // `view.dispatch` walks straight past that (audit #964): ProseMirror's
  // `editable` gates input handlers, not transactions. A read-only duplicate is
  // the copy another window owns for writing, so silently editing it is the
  // worst possible outcome — keep the result as a suggestion instead.
  if (doc?.readOnly) return "suggest";
  // Coherence (WI-1.6): dirty state must be read BEFORE the apply — it
  // decides whether the capture's input revision is exact or inferred.
  const bufferWasDirty = doc?.isDirty ?? false;
  const isInsert = ctx.action === "insert";
  const from = isInsert ? ctx.extraction.to : ctx.extraction.from;
  const to = ctx.extraction.to;
  // The captured range is only meaningful in the document it was taken from
  // (audit #965). A stream can run for minutes, and typing in the SAME tab
  // shifts every position after the edit — applying the old from/to then
  // overwrites unrelated text. Verify the range still holds what was extracted
  // (and, for an insert, that the position still exists) before writing.
  if (!rangeStillMatches(editor, ctx, from, to)) return "suggest";
  const slice = createMarkdownPasteSlice(editor.state, content);
  const tr = editor.state.tr
    .replaceRange(from, to, slice)
    .scrollIntoView()
    .setMeta("addToHistory", true);
  editor.view.dispatch(tr);
  useGeniePickerStore.getState().closePicker();
  useAiInvocationStore.getState().finish(ctx.requestId);
  // Synchronous after dispatch (audit T3): onUpdate has synced the store
  // and captureAiEdit snapshots at entry — no timer race with a second
  // apply or tab switch.
  void captureAiEdit({
    tabId: ctx.tabId,
    intentKind: "genie",
    summary: "genie auto-apply",
    bufferWasDirty,
  }).catch(() => {});
  return "applied";
}

/**
 * Whether the captured range still describes the document it was taken from
 * (audit #965).
 *
 * The extracted text is markdown SERIALIZED from the range, not the raw text at
 * those positions, so it cannot be compared back. What can be compared is the
 * document itself: ProseMirror gives a fresh doc node for every transaction, so
 * an unchanged identity means nothing has moved. A changed one refuses the
 * blind write and the result becomes a suggestion the user reviews.
 *
 * Residual, stated rather than hidden: that suggestion still carries the
 * original positions, so accepting it long after an edit is the same hazard one
 * step further out. Closing it means remapping through the suggestion store,
 * which is `aiStore/suggestion.ts`'s contract, not this module's.
 */
function rangeStillMatches(
  editor: { state: { doc: ProseMirrorNode } },
  ctx: RunContext,
  from: number,
  to: number,
): boolean {
  if (ctx.docAtStart !== null && editor.state.doc !== ctx.docAtStart) return false;
  return from >= 0 && from <= to && to <= editor.state.doc.content.size;
}

/** Keep a result the editor must not receive, scoped to the originating tab. */
function keepAsSuggestion(ctx: RunContext, content: string): void {
  useAiSuggestionStore
    .getState()
    .addSuggestion(buildSuggestionParams(ctx.tabId, ctx.action, ctx.extraction, content));
  useGeniePickerStore.getState().closePicker();
  useAiInvocationStore.getState().finish(ctx.requestId);
}

/** Terminal done-frame: apply, suggest, or error depending on state. */
export function handleStreamDone(ctx: RunContext, accumulated: string): void {
  const content = accumulated.trim();
  if (!content) {
    failInvocation(i18n.t("dialog:toast.genieEmptyResponse"), ctx.requestId);
    return;
  }

  const autoApprove = useSettingsStore.getState().advanced.mcpServer.autoApproveEdits;
  // Stale-target guard (WI-0.9, C4): if the user navigated to a different
  // tab while the stream was arriving, the captured from/to positions belong
  // to the originating doc. Applying them to the now-active editor would
  // corrupt the wrong document. Preserve the result as a suggestion scoped
  // to the originating tab instead.
  const currentTabId = useTabStore.getState().activeTabId[ctx.windowLabel] ?? "unknown";
  const tabSwitched = currentTabId !== ctx.tabId;

  if (autoApprove && tabSwitched) {
    keepAsSuggestion(ctx, content);
  } else if (autoApprove) {
    // Apply directly — skip ghost text preview. A refusal (read-only document,
    // or the text moved under the captured range) takes the SAME fallback the
    // tab-switch guard does, so the result is never lost and never written
    // blind.
    if (applyDirectly(ctx, content) === "suggest") keepAsSuggestion(ctx, content);
  } else {
    // Show preview in picker (don't close)
    useGeniePickerStore.getState().setPreview(content);
    useAiInvocationStore.getState().finish(ctx.requestId);
    // Also create suggestion for when user accepts
    useAiSuggestionStore
      .getState()
      .addSuggestion(buildSuggestionParams(ctx.tabId, ctx.action, ctx.extraction, content));
  }
}

