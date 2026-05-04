#!/usr/bin/env node
/**
 * VMark MCP Server — pruned 4-tool surface.
 *
 * Exposes VMark to AI assistants via the MCP protocol with four
 * composite tools: `session`, `workspace`, `document`, `workflow`.
 * The legacy 12-tool surface (format/structure/media/table/etc.) was
 * removed in WI-1.5 — see dev-docs/plans/20260504-mcp-pruning.md for
 * the rationale.
 *
 * Usage:
 *   npx @vmark/mcp-server
 *   node dist/index.js
 *
 * The server communicates with VMark via WebSocket bridge on
 * localhost (port auto-assigned, discovered via port file).
 */

// Re-export public API
export {
  VMarkMcpServer,
  resolveWindowId,
  validateNonNegativeInteger,
  getStringArg,
  requireStringArg,
  getNumberArg,
  requireNumberArg,
  getBooleanArg,
  getWindowIdArg,
} from './server.js';
export type { VMarkMcpServerConfig, ToolArgs } from './server.js';

// Bridge implementations
export { WebSocketBridge } from './bridge/websocket.js';
export type { WebSocketBridgeConfig, Logger } from './bridge/websocket.js';

// Pruned 4-tool surface
export { registerSessionTool } from './tools/session.js';
export { registerWorkspaceTool } from './tools/workspace.js';
export { registerDocumentTool } from './tools/document.js';
export { registerWorkflowTool } from './tools/workflow.js';

export type {
  Bridge,
  BridgeRequest,
  BridgeResponse,
  WindowId,
} from './bridge/types.js';

export type {
  ToolDefinition,
  ToolHandler,
  ResourceDefinition,
  ResourceHandler,
  ToolCallResult,
  ResourceReadResult,
  McpServerInterface,
} from './types.js';

import { VMarkMcpServer } from './server.js';
import { registerSessionTool } from './tools/session.js';
import { registerWorkspaceTool } from './tools/workspace.js';
import { registerDocumentTool } from './tools/document.js';
import { registerWorkflowTool } from './tools/workflow.js';
import type { Bridge } from './bridge/types.js';

/**
 * Create a fully configured VMark MCP server with the pruned 4-tool
 * surface registered.
 */
export function createVMarkMcpServer(bridge: Bridge): VMarkMcpServer {
  const server = new VMarkMcpServer({ bridge });

  registerSessionTool(server);   // session (1 action)
  registerWorkspaceTool(server); // workspace (7 actions)
  registerDocumentTool(server);  // document (3 actions)
  registerWorkflowTool(server);  // workflow (2 actions)

  return server;
}

/**
 * Tool category descriptors — used by --health-check.
 */
export const TOOL_CATEGORIES = [
  {
    name: 'Session',
    description:
      'One-shot orientation: discover windows, tabs, and capabilities (1 action)',
    tools: ['session'],
  },
  {
    name: 'Workspace',
    description:
      'File and window lifecycle: new, open, save, save_as, close, switch_tab, focus_window (7 actions)',
    tools: ['workspace'],
  },
  {
    name: 'Document',
    description:
      'Read, write, transform document content. The read/write spine of the surface (3 actions)',
    tools: ['document'],
  },
  {
    name: 'Workflow',
    description:
      'CST-safe IRPatch application + actionlint validation for GitHub Actions YAML (2 actions)',
    tools: ['workflow'],
  },
] as const;

/**
 * Expected tool count — used by --health-check to catch stale builds.
 * Update this number whenever tools are added or removed.
 */
export const EXPECTED_TOOL_COUNT = TOOL_CATEGORIES.reduce(
  (sum, cat) => sum + cat.tools.length,
  0,
);

/**
 * No resources are exposed in the pruned surface. All discovery flows
 * through `vmark.session.get_state`, which gives the AI everything the
 * deleted vmark://document/* and vmark://windows/* resources used to
 * provide — in a single round-trip.
 */
export const RESOURCES = [] as const;
