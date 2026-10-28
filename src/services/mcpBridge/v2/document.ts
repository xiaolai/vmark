/**
 * Purpose: `vmark.document.{read, write, transform}` handlers — the read/write spine of the pruned MCP surface.
 *
 *   `read` returns full content + a revision token. `write` replaces
 *   full content (optimistic-concurrency-protected via expected_revision)
 *   AND persists to disk by default — the buffer-vs-disk distinction is
 *   a VMark internal concern that has no business in the AI's reasoning
 *   loop. Set `save: false` to leave changes in-memory only (rare).
 *   `transform` runs the deterministic CJK rewriter — kept because CJK
 *   rules are too nuanced for AI prose to reimplement reliably.
 *
 *   `write` lives in `documentWrite.ts` (re-exported here). `write` and
 *   `transform` go through the agent edit journal's controlled-mutation
 *   protocol (`journaledEdit.ts`) before anything changes, and answer
 *   `applied` + `durable` alongside the fields below.
 *
 * Origin: MCP pruning plan (retired) ADR-1, ADR-2, ADR-4.
 *
 * Key decisions:
 *   - Full-content write, not diff. Correctness first; if large-doc
 *     cost ever proves a real problem, add `apply_diff` later.
 *   - `expected_revision` is optional. If absent, we still allow the
 *     write — useful for greenfield "AI types from scratch" flows. When
 *     present, mismatch returns STALE.
 *   - `transform` operates on the whole document, not a selection.
 *   - `write` saves to disk by default. The previous "buffer-only"
 *     behaviour caused AI agents to bypass MCP and write files directly
 *     when they noticed disk was stale — losing edit history and
 *     setting up race conditions with VMark's eventual auto-save. Save
 *     failure does NOT fail the write: the buffer is updated, the
 *     response carries `saved: false` plus EITHER `save_skipped`
 *     (we didn't attempt — opt-out or untitled tab) OR `save_error`
 *     (we attempted and it was refused or rejected). The two fields are
 *     mutually exclusive so AI clients can branch without parsing free-form
 *     text.
 *   - The save is the app's own save (`bridgeSave.ts`), so the file keeps
 *     its line endings and byte-order mark, the write is atomic and ordered
 *     with every other save, and history and provenance are recorded there.
 *     What is saved is the BUFFER as this write left it — the store's
 *     canonical text, not the raw string the client sent. For the tab the
 *     live WYSIWYG editor is showing, that buffer is the editor's
 *     serialization of the client's text, so disk, store and editor agree
 *     and the reply's `saved` and `revision` stay true after the editor
 *     settles (`liveEditor.ts`).
 *   - Every handler resolves its tab through `tabGuard.ts`, which first
 *     flushes the mounted editors into the store — so it reads, checks and
 *     replaces what the user actually has, pending keystrokes included.
 *   - `write` and `transform` refuse BUSY, changing nothing, while the user
 *     is composing with an input method in the editor showing the tab.
 *
 * @coordinates-with documentWrite.ts — the write handler
 * @coordinates-with journaledEdit.ts — the journal protocol both mutators run
 * @coordinates-with writeAddresses.ts — the `addresses` shape check; the journal checks the set
 * @coordinates-with writeContent.ts — the whole-document replace both mutators use
 * @coordinates-with tabGuard.ts — tab resolution, the flush, INVALID_TAB and STALE
 * @coordinates-with liveEditor.ts — the mounted WYSIWYG editor ↔ store seam
 * @coordinates-with bridgeSave.ts — the path guard and the save pipeline
 * @coordinates-with documentTransform.ts — CJK transform helpers (extracted)
 * @coordinates-with stores/documentStore.ts — content + dirty state
 * @coordinates-with stores/documentStore/revision.ts — the revision token
 * @coordinates-with services/coherence/mcpCapture.ts — MCP read capture, per connection; the write is captured by the save pipeline
 * @module services/mcpBridge/v2/document
 */

import type { McpWriteContext } from "@/services/mcpBridge/writeContext";
import { mcpRequestLifetime, recordMcpRead } from "@/services/coherence/mcpCapture";
import { useDocumentStore, useRevisionStore } from "@/stores/documentStore";
import { respond } from "@/services/mcpBridge/utils";
import { wrapHandler } from "./wrapHandler";
import { writeContent } from "./writeContent";
import { runJournaledEdit } from "./journaledEdit";
import { withAdmittedReads } from "./admittedReads";
import { liveCompositionRefusal, recoverLiveWysiwyg } from "./liveEditor";
import { readOperationArgs, readOperationArgsChecked } from "./readOperationArgs";
import { requireWriteArgs } from "./writeAddresses";
import { requireCurrentRevision, requireTab, resolveTab, structuredError } from "./tabGuard";
import {
  applyTransform,
  currentTransformSettings,
  isTransformKind,
  TRANSFORM_KINDS,
} from "./documentTransform";

