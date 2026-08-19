// WI-15 — producer-side field parity: what the tools SEND vs what the contract declares.
/**
 * `operationSchemas.ts` is only a single source of truth if the shipped tools
 * actually populate it. Two failure directions, both real:
 *
 *   - a field the contract declares that NO tool ever sends. That was
 *     `vmark.workspace.open_workspace`'s `windowLabel`: declared for a year,
 *     deliberately never forwarded (the handler binds to the arriving window),
 *     read by nobody. RED evidence for WI-15 drift 3.
 *   - a field a tool sends that the contract does not declare. That one is
 *     caught the moment it happens now, because `sendBridgeRequest` validates
 *     against the schema — every call below would throw.
 *
 * So this drives every (tool, action) pair through the REAL handlers with a
 * recording bridge and diffs the observed field sets against the contract.
 * No schemas are mocked; the only double is the transport.
 */
import { describe, it, expect } from 'vitest';
import type { BridgeRequest, BridgeResponse } from '../../../src/bridge/core-types.js';
import {
  BRIDGE_OPERATION_SCHEMAS,
  operationNames,
} from '../../../src/bridge/operationSchemas.js';
import { VMarkMcpServer } from '../../../src/server.js';
import { MockBridge } from '../../mocks/mockBridge.js';
import { registerSessionTool } from '../../../src/tools/session.js';
import { registerWorkspaceTool } from '../../../src/tools/workspace.js';
import { registerDocumentTool } from '../../../src/tools/document.js';
import { registerWorkflowTool } from '../../../src/tools/workflow.js';
import { registerSelectionTool } from '../../../src/tools/selection.js';
import { registerBrowserTool } from '../../../src/tools/browser.js';
import { registerBrowserReadTool } from '../../../src/tools/browserRead.js';
import { registerCoherenceTool } from '../../../src/tools/coherence.js';
import { registerCoherenceResolveTool } from '../../../src/tools/coherenceResolve.js';

/** Every (tool, args) pair the shipped surface can emit, one per code path
 *  that sends a distinct field combination. */
const CALLS: ReadonlyArray<readonly [tool: string, args: Record<string, unknown>]> = [
  ['session', { action: 'get_state' }],

  ['workspace', { action: 'new', kind: 'markdown', windowLabel: 'doc-1' }],
  ['workspace', { action: 'open', filePath: '/w/a.md', windowLabel: 'doc-1' }],
  ['workspace', { action: 'open_workspace', folderPath: '/w', windowLabel: 'doc-1' }],
  ['workspace', { action: 'save', tabId: 't1' }],
  ['workspace', { action: 'save_as', tabId: 't1', filePath: '/w/b.md' }],
  ['workspace', { action: 'close', tabId: 't1', force: true }],
  ['workspace', { action: 'switch_tab', tabId: 't1' }],
  ['workspace', { action: 'focus_window', windowLabel: 'doc-1' }],

  ['document', { action: 'read', tabId: 't1' }],
  ['document', { action: 'write', tabId: 't1', content: '# x', expected_revision: 'r1', save: false }],
  ['document', { action: 'transform', tabId: 't1', kind: 'cjk-format', expected_revision: 'r1' }],

  ['workflow', { action: 'apply_patch', tabId: 't1', patches: [{ op: 'noop' }], expected_revision: 'r1' }],
  ['workflow', { action: 'validate', tabId: 't1' }],

  ['selection', { action: 'get', tabId: 't1' }],
  ['selection', { action: 'set', tabId: 't1', content: 'x', expected_revision: 'r1' }],

  ['browser_read', { action: 'read', tabId: 'b1' }],
  ['browser_read', { action: 'query', tabId: 'b1', selector: '.a', fields: { text: true } }],
  ['browser_read', { action: 'console', tabId: 'b1' }],
  ['browser_read', { action: 'wait', tabId: 'b1', navigationId: 'n1', timeoutMs: 100 }],
  ['browser_read', { action: 'wait_for', tabId: 'b1', ref: 'e1', timeoutMs: 100 }],
  ['browser_read', { action: 'wait_for', tabId: 'b1', role: 'button', name: 'OK' }],
  ['browser_read', { action: 'wait_for', tabId: 'b1', text: 'hello' }],
  ['browser_read', { action: 'wait_for', tabId: 'b1', urlContains: '/done', timeoutMs: 100 }],
  ['browser_read', { action: 'extract', tabId: 'b1' }],
  ['browser_read', { action: 'workflow_status', tabId: 'b1', runId: 'wfrun-1' }],
  ['browser_read', { action: 'screenshot', tabId: 'b1' }],

  ['browser', { action: 'act', operation: 'scroll', tabId: 'b1', dy: 100 }],
  ['browser', { action: 'act', operation: 'scroll', tabId: 'b1', ref: 'e1' }],
  ['browser', { action: 'act', operation: 'key', tabId: 'b1', key: 'Enter', ref: 'e1', modifiers: { meta: true } }],
  ['browser', { action: 'act', operation: 'click', tabId: 'b1', role: 'button', name: 'OK' }],
  ['browser', { action: 'act', operation: 'type', tabId: 'b1', ref: 'e1', text: 'hi' }],
  ['browser', { action: 'open', url: 'https://e.test', timeoutMs: 100, profile: 'p1' }],
  ['browser', { action: 'navigate', tabId: 'b1', url: 'https://e.test', timeoutMs: 100 }],
  [
    'browser',
    {
      action: 'style',
      tabId: 'b1',
      ref: 'e1',
      selector: '.a',
      set: { color: 'red' },
      addClasses: ['x'],
      removeClasses: ['y'],
      injectCss: 'body{}',
    },
  ],
  ['browser', { action: 'execute_js', tabId: 'b1', script: '1' }],
  ['browser', { action: 'session_save', tabId: 'b1', handle: 'h1' }],
  ['browser', { action: 'session_load', tabId: 'b1', handle: 'h1' }],
  ['browser', { action: 'console_clear', tabId: 'b1' }],
  ['browser', { action: 'workflow_run', tabId: 'b1', source: 's', inputs: { a: 'b' }, allowRepeat: true }],
  ['browser', { action: 'workflow_cancel', tabId: 'b1', runId: 'wfrun-1' }],
  ['browser', { action: 'workflow_record', tabId: 'b1', recordOp: 'start', site: 'blog' }],

  ['coherence', { action: 'status', workspace_root: '/w' }],
  ['coherence', { action: 'edges', workspace_root: '/w' }],
  ['coherence', { action: 'claims', workspace_root: '/w' }],
  ['coherence', { action: 'contexts', workspace_root: '/w' }],
  [
    'coherence_resolve',
    { action: 'resolve', workspace_root: '/w', txf: 'tx', input: 0, resolution: 'waive', reason: 'why' },
  ],
];

