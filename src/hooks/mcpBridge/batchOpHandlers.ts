/**
 * MCP Bridge — Batch Operation Handlers (barrel).
 *
 * Purpose: Table and list batch operations — insert/delete/modify tables,
 *   modify lists, and bulk operations on structured content.
 *
 * @module hooks/mcpBridge/batchOpHandlers
 */

export { handleTableBatchModify } from "./batchOp/tableHandler";
export { handleListBatchModify } from "./batchOp/listHandler";
