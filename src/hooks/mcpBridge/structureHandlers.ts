/**
 * MCP Bridge — Structure Handlers (barrel)
 *
 * Purpose: Re-exports all structure handler functions from their individual modules.
 *   AST/digest handlers live in astHandlers.ts; block/section handlers live in
 *   blockHandlers.ts.
 *
 * @module hooks/mcpBridge/structureHandlers
 */

export { handleGetAst, handleGetDigest } from "./astHandlers";
export { handleListBlocks, handleResolveTargets, handleGetSection } from "./blockHandlers";

// Re-export resetNodeIdCounters for any external consumers
export { resetNodeIdCounters } from "./astHandlers";
