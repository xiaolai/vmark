/**
 * Comment create — open a thread on the reader's selection in a tab: read
 * the selection from the live editor, then send the create through the
 * journaled-mutation coordinator, which records the tab's unsaved text as
 * the person's baseline first.
 *
 * Pipeline: flush the live editors → the selection (`readCommentSelection`:
 * Source offsets, or a WYSIWYG selection mapped exactly by
 * `wysiwygSelectionMap.ts`, else a guess)
 * → capture the tab as a write target (`writeTarget.ts`) → the coordinator
 * (`journaledMutation.ts`) with a freeze that never arms, the create
 * request, and the decision it is answered with.
 *
 * Key decisions:
 *   - A create changes no text: the journal answers with the thread and the
 *     revision it was recorded on, and the coordinator makes that the tab's
 *     basis. It is never answered with a transaction; if it were, the apply
 *     refuses and the coordinator aborts it.
 *   - The selection is located in the text actually sent (`locateSelection`),
 *     so an edit between reading it and sending degrades it to an
 *     approximate anchor rather than a wrong exact one.
 *   - Like a hunk revert, a create never arms an editing epoch: only an
 *     epoch already armed certifies the baseline, else it is a snapshot.
 *
 * @coordinates-with services/agentJournal/journaledMutation.ts — the coordinator
 * @coordinates-with services/agentJournal/comments/commentClient.ts — the create request
 * @coordinates-with services/mcpBridge/v2/selectionSurface.ts — the live selection
 * @coordinates-with services/agentJournal/comments/wysiwygSelectionMap.ts — WYSIWYG offsets in the Markdown
 * @module services/agentJournal/comments/commentCreate
 */

import { useDocumentStore, useRevisionStore } from "@/stores/documentStore";
import { useEditorStore } from "@/stores/editorStore";
import { serializeMarkdown } from "@/utils/markdownPipeline";
import { getSerializeOptions } from "@/plugins/toolbarActions/wysiwygAdapterUtils";
import { flushLiveEditors } from "@/services/mcpBridge/v2/liveEditor";
import { resolveSelectionSurface } from "@/services/mcpBridge/v2/selectionSurface";
import { captureWriteTarget, recheckWriteTarget } from "@/services/mcpBridge/v2/writeTarget";
import type { AbortReason, PreparedTxn } from "../journalClient";
import { JournalRefusal } from "../journalRefusal";
import { runJournaledMutation, type JournaledOutcome } from "../journaledMutation";
import { journalTabLife } from "../documentIdentity";
import { provenanceSessionFor } from "../provenanceSessions";
import { commentCreatePrepare } from "./commentClient";
import type { CommentCreated } from "./commentReplies";
import { locateSelection, type EditorSelection } from "./commentSelection";
import { mapWysiwygSelection } from "./wysiwygSelectionMap";

export type CommentCreateOutcome =
  | { status: "created"; created: CommentCreated }
  | { status: "refused"; refusal: JournalRefusal }
  | { status: "aborted"; reason: AbortReason };

/**
 * The focused editor's selection in the tab `tabId`, or `null` when no
 * editor of the tab can say (none registered, or still mounting). A WYSIWYG
 * selection is mapped onto the Markdown exactly where the round-trip proves
 * it; otherwise it is sent as a guess (see `commentSelection.ts`). Throws
 * when the tab's editor cannot hand its pending edits to the store.
 */
export function readCommentSelection(tabId: string): EditorSelection | null {
  flushLiveEditors(tabId);
  const surface = resolveSelectionSurface(tabId);
  if ("error" in surface || surface.mounting()) return null;
  const { from, to } = surface.range();
  const text = surface.documentText();
  if (surface.mode === "source") return { mode: "markdown", from, to, selected: surface.selectedText(), text };
  const { active } = useEditorStore.getState();
  const editor = active.activeWysiwygTabId === tabId ? active.activeWysiwygEditor : null;
  if (!editor) return null;
  const doc = editor.state.doc;
  const exact = mapWysiwygSelection(doc, from, to, text, (d) => serializeMarkdown(d.type.schema, d, getSerializeOptions()));
  if (exact) return { mode: "markdown", ...exact, selected: text.slice(exact.from, exact.to), text };
  // A guess: proportional to the editor's positions, only a tie-breaker between repeats.
  const size = doc.content.size;
  const estimate = size > 0 ? Math.round((text.length * from) / size) : 0;
  return { mode: "wysiwyg", selected: surface.selectedText(), estimate };
}

const contentOf = (tabId: string): string | undefined => useDocumentStore.getState().documents[tabId]?.content;

/** Open a thread in `tabId` on `selection` with `body`. */
export async function createComment(tabId: string, selection: EditorSelection, body: string): Promise<CommentCreateOutcome> {
  flushLiveEditors(tabId);
  const doc = useDocumentStore.getState().documents[tabId];
  if (!doc) return { status: "aborted", reason: "closed" };
  const life = journalTabLife(tabId);
  const revision = useRevisionStore.getState().getRevision(tabId);
  const target = captureWriteTarget({ tabId, revision, filePath: doc.filePath }, false, doc.content);
  if ("refused" in target) return { status: "aborted", reason: target.refused };
  const session = provenanceSessionFor(tabId);
  const preimage = target.content;
  return runJournaledMutation<null, PreparedTxn, CommentCreateOutcome, CommentCreated>({
    tabId,
    life,
    docKey: target.docKey,
    preimage,
    retryHint: "retry",
    freeze: (buffer) => session?.freezeArmed(buffer) ?? null,
    recheck: () => recheckWriteTarget(target),
    prepare: ({ docKey, parent, observedParent, baselineProvenance, baselineTouched }) =>
      commentCreatePrepare({
        docKey,
        parent,
        ...(observedParent && { observedParent }),
        text: preimage,
        baselineProvenance,
        baselineTouched,
        selection: locateSelection(preimage, selection),
        body,
      }),
    verify: () => "applyRefused",
    apply: () => ({ refused: "applyRefused" }),
    recover: () => contentOf(tabId) ?? preimage,
    outcome: (outcome: JournaledOutcome<null>): CommentCreateOutcome => {
      if (outcome.status === "refused" || outcome.status === "aborted") return outcome;
      return { status: "refused", refusal: new JournalRefusal("JOURNAL_UNAVAILABLE", "the comment create was answered with a transaction") };
    },
    decided: (created) => ({ status: "created", created }),
  });
}
