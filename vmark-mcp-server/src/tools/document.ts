/**
 * Document tool — read, write, transform.
 *
 * The read/write spine of the pruned MCP surface. AI agents round-trip
 * Markdown text via `read` → reason → `write`. `transform` applies the
 * deterministic CJK rewriter, preserved because the rules are too
 * nuanced for AI prose to reproduce reliably.
 *
 * Plan: dev-docs/plans/20260504-mcp-pruning.md ADR-1, ADR-2, ADR-4.
 */

import { VMarkMcpServer } from '../server.js';

export function registerDocumentTool(server: VMarkMcpServer): void {
  server.registerTool(
    {
      name: 'document',
      description:
        'Read, write, and transform document content. The spine of the MCP surface — for in-document changes, prefer `read → reason → write` over the legacy granular formatting tools (now removed).\n\n' +
        'Actions:\n' +
        '- read: Return {content, revision, filePath, kind, dirty} for a tab. Pass `tabId` to target a specific tab; omit to use the focused tab. Always read before writing — the `revision` token must be passed back in `write`.\n' +
        '- write: Replace full document content. Args: {tabId?, content, expected_revision?}. If `expected_revision` is supplied and does not match the current revision, returns a STALE error with the up-to-date `current_revision`; the caller should re-read and retry. If omitted, the write is unconditional (use only when no prior read exists, e.g. greenfield drafting).\n' +
        '- transform: Apply a deterministic rewrite. Args: {tabId?, kind, expected_revision?}. `kind` is one of "cjk-format" (full CJK formatting per user settings), "cjk-spacing" (insert spaces between CJK and Latin/digits), "cjk-punctuation" (convert ASCII punctuation adjacent to CJK to fullwidth).',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['read', 'write', 'transform'],
            description: 'The action to perform',
          },
          tabId: {
            type: 'string',
            description:
              'Target tab id (from session.get_state). Omit to use the focused tab.',
          },
          content: {
            type: 'string',
            description: 'New full document content (write only).',
          },
          kind: {
            type: 'string',
            enum: ['cjk-format', 'cjk-spacing', 'cjk-punctuation'],
            description: 'Transform kind (transform only).',
          },
          expected_revision: {
            type: 'string',
            description:
              'Optimistic-concurrency token from the most recent read (write/transform only).',
          },
        },
        required: ['action'],
      },
    },
    async (args) => {
      const action = args.action;
      const tabId = typeof args.tabId === 'string' ? args.tabId : undefined;
      const expected_revision =
        typeof args.expected_revision === 'string'
          ? args.expected_revision
          : undefined;

      if (action === 'read') {
        const data = await server.sendBridgeRequest({
          type: 'vmark.document.read',
          tabId,
        });
        return VMarkMcpServer.successJsonResult(data);
      }
      if (action === 'write') {
        if (typeof args.content !== 'string') {
          return VMarkMcpServer.errorResult('content (string) is required');
        }
        const data = await server.sendBridgeRequest({
          type: 'vmark.document.write',
          tabId,
          content: args.content,
          expected_revision,
        });
        return VMarkMcpServer.successJsonResult(data);
      }
      if (action === 'transform') {
        if (typeof args.kind !== 'string') {
          return VMarkMcpServer.errorResult('kind (string) is required');
        }
        const data = await server.sendBridgeRequest({
          type: 'vmark.document.transform',
          tabId,
          kind: args.kind,
          expected_revision,
        });
        return VMarkMcpServer.successJsonResult(data);
      }
      return VMarkMcpServer.errorResult(
        `Invalid action: ${String(action)}. Expected: read, write, or transform`,
      );
    },
  );
}
