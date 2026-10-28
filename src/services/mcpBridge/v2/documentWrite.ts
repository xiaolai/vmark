/**
 * Document write — `vmark.document.write`: replace a tab's whole document
 * through the agent edit journal's controlled-mutation protocol, then save.
 *
 * Pipeline: guards (tab, revision, IME BUSY, well-formed text) → flush the
 * tab's unsaved provenance → journal prepare (durable; takes the
 * document's reservation and records any unjournaled buffer text as the
 * user's, through the flushed map or as a snapshot-only barrier) →
 * re-verify the tab (`writeTarget.ts`) → apply → settle → journal commit
 * → save.
 *
 * Key decisions:
 *   - Nothing changes unless the journal recorded the intent first. A
 *     refused prepare, or a re-verify that finds the user edited, closed,
 *     composed in or moved the selection of the document meanwhile, answers
 *     an error and leaves store, editor, revision and disk as they were.
 *   - A commit that fails after the apply answers success with
 *     `durable: false`: the content changed, so it is never an error. A
 *     failed append is queued, and the document's next write is refused
 *     `JOURNAL_DEGRADED` until a background retry lands it; a refused
 *     commit ends the transaction `uncommitted`, and the tab keeps its
 *     pre-write basis so the next write records the text as a baseline.
 *   - The parent a prepare states is the journal revision this tab last
 *     learned (`documentIdentity.ts`), so a window that missed another
 *     window's write is refused `STALE_PARENT` instead of recording over it;
 *     the basis is then dropped, and a retry rebases.
 *   - `revision` in the reply stays the bridge's revision token (what
 *     `expected_revision` takes); the journal's revision id is internal.
 *   - The apply is settled as journaled text in the same synchronous step,
 *     so the write's own editor change is never flushed back as a human
 *     edit. A refused commit, or an abort whose prepare recorded a
 *     baseline, settles `null`: what the collector holds no longer
 *     certifies against the journal.
 *   - Save semantics are unchanged: see `document.ts`. A save that ran
 *     reports `journaled` (whether the journal recorded the saved text).
 *     It goes to the path the tab holds when the save starts, so a Save As
 *     that landed during the commit is followed, never undone; a tab closed
 *     (or reopened under the same id) meanwhile is not saved.
 *   - The client's reads are detached at admission (`admittedReads.ts`)
 *     and handed to the save, so a read made while the write is in flight
 *     is the next write's input.
 *
 * @coordinates-with journaledEdit.ts — the protocol run, refusal and abort answers
 * @coordinates-with writeContent.ts — the apply
 * @coordinates-with bridgeSave.ts — the save
 * @module services/mcpBridge/v2/documentWrite
 */

import type { McpWriteContext } from "@/services/mcpBridge/writeContext";
import { respond } from "@/services/mcpBridge/utils";
import { isWellFormedText } from "@/services/agentJournal/wellFormedText";
import { useDocumentStore } from "@/stores/documentStore";
import { wrapHandler } from "./wrapHandler";
import { saveTabForBridge } from "./bridgeSave";
import { liveCompositionRefusal, recoverLiveWysiwyg } from "./liveEditor";
import { readOperationArgsChecked } from "./readOperationArgs";
import { requireWriteArgs } from "./writeAddresses";
import { requireCurrentRevision, requireTab, resolveKind, structuredError } from "./tabGuard";
import { writeContent } from "./writeContent";
import { invalidTextError } from "./journalV2Error";
import { runJournaledEdit } from "./journaledEdit";
import { withAdmittedReads } from "./admittedReads";
import type { Journaled } from "@/services/agentJournal/journalClient";
import type { McpReadBatch } from "@/services/coherence/mcpCapture";
import { isJournalTabLive } from "@/services/agentJournal/documentIdentity";

type SaveResult = {
  saved: boolean;
  journaled?: Journaled;
  save_skipped?: "opt_out" | "untitled";
  save_error?: string;
};

/**
 * Persist the buffer this write produced. `save_skipped` (never tried) and
 * `save_error` (tried and refused or failed) are mutually exclusive.
 */