export { handleDocumentWrite } from "./documentWrite";

/**
 * Handle `vmark.document.read`. Args: `{tabId?: string}`.
 *
 * `context` names the reading client: the read is tracked on ITS connection,
 * so it becomes an input of that client's next write and of no other's.
 */
export async function handleDocumentRead(
  id: string,
  args: Record<string, unknown>,
  context: McpWriteContext,
): Promise<void> {
  const { connectionId } = context.attribution;
  // Taken first: a close or bridge stop from here on refuses the read.
  const lifetime = mcpRequestLifetime(connectionId);
  return wrapHandler(id, async () => {
    const wire = readOperationArgs("vmark.document.read", args);
    // Resolved synchronously, not through the awaiting `requireTab`: the
    // snapshot, its revision and the read's record share one task, so no
    // save or workspace switch can land between the content served and the
    // root and saved base it is recorded with.
    const tab = resolveTab(wire.tabId);
    if ("error" in tab) return structuredError(id, tab);
    const revision = useRevisionStore.getState().getRevision(tab.tabId);
    // Coherence: a read whose response is attempted joins the next write's
    // inputs on the same connection, pinned to the content served. Read
    // inputs are inferred from responses attempted for this connection; they
    // prove neither receipt nor use. It is recorded BEFORE the response goes
    // out, and a bridge stop or connection close that lands while the
    // response is in flight drops the read instead of missing it. `respond`
    // never throws, so the read is still recorded only for an attempted
    // response.
    if (tab.filePath) {
      recordMcpRead(connectionId, tab.filePath, tab.content, tab.tabId, lifetime);
    }
    await respond({
      id,
      success: true,
      data: {
        content: tab.content,
        revision,
        filePath: tab.filePath,
        kind: tab.kind,
        dirty: tab.dirty,
      },
    });
  });
}

/**
 * Handle `vmark.document.transform`.
 *
 * Args: `{tabId?, kind: "cjk-format" | "cjk-spacing" | "cjk-punctuation",
 * expected_revision?, addresses?}`.
 *
 * Runs through the edit journal's controlled-mutation protocol
 * (`journaledEdit.ts`) and answers `applied` + `durable`; `context` is the
 * revision's actor. A transform that changes nothing journals nothing.
 */
export async function handleDocumentTransform(
  id: string,
  args: Record<string, unknown>,
  context: McpWriteContext,
): Promise<void> {
  return wrapHandler(id, () => withAdmittedReads(context, async (reads) => {
    const checked = readOperationArgsChecked("vmark.document.transform", args);
    const { wire } = checked;
    const addressed = await requireWriteArgs(id, checked);
    if (!addressed) return;
    const { kind } = wire;
    if (!isTransformKind(kind)) {
      await structuredError(id, {
        error: "INTERNAL",
        message: `kind must be one of: ${TRANSFORM_KINDS.join(", ")}`,
      });
      return;
    }

    const tab = await requireTab(id, wire.tabId);
    if (!tab || !(await requireCurrentRevision(id, tab.tabId, wire.expected_revision))) return;

    const revisionBefore = useRevisionStore.getState().getRevision(tab.tabId);
    const transformed = applyTransform(kind, tab.content, currentTransformSettings());
    if (transformed === tab.content) {
      await respond({ id, success: true, data: { revision: revisionBefore } });
      return;
    }

    const busy = liveCompositionRefusal(tab.tabId);
    if (busy) {
      await structuredError(id, busy);
      return;
    }
    const outcome = await runJournaledEdit(id, {
      tab,
      preimage: tab.content,
      requireFocus: !wire.tabId,
      tool: "document.transform",
      target: transformed,
      ...addressed,
      context,
      reads,
      apply: () => {
        const result = writeContent(tab.tabId, transformed, tab.kind);
        if ("error" in result) return { refused: result.error === "INVALID_TAB" ? ("closed" as const) : ("composing" as const) };
        const buffer = useDocumentStore.getState().documents[tab.tabId]?.content ?? transformed;
        return { postimage: buffer, value: result.revision };
      },
      recover: () => recoverLiveWysiwyg(tab.tabId),
    });
    if (!outcome) return;
    await respond({
      id,
      success: true,
      data: { revision: outcome.value, applied: true, durable: outcome.durable },
    });
  }));
}
