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

import { z } from 'zod';
import { VMarkMcpServer } from '../server.js';
import {
  RECOVERY,
  TRUNCATION_OUTPUT_SHAPE,
  structuredJsonResult,
} from '../utils/toolOutput.js';
import { bridgeErrorResult } from './staleError.js';
import { optionalIdSchema, readOptionalId } from './toolArgs.js';

export function registerSelectionTool(server: VMarkMcpServer): void {
  server.registerTool(
    {
      name: 'selection',
      title: 'VMark Editor Selection',
      // `get` reads, `set` replaces the selected text irreversibly (from the
      // AI's side — the user still has undo). One annotation set, so it states
      // the mutating behaviour.
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      description:
        "Read or replace the user's current editor selection. Cheap targeted edits on large documents — avoids the full-doc round-trip required by `document.read`/`document.write`.\n\n" +
        'Actions:\n' +
        '- get: Return {text, isEmpty, range, mode, kind, tabId, revision} for the current selection. Pass `tabId` to target a specific tab; omit to use the focused tab. When nothing is selected, `text` is "" and `isEmpty` is true. `text` is the markdown serialization of the selected slice (in WYSIWYG mode) or the raw selected text (in source mode). `mode` is "wysiwyg" or "source" — `range.{from,to}` lives in PM positions or character offsets respectively. The `revision` token must be passed back in `set`.\n' +
        '- set: Replace the current selection with new content. Args: {tabId?, content, expected_revision?}. Returns {revision, replaced_chars} — carry the new `revision` into your next call. In WYSIWYG mode, `content` is parsed as markdown when it carries markdown structure, otherwise inserted as a literal text node so leading/trailing whitespace round-trips exactly. In source mode, `content` is always inserted as raw text — the source surface is already markdown bytes. If `expected_revision` does not match the current revision, returns a STALE error carrying the up-to-date `current_revision` BOTH in the message and in the error\'s `structuredContent` (so you can branch on it without parsing prose); re-read with `selection.get` and retry rather than writing the stale content back. Operates on the editor selection at call time — if the user moved the cursor between get and set, the edit lands at the new position.',
      inputSchema: {
        action: z.enum(['get', 'set']).describe('The action to perform'),
        tabId: optionalIdSchema(
          'Target tab id (from session.get_state). Omit to use the focused tab. Selection only operates on the focused tab; mismatch returns INVALID_TAB.',
        ),
        content: z
          .string()
          .optional()
          .describe('Replacement content (set only). Empty string deletes the selection.'),
        expected_revision: z
          .string()
          .optional()
          .describe(
            'Optimistic-concurrency token from the most recent read or selection.get (set only).',
          ),
      },
      // Declared on the same terms as `document`'s (see the long note there):
      // ONE schema serves get and set, every field is optional, and `{}`
      // validates. The SDK turns a failed output validation into an McpError,
      // so a payload this schema failed to anticipate would report an
      // already-committed selection replacement as a protocol failure. Schema
      // tidiness is worth less than that never happening.
      //
      // `range` is the surface's only nested object. It is declared because it
      // is the one field a client cannot guess the shape of, and the risk is
      // asymmetric: `range` appears on `get` (a pure read, where a rejection
      // costs a retry) and never on `set` (the write). Zod strips unknown keys
      // rather than failing, so a future `range.anchor` still validates.
      outputSchema: {
        // get
        text: z
          .string()
          .optional()
          .describe('The selected text — markdown serialization (WYSIWYG) or raw text (source).'),
        isEmpty: z.boolean().optional().describe('True when nothing is selected.'),
        range: z
          .object({ from: z.number(), to: z.number() })
          .optional()
          .describe('PM positions (wysiwyg) or character offsets (source).'),
        mode: z.string().optional().describe('"wysiwyg" or "source".'),
        kind: z.string().optional().describe('"markdown" or "yaml-workflow".'),
        tabId: z.string().optional().describe('The tab the selection was read from.'),
        // both
        revision: z
          .string()
          .optional()
          .describe('Optimistic-concurrency token; pass it back in `set`.'),
        // set
        replaced_chars: z
          .number()
          .optional()
          .describe('Length of the text that was replaced (set).'),
        // STALE rejection — an isError result that still carries structured
        // detail, so the retry token never has to be scraped out of prose.
        error: z.string().optional().describe('Refusal code, e.g. "STALE" (error results only).'),
        message: z.string().optional().describe('Human-readable refusal detail.'),
        current_revision: z
          .string()
          .optional()
          .describe('Up-to-date revision returned with a STALE rejection; re-read and retry.'),
        // output bound
        ...TRUNCATION_OUTPUT_SHAPE,
      },
    },
    async (args) => {
      const action = args.action;
      // Blank/garbled ids are falsy on the app side, i.e. "the focused tab" —
      // a mis-targeted `set` would replace text in a document nobody named.
      const tab = readOptionalId(args.tabId, 'tabId');
      if (!tab.ok) return VMarkMcpServer.errorResult(tab.error);
      const tabId = tab.value;
      const expected_revision =
        typeof args.expected_revision === 'string'
          ? args.expected_revision
          : undefined;

      try {
        if (action === 'get') {
          const data = await server.sendBridgeRequest({
            type: 'vmark.selection.get',
            tabId,
          });
          return structuredJsonResult(data, RECOVERY.selectionGet);
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
          return structuredJsonResult(data);
        }
      } catch (error) {
        // `set` is refused as STALE exactly like `document.write`. Without this
        // the rejection escaped to `callTool`, which stringified it into
        // `Tool error: {"error":"STALE",…}` — the retry token glued into prose.
        return bridgeErrorResult(error, 'selection.get');
      }
      return VMarkMcpServer.errorResult(
        `Invalid action: ${String(action)}. Expected: get or set`,
      );
    },
  );
}
