/**
 * MCP write capture (split from captureFunnel.ts)
 *
 * Purpose: documents an external MCP client read since its last write become
 * the (inferred) input set of that write (spec §7 example 2). `recordMcpRead`
 * notes each read and pins the revision served at read time via
 * `coherence_head`; `captureMcpWrite` consumes the set and funnels the write
 * through `captureWrite`, so it carries the capture-on-save policy like every
 * other write path (WI-LX1.4).
 *
 * Key decisions:
 *   - Reads are tracked PER CONNECTION (the attribution's `connectionId`), so
 *     one client's read never becomes another client's input — not even the
 *     same provider connected twice. The write is recorded under its own
 *     actor (`mcpActor.ts`), never a shared id.
 *   - A closed connection's reads are dropped (`dropMcpConnectionReads`,
 *     driven by the bridge's close event) for good: a late read, or a failed
 *     save giving back its batch, cannot recreate the partition, nor can a
 *     batch detached before the bridge stopped: a batch carries its
 *     connection's lifetime (`mcpConnectionLifetimes.ts`), so the refusal
 *     holds however many closes follow. Should a close be missed, at most
 *     64 connections keep reads — twice the bridge's 32 live connections —
 *     and the one that read least recently is evicted first. A write's
 *     emptied partition is removed, so it does not count.
 *   - Reads are bounded per connection (256, least-recent evicted). A write
 *     DETACHES its connection's whole set synchronously when it is submitted
 *     (the save pipeline's MCP door), or at entry here when nothing did, and
 *     awaits only that batch's pins (bounded 500 ms), so a read arriving
 *     while the write is queued, saving or waiting belongs to the next write
 *     and concurrent writes never share a read. A save that wrote nothing
 *     gives its batch back for the connection's next write.
 *   - The read set lives in `mcpReads.ts`; this module re-exports it.
 *   - Each read is its own entry with a generation; a pin writes only into the
 *     generation it was issued for, so a late or out-of-order answer can never
 *     overwrite a newer read. At most one pin per entry is in flight (a re-read
 *     coalesces) and at most 256 overall — beyond that a read is left
 *     unpinned until its write, which asks again before waiting, so a cap
 *     saturated only at read time does not cost the read. A pin unanswered
 *     after 10 s gives its slot back and its late answer is ignored, so hung
 *     calls cannot starve later reads.
 *   - Each read remembers the workspace root it was served under; a write
 *     under a different root drops it (its revision belongs to another ledger).
 *   - A pin is PROVEN by content (`head_pin.rs`): it sends the
 *     content served, plus the tab's saved content when the buffer was dirty,
 *     and the kernel pins the latest revision on the head's history matching
 *     either. Only a read whose CURRENT generation has a pinned revision is an
 *     input. One matching neither, whose pin was refused, answered null, was
 *     still unanswered when the bounded wait ended, or stayed starved by a
 *     saturated cap is left OUT — an input without a revision would let the
 *     kernel resolve it to the head at write time, a revision the client may
 *     never have seen.
 *   - A write takes its place in the capture queue synchronously and awaits
 *     its pins INSIDE that slot (`pendingInputs`), so a later write or in-app
 *     save can never be recorded ahead of it.
 *
 * @coordinates-with mcpReads.ts — the per-connection read sets and their pins
 * @coordinates-with captureFunnel.ts — `captureWrite`, the one IPC seam
 * @coordinates-with mcpActor.ts — the ledger agent of an MCP write
 * @coordinates-with services/mcpBridge/connectionClosed.ts — drops a closed connection's reads
 * @coordinates-with src-tauri/src/coherence/head_pin.rs — how coherence_head proves a pin
 * @module services/coherence/mcpCapture
 */
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { coherenceLog } from "@/utils/debug";
import type { McpAttribution } from "@/services/mcpBridge/types";
import { mcpCoherenceAgent } from "./mcpActor";
import { captureWrite, workspaceRelativePath, type CoherenceCaptureReceipt } from "./captureFunnel";
import { awaitBatchPins, detachMcpReads, toInputs, type McpReadBatch } from "./mcpReads";

export {
  detachMcpReads,
  dropAllMcpConnectionReads,
  dropMcpConnectionReads,
  mcpRequestLifetime,
  recordMcpRead,
  restoreMcpReads,
  type McpReadBatch,
} from "./mcpReads";

/**
 * Capture an MCP bridge write (document.write / workspace.save) made under
 * `actor`, with that connection's reads as its inputs. Always `inferred` —
 * the external agent's true context is unobservable (G1 finding 2); the
 * session-observed read set is an honest under-approximation.
 */
export async function captureMcpWrite(args: {
  absolutePath: string;
  content: string;
  toolName: string;
  actor: McpAttribution;
  /** The reads this write consumes, detached when it was submitted; when
   *  absent they are detached here, synchronously, before any await. */
  reads?: McpReadBatch;
}): Promise<CoherenceCaptureReceipt | null> {
  try {
    const batch = args.reads ?? detachMcpReads(args.actor.connectionId);
    const root = useWorkspaceStore.getState().rootPath;
    if (!root) return null;
    // The written doc itself is the transformation target, not an input.
    const target = workspaceRelativePath(root, args.absolutePath);
    const pendingInputs = awaitBatchPins(batch).then(() =>
      toInputs(batch, root).filter((i) => i.path !== target)
    );
    // Called with no await before it, so the capture takes its queue slot NOW:
    // a later write (or an in-app save) cannot be recorded ahead of this one
    // while it waits for its pins.
    return await captureWrite({
      absolutePath: args.absolutePath,
      content: args.content,
      pendingInputs,
      agent: mcpCoherenceAgent(args.actor),
      intent: { kind: "mcp-document-write", summary: args.toolName },
      confidence: "inferred",
    });
  } catch (error) {
    coherenceLog("MCP capture failed (write unaffected):", error);
    return null;
  }
}
