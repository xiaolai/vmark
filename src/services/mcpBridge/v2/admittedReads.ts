/**
 * Admitted reads — the reads an MCP edit consumes as its inputs, detached
 * from its connection's read set when the request is admitted.
 *
 * Key decisions:
 *   - Detached synchronously at admission, before the request's first
 *     await: a read the client makes while the edit is guarded, prepared or
 *     saving belongs to its next write, never to this one.
 *   - An edit that applied (`consumed`) keeps the batch: a saving edit hands
 *     it to its save (`saveTabForBridge`'s `reads`), whose capture records
 *     it; an edit that does not save drops it, so reads that fed one
 *     document's buffer are never recorded as the inputs of a later,
 *     unrelated write. An edit that applied nothing gives it back
 *     (`restoreMcpReads`) for the client's next write.
 *
 * @coordinates-with services/coherence/mcpReads.ts — detach and restore
 * @coordinates-with journaledEdit.ts — marks the batch consumed once the edit applied
 * @module services/mcpBridge/v2/admittedReads
 */

import { detachMcpReads, restoreMcpReads, type McpReadBatch } from "@/services/coherence/mcpCapture";
import type { McpWriteContext } from "@/services/mcpBridge/writeContext";

export interface AdmittedReads {
  readonly batch: McpReadBatch;
  /** The edit applied: the batch is its inputs and is never given back. */
  consumed: boolean;
}

/**
 * Run an edit request with its client's reads detached now; they are given
 * back when `run` settles (or throws) without marking them consumed.
 */
export async function withAdmittedReads(
  context: McpWriteContext,
  run: (reads: AdmittedReads) => Promise<void>,
): Promise<void> {
  const reads: AdmittedReads = { batch: detachMcpReads(context.attribution.connectionId), consumed: false };
  try {
    await run(reads);
  } finally {
    if (!reads.consumed) restoreMcpReads(reads.batch);
  }
}
