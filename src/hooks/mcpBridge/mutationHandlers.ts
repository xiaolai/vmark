/**
 * MCP Bridge — Mutation Handlers (barrel)
 *
 * Purpose: Re-exports all mutation handler functions from their individual modules.
 *   Each handler lives in its own file for maintainability (~300 lines each).
 *
 * @module hooks/mcpBridge/mutationHandlers
 */

export { handleBatchEdit } from "./batchEditHandler";
export { handleApplyDiff } from "./applyDiffHandler";
export { handleReplaceAnchored } from "./replaceAnchoredHandler";
