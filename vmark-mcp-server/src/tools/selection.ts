/**
 * Selection tool — get/set the user's current editor selection.
 *
 * Restored after the May 2026 pruning to make targeted edits on large
 * documents economical. Without this, every AI edit pays the full-doc
 * cost of `document.read → reason → document.write` — input tokens for
 * the whole doc, output tokens for the whole doc, a long write window
 * that widens the stale-revision retry loop, and a faithfulness risk on
 * the bytes the AI didn't change.
 *
 * Plan: dev-docs/plans/20260504-mcp-pruning.md ADR-7.
 */

import { VMarkMcpServer } from '../server.js';

export function registerSelectionTool(server: VMarkMcpServer): void {
  server.registerTool(
    {
      name: 'selection',
      description:
        "Read or replace the user's current editor selection. Cheap targeted edits on large documents — avoids the full-doc round-trip required by `document.read`/`document.write`.\n\n" +
        'Actions:\n' +
        '- get: Return {text, isEmpty, range, mode, kind, tabId, revision} for the current selection. Pass `tabId` to target a specific tab; omit to use the focused tab. When nothing is selected, `text` is "" and `isEmpty` is true. `text` is the markdown serialization of the selected slice (in WYSIWYG mode) or the raw selected text (in source mode). `mode` is "wysiwyg" or "source" — `range.{from,to}` lives in PM positions or character offsets respectively. The `revision` token must be passed back in `set`.\n' +
        '- set: Replace the current selection with new content. Args: {tabId?, content, expected_revision?}. In WYSIWYG mode, `content` is parsed as markdown when it carries markdown structure, otherwise inserted as a literal text node so leading/trailing whitespace round-trips exactly. In source mode, `content` is always inserted as raw text — the source surface is already markdown bytes. If `expected_revision` does not match the current revision, returns STALE with `current_revision`; the caller should re-read and retry. Operates on the editor selection at call time — if the user moved the cursor between get and set, the edit lands at the new position.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['get', 'set'],
            description: 'The action to perform',
          },
          tabId: {
            type: 'string',
            description:
              'Target tab id (from session.get_state). Omit to use the focused tab. Selection only operates on the focused tab; mismatch returns INVALID_TAB.',
          },
          content: {
            type: 'string',
            description: 'Replacement content (set only). Empty string deletes the selection.',
          },
          expected_revision: {
            type: 'string',
            description:
              'Optimistic-concurrency token from the most recent read or selection.get (set only).',
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

      if (action === 'get') {
        const data = await server.sendBridgeRequest({
          type: 'vmark.selection.get',
          tabId,
        });
        return VMarkMcpServer.successJsonResult(data);
      }
      if (action === 'set') {
        if (typeof args.content !== 'string') {
          return VMarkMcpServer.errorResult('content (string) is required');
        }
        const data = await server.sendBridgeRequest({
          type: 'vmark.selection.set',
          tabId,
          content: args.content,
          expected_revision,
        });
        return VMarkMcpServer.successJsonResult(data);
      }
      return VMarkMcpServer.errorResult(
        `Invalid action: ${String(action)}. Expected: get or set`,
      );
    },
  );
}