function answer(request: BridgeRequest): BridgeResponse {
  if (request.type === 'vmark.browser.screenshot') {
    return { success: true, data: { url: 'https://e.test', image: 'aGk=' } };
  }
  return { success: true, data: {} };
}

async function recordEverySend(): Promise<Map<string, Set<string>>> {
  const bridge = new MockBridge();
  for (const operation of operationNames()) bridge.setResponseHandler(operation, answer);
  const server = new VMarkMcpServer({ bridge });
  registerSessionTool(server);
  registerWorkspaceTool(server);
  registerDocumentTool(server);
  registerWorkflowTool(server);
  registerSelectionTool(server);
  registerBrowserTool(server);
  registerBrowserReadTool(server);
  registerCoherenceTool(server);
  registerCoherenceResolveTool(server);

  for (const [tool, args] of CALLS) {
    const result = await server.callTool(tool, args);
    expect(result.isError, `${tool} ${String(args.action)} → ${JSON.stringify(result.content)}`).not.toBe(
      true
    );
  }

  const observed = new Map<string, Set<string>>();
  for (const { request } of bridge.requests) {
    const { type, ...rest } = request as Record<string, unknown> & { type: string };
    const fields = observed.get(type) ?? new Set<string>();
    // A key present with `undefined` is not sent — JSON.stringify drops it.
    for (const [name, value] of Object.entries(rest)) if (value !== undefined) fields.add(name);
    observed.set(type, fields);
  }
  return observed;
}

describe('bridge field parity — every declared field is one a shipped tool sends', () => {
  it('reaches every operation and declares nothing it never populates', async () => {
    const observed = await recordEverySend();

    expect([...observed.keys()].sort(), 'operations no call in this suite reaches').toEqual(
      operationNames()
    );

    const unsent: string[] = [];
    for (const operation of operationNames()) {
      const declared = Object.keys(
        BRIDGE_OPERATION_SCHEMAS[operation as keyof typeof BRIDGE_OPERATION_SCHEMAS].shape
      );
      const sent = observed.get(operation) ?? new Set<string>();
      for (const field of declared) if (!sent.has(field)) unsent.push(`${operation}.${field}`);
    }
    expect(unsent.sort()).toEqual([]);
  });
});
