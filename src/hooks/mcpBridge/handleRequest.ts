/**
 * MCP Bridge — top-level request router.
 *
 * Routes every MCP bridge request to the pruned 4-tool dispatcher
 * (vmark.session/workspace/document/workflow). Unrecognized request
 * types respond with `Unknown request type`.
 *
 * Plan: dev-docs/plans/20260504-mcp-pruning.md (WI-1.5).
 *
 * @coordinates-with utils.ts — respond()
 * @coordinates-with v2/dispatch.ts — dispatchV2
 * @coordinates-with types.ts — McpRequestEvent
 * @module hooks/mcpBridge/handleRequest
 */

import type { McpRequestEvent } from "./types";
import { respond } from "./utils";
import { isActiveDocReadOnly } from "@/utils/readOnlyGuard";
import { dispatchV2 } from "./v2/dispatch";
import { v2ErrorString } from "./v2/types";

const READ_ONLY_BLOCKED = new Set<string>([
  "vmark.document.write",
  "vmark.document.transform",
  "vmark.workflow.apply_patch",
  "vmark.selection.set",
]);

/** Route an MCP request through the v2 dispatcher. */
export async function handleRequest(event: McpRequestEvent): Promise<void> {
  const { id, type } = event;

  if (READ_ONLY_BLOCKED.has(type) && isActiveDocReadOnly()) {
    await respond({
      id,
      success: false,
      error: v2ErrorString({
        error: "READ_ONLY",
        message: "Document is read-only",
      }),
    });
    return;
  }

  try {
    if (await dispatchV2(event)) return;
    await respond({
      id,
      success: false,
      error: `Unknown request type: ${type}`,
    });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
