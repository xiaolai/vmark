/**
 * VMark MCP Server — the pruned composite-tool surface.
 *
 * Exposes VMark to AI assistants via the MCP protocol through a small set of
 * composite tools, each multiplexing its actions behind an `action` enum. The
 * tools are declared ONCE, in `TOOL_REGISTRY` below, from the name and action
 * constants each tool module exports: registration, the --health-check
 * descriptors, the per-tool action counts and the expected count all derive
 * from it, and each entry's action list is asserted against the live enum by
 * `__tests__/unit/tools/toolContract.test.ts`. This prose deliberately names
 * no tool and no count — read the registry; every list it used to carry
 * drifted (audit 20260907 #100). The legacy 60-tool surface was pruned in
 * WI-1.5; `selection.{get,set}` was re-added per ADR-7 after the round-trip
 * cost on large documents proved a real burden.
 * See dev-docs/plans/20260504-mcp-pruning.md for the full rationale.
 *
 * No MCP *resources* are exposed: `session.get_state` returns in one
 * round-trip everything the deleted `vmark://document/*` and
 * `vmark://windows/*` URIs used to provide.
 *
 * THIS MODULE IS A LIBRARY, NOT AN ENTRY POINT. It exports the registry, the
 * factory and the types; importing it starts nothing. The executable is
 * `src/cli.ts` — `package.json`'s `bin` maps `vmark-mcp-server` to
 * `dist/cli.js`, and `main` points here for `import`. This file carried a
 * `#!/usr/bin/env node` shebang and documented `node dist/index.js` as a way
 * to run the server: both were dead, and following either gave a process that
 * exits immediately having served nothing (audit R2 #202).
 *
 * Run it with `npx @vmark/mcp-server` (or `node dist/cli.js`). The server
 * communicates with VMark via WebSocket bridge on localhost (port
 * auto-assigned, discovered via port file).
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
import { SESSION_ACTIONS, SESSION_TOOL, registerSessionTool } from './tools/session.js';
import { WORKSPACE_ACTIONS, WORKSPACE_TOOL, registerWorkspaceTool } from './tools/workspace.js';
import { DOCUMENT_ACTIONS, DOCUMENT_TOOL, registerDocumentTool } from './tools/document.js';
import { WORKFLOW_ACTIONS, WORKFLOW_TOOL, registerWorkflowTool } from './tools/workflow.js';
import { SELECTION_ACTIONS, SELECTION_TOOL, registerSelectionTool } from './tools/selection.js';
import { BROWSER_TOOL, registerBrowserTool } from './tools/browser.js';
import { BROWSER_ACTIONS } from './tools/browserActions.js';
import { BROWSER_READ_TOOL, registerBrowserReadTool } from './tools/browserRead.js';
import { BROWSER_READ_ACTIONS } from './tools/browserReadActions.js';
import { COHERENCE_ACTIONS, COHERENCE_TOOL, registerCoherenceTool } from './tools/coherence.js';
import {
  COHERENCE_RESOLVE_ACTIONS,
  COHERENCE_RESOLVE_TOOL,
  registerCoherenceResolveTool,
} from './tools/coherenceResolve.js';
import type { Bridge } from './bridge/types.js';

/**
 * The tool surface, one entry per tool: how it is registered and how
 * --health-check describes it. Everything below derives from this list, so the
 * registrations, the category descriptors and `EXPECTED_TOOL_COUNT` cannot
 * disagree — they used to be four hand-kept copies, and the action counts in
 * the prose drifted to 7/5/2 against a real 8/13/5 (20260728 audit) and to
 * 8/6 against 12/8 (feature-ledger inspection) before anything noticed.
 *
 * Nothing here is retyped from a tool module: `name` and `actions` are the
 * constants each tool registers and advertises with (the browser halves'
 * lists belong to their action tables), and the `(N actions)` a descriptor
 * carries is DERIVED from `actions` rather than written into the prose
 * (audit 20260907 #100). toolContract.test.ts pins each entry's `actions`
 * against the enum the SDK actually advertises.
 */
