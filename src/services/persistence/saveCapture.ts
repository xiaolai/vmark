/**
 * Purpose: record the provenance of a finished save — exactly ONE coherence
 * capture per write, attributed to whoever asked for it.
 *
 * A manual or automatic save is a human transformation and goes to the human
 * funnel. An AI client's write over the MCP bridge goes to the MCP capture,
 * which records it as inferred, under the client that made it, with the
 * documents THAT client read on its connection as its inputs and the tool as
 * its intent. Deciding that here, inside
 * the pipeline, is what keeps the count at one: when the bridge wrote files
 * itself it also captured for itself, and routing it through the pipeline
 * without this split would have recorded every AI write twice — once as the
 * human's.
 *
 * Key decisions:
 *   - Fire-and-forget. A failed capture never fails the save; scan
 *     reconciliation heals gaps. The trailing catch guards that contract even
 *     if a capture ever throws.
 *   - An MCP write's inputs are the reads its client made before the save
 *     was SUBMITTED (`CaptureOrigin.reads`), not before this capture runs:
 *     a read made while the save waited in the queue or wrote belongs to
 *     the client's next write.
 *   - No setting is read here. Stamping a `vmark:` block into the user's file
 *     and creating `.vmark/` are OPT-IN (`general.coherenceCaptureOnSave`,
 *     default off) — autosave once made that rewrite silent. The setting is
 *     enforced ONCE, by the funnel and the kernel, for every write path; a
 *     gate here covered saves only.
 *
 * @coordinates-with saveToPath.ts — the only caller
 * @coordinates-with services/coherence/captureFunnel.ts — the human funnel
 * @coordinates-with services/coherence/mcpCapture.ts — the MCP capture
 * @module services/persistence/saveCapture
 */
import { captureWrite } from "@/services/coherence/captureFunnel";
import { captureMcpWrite, type McpReadBatch } from "@/services/coherence/mcpCapture";
import type { SaveOrigin } from "./saveOutcome";

/** A save's origin as the pipeline carries it: an MCP save also carries the
 *  client's reads, detached when the save was submitted. */
export type CaptureOrigin =
  | Exclude<SaveOrigin, { saveType: "mcp" }>
  | (Extract<SaveOrigin, { saveType: "mcp" }> & { reads: McpReadBatch });

/** Capture one finished write. `written` is the exact text now on disk. */
export function captureSave(path: string, written: string, origin: CaptureOrigin): void {
  if (origin.saveType === "mcp") {
    void captureMcpWrite({
      absolutePath: path,
      content: written,
      toolName: origin.toolName,
      actor: origin.actor,
      reads: origin.reads,
    }).catch(() => {});
    return;
  }
  void captureWrite({
    absolutePath: path,
    content: written,
    agent: { type: "human" },
    intent: {
      kind: "editor-save",
      summary: origin.saveType === "auto" ? "auto save" : "manual save",
    },
  }).catch(() => {});
}
