/**
 * Test helper — a detached MCP read batch as its read SET: every read made
 * under `root`, with the revision pinned for its current read, or
 * `undefined` while none is. What a write captures omits unpinned reads
 * (`toInputs`); tests inspecting which reads a connection still holds need
 * the unpinned ones too. Production consumes reads only through
 * `captureMcpWrite`.
 *
 * @module test/mcpReadInputs
 */

import { toInputs, type McpReadBatch } from "@/services/coherence/mcpReads";

/** `batch`'s reads under `root`, in recording order, each with its pinned revision when it has one. */
export function readInputsOf(batch: McpReadBatch, root: string): Array<{ path: string; revision: string | undefined }> {
  const pinned = new Map(toInputs(batch, root).map((i) => [i.path, i.revision]));
  return batch.reads.filter(([, e]) => e.root === root).map(([, e]) => ({ path: e.rel, revision: pinned.get(e.rel) }));
}