export const TOOL_REGISTRY = [
  {
    name: SESSION_TOOL,
    actions: SESSION_ACTIONS,
    register: registerSessionTool,
    category: 'Session',
    description: 'One-shot orientation: discover windows, tabs, and capabilities',
  },
  {
    name: WORKSPACE_TOOL,
    actions: WORKSPACE_ACTIONS,
    register: registerWorkspaceTool,
    category: 'Workspace',
    description: 'File and window lifecycle',
  },
  {
    name: DOCUMENT_TOOL,
    actions: DOCUMENT_ACTIONS,
    register: registerDocumentTool,
    category: 'Document',
    description: 'Read, write, transform document content. The read/write spine of the surface',
  },
  {
    name: WORKFLOW_TOOL,
    actions: WORKFLOW_ACTIONS,
    register: registerWorkflowTool,
    category: 'Workflow',
    description: 'CST-safe IRPatch application + actionlint validation for GitHub Actions YAML',
  },
  {
    name: SELECTION_TOOL,
    actions: SELECTION_ACTIONS,
    register: registerSelectionTool,
    category: 'Selection',
    description:
      "Read or replace the user's current editor selection — cheap targeted edits on large documents",
  },
  {
    name: BROWSER_TOOL,
    actions: BROWSER_ACTIONS,
    register: registerBrowserTool,
    category: 'Browser',
    description: 'Act on the embedded browser tab',
    note: 'every action mutates; all but close and workflow_cancel are approval-gated',
  },
  {
    name: BROWSER_READ_TOOL,
    actions: BROWSER_READ_ACTIONS,
    register: registerBrowserReadTool,
    category: 'Browser (read-only)',
    description: 'Observe the embedded browser tab',
    note: 'nothing is modified, so a client may auto-approve',
  },
  {
    name: COHERENCE_TOOL,
    actions: COHERENCE_ACTIONS,
    register: registerCoherenceTool,
    category: 'Coherence',
    description:
      'Workspace coherence reads: kernel status, the stale/diverged edge breakdown, claims and contexts',
  },
  {
    name: COHERENCE_RESOLVE_TOOL,
    actions: COHERENCE_RESOLVE_ACTIONS,
    register: registerCoherenceResolveTool,
    category: 'Coherence (resolve)',
    description:
      'Resolve a live stale edge — WRITES an audit-logged, non-undoable ledger entry and requires a live delegation grant',
  },
] as const;

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
  for (const tool of TOOL_REGISTRY) tool.register(server);
  return server;
}

/** `(N actions)` for a descriptor, derived from the tool's advertised action list. */
export function describeActionCount(actions: readonly string[]): string {
  return `(${actions.length} action${actions.length === 1 ? '' : 's'})`;
}

/**
 * Tool category descriptors — the human-readable surface summary, one per
 * registered tool, projected from the registry; the action list and the count
 * are both DERIVED, never typed.
 *
 * Three registry entries used to spell their actions out in prose — the
 * workspace verbs, and all twelve/eight of the browser halves — which is the
 * drift channel this registry exists to close, reopened inside the registry
 * itself (audit R2 #203). What stays hand-written is the part `actions` cannot
 * express: the non-enumerative `note` about approval gating and read-only
 * safety.
 */
export const TOOL_CATEGORIES = TOOL_REGISTRY.map((entry) => ({
  name: entry.category,
  description: [
    `${entry.description}: ${entry.actions.join(', ')}`,
    ...('note' in entry ? [` — ${entry.note}`] : []),
    ` ${describeActionCount(entry.actions)}`,
  ].join(''),
  tools: [entry.name],
}));

/**
 * Expected tool count — used by --health-check to catch stale builds. Derived
 * from the registry, so adding or removing a tool updates it by itself.
 */
export const EXPECTED_TOOL_COUNT = TOOL_REGISTRY.length;