async function saveAfterWrite(
  tab: { tabId: string },
  buffer: string,
  shouldSave: boolean,
  context: McpWriteContext,
  reads: McpReadBatch,
  life: number,
): Promise<SaveResult> {
  if (!shouldSave) return { saved: false, save_skipped: "opt_out" };
  // The path the tab holds now: a Save As during the journal round trips
  // moved it, and saving to the old path would point the tab back there.
  const live = useDocumentStore.getState().documents[tab.tabId];
  // @edge-case: the tab closed during those round trips — the path it held
  // then names no open document, and writing there could clobber a file the
  // user has since moved on from. Reopened under the same id, it holds
  // another document, whose file this buffer must not overwrite.
  if (!live || !isJournalTabLive(tab.tabId, life)) return { saved: false, save_error: "The tab was closed before its write could be saved" };
  const filePath = live.filePath;
  if (!filePath) return { saved: false, save_skipped: "untitled" };
  // Sampled and submitted with no await between: the save is queued (and the
  // document claimed) before the path guard's round trip.
  const outcome = await saveTabForBridge(tab.tabId, filePath, buffer, "document.write", context, { reads });
  return outcome.saved
    ? { saved: true, journaled: outcome.journaled }
    : { saved: false, save_error: outcome.message };
}

/**
 * Handle `vmark.document.write`.
 *
 * Args: `{tabId?, content: string, expected_revision?: string, save?: boolean,
 * addresses?: string[]}`.
 *
 * `save` defaults to `true`: after the buffer is updated it is saved
 * through the app's save pipeline, which clears the dirty flag. Untitled
 * tabs (no filePath) skip the save with `saved: false` so the AI can decide
 * whether to call `workspace.save_as`. Save failure leaves the buffer
 * updated; the response surfaces `saved: false, save_error` instead of
 * throwing — re-writing on a transient FS error would lose intent.
 *
 * `context` names who is writing (principal, connection, session label):
 * the journal records it as the revision's actor, and the save's
 * provenance capture as the write's.
 */
export async function handleDocumentWrite(
  id: string,
  args: Record<string, unknown>,
  context: McpWriteContext,
): Promise<void> {
  return wrapHandler(id, () => withAdmittedReads(context, async (reads) => {
    const checked = readOperationArgsChecked("vmark.document.write", args);
    const { wire } = checked;
    const addressed = await requireWriteArgs(id, checked);
    if (!addressed) return;
    if (wire.content === undefined) {
      await structuredError(id, { error: "INTERNAL", message: "content must be a string" });
      return;
    }
    const { content } = wire;
    if (!isWellFormedText(content)) {
      await structuredError(id, invalidTextError());
      return;
    }
    const shouldSave = wire.save !== false;

    const tab = await requireTab(id, wire.tabId);
    if (!tab || !(await requireCurrentRevision(id, tab.tabId, wire.expected_revision))) return;
    const busy = liveCompositionRefusal(tab.tabId);
    if (busy) {
      await structuredError(id, busy);
      return;
    }

    const contentBefore = tab.content;
    // Kind follows the INCOMING content: an empty untitled tab reads as
    // Markdown, and workflow YAML must not go through the Markdown parser.
    const writeKind = resolveKind(tab.filePath, content);
    const outcome = await runJournaledEdit(id, {
      tab,
      preimage: contentBefore,
      requireFocus: !wire.tabId,
      tool: "document.write",
      target: content,
      ...addressed,
      context,
      reads,
      apply: () => {
        const result = writeContent(tab.tabId, content, writeKind);
        if ("error" in result) return { refused: result.error === "INVALID_TAB" ? ("closed" as const) : ("composing" as const) };
        // Canonical text, read back before any await: a live WYSIWYG editor
        // re-serializes, and a later request may replace the buffer.
        const buffer = useDocumentStore.getState().documents[tab.tabId]?.content ?? content;
        return { postimage: buffer, value: { revision: result.revision, buffer } };
      },
      recover: () => recoverLiveWysiwyg(tab.tabId),
    });
    if (!outcome) return;

    const { revision, buffer } = outcome.value;
    const save = await saveAfterWrite(tab, buffer, shouldSave, context, reads.batch, outcome.life);
    await respond({
      id,
      success: true,
      data: { revision, applied: true, durable: outcome.durable, ...save },
    });
  }));
}
