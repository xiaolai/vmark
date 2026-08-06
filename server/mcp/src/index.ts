#!/usr/bin/env node
/**
 * VMark MCP Server — pruned tool surface (5 editor tools + browser + coherence).
 *
 * Exposes VMark to AI assistants via the MCP protocol with seven composite
 * tools — `session`, `workspace`, `document`, `workflow`, `selection`,
 * `browser`, `coherence` — multiplexing 34 actions behind their `action`
 * enums. The legacy 60-tool surface was pruned in WI-1.5;
 * `selection.{get,set}` was re-added per ADR-7 after the round-trip cost on
 * large documents proved a real burden.
 * See dev-docs/plans/20260504-mcp-pruning.md for the full rationale.
 *
 * No MCP *resources* are exposed: `session.get_state` returns in one
 * round-trip everything the deleted `vmark://document/*` and
 * `vmark://windows/*` URIs used to provide.
 *
 * Usage:
 *   npx @vmark/mcp-server
 *   node dist/index.js
 *
 * The server communicates with VMark via WebSocket bridge on
 * localhost (port auto-assigned, discovered via port file).
 */

// Re-export public API
export { VMarkMcpServer } from './server.js';
export type { VMarkMcpServerConfig } from './server.js';

// Bridge implementations
export { WebSocketBridge } from './bridge/websocket.js';
export type { WebSocketBridgeConfig, Logger } from './bridge/websocket.js';

// Pruned editor surface plus the embedded browser (selection re-added per ADR-7)
export { registerSessionTool } from './tools/session.js';
export { registerWorkspaceTool } from './tools/workspace.js';
export { registerDocumentTool } from './tools/document.js';
export { registerWorkflowTool } from './tools/workflow.js';
export { registerSelectionTool } from './tools/selection.js';
export { registerBrowserTool } from './tools/browser.js';
export { registerBrowserReadTool } from './tools/browserRead.js';
export { registerCoherenceTool } from './tools/coherence.js';
export { registerCoherenceResolveTool } from './tools/coherenceResolve.js';

export type {
  Bridge,
  BridgeRequest,
  BridgeResponse,
} from './bridge/types.js';

export type {
  ToolDefinition,
  ToolHandler,
  ToolCallResult,
  McpServerInterface,
} from './types.js';

import { VMarkMcpServer } from './server.js';
import { registerSessionTool } from './tools/session.js';
import { registerWorkspaceTool } from './tools/workspace.js';
import { registerDocumentTool } from './tools/document.js';
import { registerWorkflowTool } from './tools/workflow.js';
import { registerSelectionTool } from './tools/selection.js';
import { registerBrowserTool } from './tools/browser.js';
import { registerBrowserReadTool } from './tools/browserRead.js';
import { registerCoherenceTool } from './tools/coherence.js';
import { registerCoherenceResolveTool } from './tools/coherenceResolve.js';
import type { Bridge } from './bridge/types.js';

/**
 * Create a fully configured VMark MCP server with the pruned editor and browser
 * surfaces registered (selection re-added per ADR-7).
 *
 * `options.version` lets the cli thread its VERSION constant through so
 * getServerInfo() reports the real sidecar version instead of the fallback.
 */
export function createVMarkMcpServer(
  bridge: Bridge,
  options?: { version?: string },
): VMarkMcpServer {
  const server = new VMarkMcpServer({ bridge, version: options?.version });

  // Action counts here mirror each tool's `action` enum. Keep them in step —
  // they drifted to 7/5/2 against a real 8/13/5 before the 20260728 audit.
  registerSessionTool(server);   // session (1 action)
  registerWorkspaceTool(server); // workspace (8 actions)
  registerDocumentTool(server);  // document (3 actions)
  registerWorkflowTool(server);  // workflow (2 actions)
  registerSelectionTool(server); // selection (2 actions)
  registerBrowserTool(server);          // browser (8 actions, all mutating)
  registerBrowserReadTool(server);       // browser_read (6 actions, all reads)
  registerCoherenceTool(server);         // coherence (4 actions, all reads)
  registerCoherenceResolveTool(server);  // coherence_resolve (1 action, mutating)

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
      'File and window lifecycle: new, open, open_workspace, save, save_as, close, switch_tab, focus_window (8 actions)',
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
  {
    name: 'Selection',
    description:
      "Read or replace the user's current editor selection — cheap targeted edits on large documents (2 actions)",
    tools: ['selection'],
  },
  {
    name: 'Browser',
    description:
      'Act on the embedded browser tab: act, open, navigate, style, execute_js, session_save, session_load, console_clear — every action mutates and is approval-gated (8 actions)',
    tools: ['browser'],
  },
  {
    name: 'Browser (read-only)',
    description:
      'Observe the embedded browser tab: read, screenshot, query, console, wait, wait_for — nothing is modified, so a client may auto-approve (6 actions)',
    tools: ['browser_read'],
  },
  {
    name: 'Coherence',
    description:
      'Workspace coherence reads: kernel status, the stale/diverged edge breakdown, claims and contexts (4 actions)',
    tools: ['coherence'],
  },
  {
    name: 'Coherence (resolve)',
    description:
      'Resolve a live stale edge — WRITES an audit-logged, non-undoable ledger entry and requires a live delegation grant (1 action)',
    tools: ['coherence_resolve'],
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
