/**
 * MCP Bridge Hook (Re-export)
 *
 * Purpose: Re-exports useMcpBridge from the modular mcpBridge/ directory.
 *   The actual implementation is split across ~18 handler modules.
 *
 * @coordinates-with mcpBridge/index.ts — central dispatcher
 * @module hooks/useMcpBridge
 */

export { useMcpBridge } from "./mcpBridge";
