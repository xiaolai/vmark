/**
 * Workflow tool — CST-safe patch application + actionlint validation
 * for GitHub Actions workflow YAML files.
 *
 * The only structural mutator that survives the prune. Mechanism: raw
 * YAML write loses comments and anchors; VMark's CST mutators preserve
 * them. Exposed as one tool with two actions instead of seven separate
 * mutator tools.
 *
 * Plan: dev-docs/plans/20260504-mcp-pruning.md ADR-5.
 */

import { VMarkMcpServer } from '../server.js';

export function registerWorkflowTool(server: VMarkMcpServer): void {
  server.registerTool(
    {
      name: 'workflow',
      description:
        'CST-safe edits and validation for GitHub Actions workflow YAML. Only available for tabs whose `kind` is `"yaml-workflow"` (see session.get_state). For Markdown, use `document.write` instead.\n\n' +
        'Actions:\n' +
        '- apply_patch: Apply an array of IRPatch objects. Args: {tabId?, patches: IRPatch[], expected_revision?}. Patches preserve comments, anchors, and key order — raw text writes do not. Patch shapes:\n' +
        '  • {kind: "workflow.set", path, value}     — top-level field (name, env.X, …)\n' +
        '  • {kind: "job.set", jobId, path, value}\n' +
        '  • {kind: "step.set", jobId, stepIndex, path, value}\n' +
        '  • {kind: "with.set", jobId, stepIndex, key, value}\n' +
        '  • {kind: "with.remove", jobId, stepIndex, key}\n' +
        '  • {kind: "needs.add", jobId, ref}\n' +
        '  • {kind: "needs.remove", jobId, ref}\n' +
        '  • {kind: "trigger.setFilters", event, filter, value: string[]}\n' +
        '- validate: Run actionlint and return diagnostics. Args: {tabId?}. Returns {ok, diagnostics: [{line, col, message, severity}], binaryAvailable}.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['apply_patch', 'validate'],
            description: 'The action to perform',
          },
          tabId: { type: 'string' },
          patches: {
            type: 'array',
            items: { type: 'object' },
            description:
              'IRPatch[] — see the action description for the discriminated-union shapes.',
          },
          expected_revision: { type: 'string' },
        },
        required: ['action'],
      },
    },
    async (args) => {
      const action = args.action;
      const tabId = typeof args.tabId === 'string' ? args.tabId : undefined;
      if (action === 'apply_patch') {
        if (!Array.isArray(args.patches)) {
          return VMarkMcpServer.errorResult('patches (array) is required');
        }
        const expected_revision =
          typeof args.expected_revision === 'string'
            ? args.expected_revision
            : undefined;
        const data = await server.sendBridgeRequest({
          type: 'vmark.workflow.apply_patch',
          tabId,
          patches: args.patches,
          expected_revision,
        });
        return VMarkMcpServer.successJsonResult(data);
      }
      if (action === 'validate') {
        const data = await server.sendBridgeRequest({
          type: 'vmark.workflow.validate',
          tabId,
        });
        return VMarkMcpServer.successJsonResult(data);
      }
      return VMarkMcpServer.errorResult(
        `Invalid action: ${String(action)}. Expected: apply_patch or validate`,
      );
    },
  );
}
