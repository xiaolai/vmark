/**
 * Workflow tool — CST-safe patch application + actionlint validation
 * for GitHub Actions workflow YAML files.
 *
 * The only structural mutator that survives the prune. Mechanism: raw
 * YAML write loses comments and anchors; VMark's CST mutators preserve
 * them. Exposed as one tool with two actions instead of seven separate
 * mutator tools.
 *
 * Origin: the MCP pruning plan's ADR-5, recorded in
 * `.claude/adr/plans/20260504-mcp-pruning.md`.
 */

import { z } from 'zod';
import { VMarkMcpServer } from '../server.js';
import { JOURNAL_REFUSALS } from './journalRefusals.js';
import { bridgeErrorResult } from './staleError.js';
import {
  addressesSchema,
  optionalIdSchema,
  optionalRevisionSchema,
  readOptionalAddresses,
  readOptionalId,
  readOptionalRevision,
} from './toolArgs.js';

export const WORKFLOW_TOOL = 'workflow' as const;
export const WORKFLOW_ACTIONS = ['apply_patch', 'validate'] as const;

export function registerWorkflowTool(server: VMarkMcpServer): void {
  server.registerTool(
    {
      name: WORKFLOW_TOOL,
      title: 'VMark GitHub Actions Workflow',
      // `validate` reads; `apply_patch` mutates the buffer through the CST
      // mutators. Annotated for the mutating action. Closed-world: it only
      // touches a workflow tab VMark already has open, and never the network.
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
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
        '  A batch that changes the text is recorded in VMark\'s agent edit journal first, like document.write: success carries {revision, applied: true, durable}. A batch that changes nothing is not recorded. A stale `expected_revision` returns a STALE error carrying `current_revision` in its `structuredContent` — re-read with `document.read` and retry. ' +
        JOURNAL_REFUSALS +
        '\n' +
        '- validate: Run actionlint and return diagnostics. Args: {tabId?}. Returns {ok, diagnostics: [{line, col, message, severity}], binaryAvailable}.',
      inputSchema: {
        action: z.enum(WORKFLOW_ACTIONS).describe('The action to perform'),
        tabId: optionalIdSchema(
          'Target tab id (from session.get_state). Omit to use the focused tab.',
        ),
        patches: z
          .array(z.record(z.string(), z.unknown()))
          .optional()
          .describe(
            'IRPatch[] — see the action description for the discriminated-union shapes.',
          ),
        expected_revision: optionalRevisionSchema(
          'Optimistic-concurrency token from the most recent read (apply_patch only).',
        ),
        addresses: addressesSchema(),
      },
    },
    async (args) => {
      const action = args.action;
      // A blank id means "the focused tab" downstream — `apply_patch` would
      // then mutate whichever workflow the user happens to have open.
      const tab = readOptionalId(args.tabId, 'tabId');
      if (!tab.ok) return VMarkMcpServer.errorResult(tab.error);
      const tabId = tab.value;
      if (action === 'apply_patch') {
        if (!Array.isArray(args.patches)) {
          return VMarkMcpServer.errorResult('patches (array) is required');
        }
        // Refuse a supplied-but-invalid revision instead of converting it to
        // "write unconditionally".
        const revision = readOptionalRevision(args.expected_revision);
        if (!revision.ok) return VMarkMcpServer.errorResult(revision.error);
        const expected_revision = revision.value;
        const addressed = readOptionalAddresses(args.addresses);
        if (!addressed.ok) return VMarkMcpServer.errorResult(addressed.error);
        try {
          const data = await server.sendBridgeRequest({
            type: 'vmark.workflow.apply_patch',
            tabId,
            patches: args.patches,
            expected_revision,
            ...(addressed.value ? { addresses: addressed.value } : {}),
          });
          return VMarkMcpServer.successJsonResult(data);
        } catch (error) {
          // A STALE refusal keeps its `current_revision` machine-readable.
          return bridgeErrorResult(error, 'document.read');
        }
      }
      if (action === 'validate') {
        try {
          const data = await server.sendBridgeRequest({
            type: 'vmark.workflow.validate',
            tabId,
          });
          return VMarkMcpServer.successJsonResult(data);
        } catch (error) {
          return bridgeErrorResult(error, 'document.read');
        }
      }
      return VMarkMcpServer.errorResult(
        `Invalid action: ${String(action)}. Expected one of: ${WORKFLOW_ACTIONS.join(', ')}`,
      );
    },
  );
}
