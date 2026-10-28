/**
 * Document tool — read, write, transform.
 *
 * The read/write spine of the pruned MCP surface. AI agents round-trip
 * Markdown text via `read` → reason → `write`. `transform` applies the
 * deterministic CJK rewriter, preserved because the rules are too
 * nuanced for AI prose to reproduce reliably.
 *
 * Origin: the MCP pruning plan's ADR-1, ADR-2 and ADR-4, recorded in
 * `.claude/adr/plans/20260504-mcp-pruning.md`.
 */

import { z } from 'zod';
import { VMarkMcpServer } from '../server.js';
import type { ToolCallResult } from '../types.js';
import {
  RECOVERY,
  TRUNCATION_OUTPUT_SHAPE,
  structuredJsonResult,
} from '../utils/toolOutput.js';
import { JOURNAL_REFUSALS } from './journalRefusals.js';
import { bridgeErrorResult } from './staleError.js';
import {
  addressesSchema,
  optionalIdSchema,
  optionalRevisionSchema,
  readOptionalAddresses,
  readOptionalBoolean,
  readOptionalId,
  readOptionalRevision,
} from './toolArgs.js';

/**
 * Turn a bridge failure into a tool result, keeping a STALE refusal
 * machine-readable. Shared with `selection`, which recovers the same way —
 * see `staleError.ts` for why the envelope rides on an `isError` result.
 */
function toErrorResult(error: unknown): ToolCallResult {
  return bridgeErrorResult(error, 'document.read');
}

export const DOCUMENT_TOOL = 'document' as const;
export const DOCUMENT_ACTIONS = ['read', 'write', 'transform'] as const;

export function registerDocumentTool(server: VMarkMcpServer): void {
  server.registerTool(
    {
      name: DOCUMENT_TOOL,
      title: 'VMark Document Read/Write',
      // Composite-tool tension: `read` is pure, `write` replaces the entire
      // document AND persists it. One annotation set covers both, so it states
      // the most dangerous behaviour reachable — never `readOnlyHint: true`.
      // Closed-world: writes land in a buffer VMark already owns, at the tab's
      // existing path; the tool cannot reach an arbitrary destination.
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      description:
        'Read, write, and transform document content. The spine of the MCP surface — for in-document changes, prefer `read → reason → write` over the legacy granular formatting tools (now removed).\n\n' +
        'Actions:\n' +
        '- read: Return {content, revision, filePath, kind, dirty} for a tab. Pass `tabId` to target a specific tab; omit to use the focused tab. Always read before writing — the `revision` token must be passed back in `write`.\n' +
        '- write: Replace full document content AND save to disk. Args: {tabId?, content, expected_revision?, save?}. By default the new content is also persisted to the file on disk so a subsequent disk read sees the new value — do NOT bypass MCP and write the file yourself; that loses checkpoint history and races with VMark\'s buffer. Set `save: false` only if you explicitly want to stage in-memory without persistence (rare). Response carries structured save fields you can branch on without parsing prose: `saved: true` → buffer updated AND disk write succeeded. `saved: false` + `save_skipped: "untitled"` → tab has no filePath; call `workspace.save_as` to choose one. `saved: false` + `save_skipped: "opt_out"` → you passed `save: false` (in-memory only). `saved: false` + `save_error: <message>` → write attempt failed on the FS (e.g. read-only); do not retry, surface the error to the user. `save_skipped` and `save_error` are mutually exclusive. A save that ran also carries `journaled`: "yes" (VMark\'s agent edit journal recorded the saved text), "pending" (recorded, ordered after a write still being recorded) or "no" (the file is saved, the journal did not record it — never an error). If `expected_revision` is supplied and does not match the current revision, returns a STALE error carrying the up-to-date `current_revision` BOTH in the message and in the error\'s `structuredContent` (so you can branch on it without parsing prose); the caller should re-read and retry. If omitted, the write is unconditional (use only when no prior read exists, e.g. greenfield drafting). Every write is recorded in VMark\'s agent edit journal first; success carries `applied: true` and `durable` (false = written, but the journal record is still queued; the next write to that document is refused JOURNAL_DEGRADED until it lands; if the journal refused the record outright, the write stays applied and the next write goes ahead). ' +
          JOURNAL_REFUSALS +
          '\n' +
        '- transform: Apply a deterministic rewrite. Args: {tabId?, kind, expected_revision?}. `kind` is one of "cjk-format" (full CJK formatting per user settings), "cjk-spacing" (insert spaces between CJK and Latin/digits), "cjk-punctuation" (convert ASCII punctuation adjacent to CJK to fullwidth). A transform that changes the text is recorded in the agent edit journal exactly like write (same `applied`/`durable` fields and the same refusals); one that changes nothing is not recorded.',
      inputSchema: {
        action: z.enum(DOCUMENT_ACTIONS).describe('The action to perform'),
        tabId: optionalIdSchema(
          'Target tab id (from session.get_state). Omit to use the focused tab.',
        ),
        content: z.string().optional().describe('New full document content (write only).'),
        kind: z
          .enum(['cjk-format', 'cjk-spacing', 'cjk-punctuation'])
          .optional()
          .describe('Transform kind (transform only).'),
        expected_revision: optionalRevisionSchema(
          'Optimistic-concurrency token from the most recent read (write/transform only).',
        ),
        addresses: addressesSchema(),
        save: z
          .boolean()
          .default(true)
          .describe(
            'Whether to persist the new content to disk after updating the buffer (write only). Defaults to true. Set to false only to stage changes in-memory without persistence.',
          ),
      },
      // ONE schema serves read / write / transform, and every field stays
      // optional. An earlier audit asked for action-specific
      // envelopes instead; that was assessed and REJECTED, for three reasons
      // that compound:
      //
      //  1. MCP gives a tool exactly one `outputSchema`, spec'd as a JSON
      //     Schema OBJECT. A top-level discriminated union is not expressible
      //     inside that contract.
      //  2. The payload carries NO action discriminant. `read` answers with
      //     {content, revision, …}, `write` with {revision, saved, …}; nothing
      //     in the structured content says which action produced it. A
      //     per-action schema would have to INFER the action from which fields
      //     happen to be present — the permissive union again, plus a guess.
      //  3. The cost of guessing wrong is not a warning. The SDK turns a
      //     failed output validation into an McpError (server/mcp.js), so a
      //     SUCCESSFUL write whose payload the schema did not anticipate is
      //     reported to the agent as a protocol failure — after the disk write
      //     already happened. The app versions this payload independently of
      //     the sidecar, so "did not anticipate" is a matter of when, not if.
      //
      // The trade-off accepted here: `{}` validates. Schema tidiness is worth
      // less than never converting a completed write into an error.
      outputSchema: {
        // read
        content: z.string().optional().describe('Full document text (read).'),
        revision: z.string().optional().describe('Current optimistic-concurrency token.'),
        filePath: z.string().nullable().optional().describe('Path on disk, null when untitled.'),
        kind: z.string().optional().describe('"markdown" or "yaml-workflow".'),
        dirty: z.boolean().optional().describe('Buffer differs from disk.'),
        // write — the machine-readable save outcome
        saved: z
          .boolean()
          .optional()
          .describe('true = buffer updated AND disk write succeeded (write).'),
        applied: z.boolean().optional().describe('true = the content was written (write, transform).'),
        durable: z
          .boolean()
          .optional()
          .describe('false = written, but its journal record is still queued for a retry (write, transform).'),
        journaled: z
          .string()
          .optional()
          .describe('"yes" | "pending" | "no": whether the journal recorded the saved text (write, when saved).'),
        save_skipped: z
          .string()
          .optional()
          .describe('Why no disk write was attempted: "untitled" or "opt_out". Excludes save_error.'),
        save_error: z
          .string()
          .optional()
          .describe('The FS rejected the write. Do not retry; surface to the user. Excludes save_skipped.'),
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
      // A blank or garbled tabId is falsy on the app side, where that means
      // "the focused tab" — so an invalid target silently became a write to
      // whatever document the user had in front of them. Refuse instead.
      const tab = readOptionalId(args.tabId, 'tabId');
      if (!tab.ok) return VMarkMcpServer.errorResult(tab.error);
      const tabId = tab.value;
      // A SUPPLIED but invalid revision is refused, never normalised to
      // `undefined` — that conversion turned a guarded write into an
      // unconditional one for exactly the callers who got it wrong.
      const revision = readOptionalRevision(args.expected_revision);
      if (!revision.ok) return VMarkMcpServer.errorResult(revision.error);
      const expected_revision = revision.value;
      const addressed = readOptionalAddresses(args.addresses);
      if (!addressed.ok) return VMarkMcpServer.errorResult(addressed.error);
      const addresses = addressed.value ? { addresses: addressed.value } : {};

      try {
        if (action === 'read') {
          const data = await server.sendBridgeRequest({
            type: 'vmark.document.read',
            tabId,
          });
          // The one unbounded read in the surface — a whole document.
          return structuredJsonResult(data, RECOVERY.documentRead);
        }
        if (action === 'write') {
          if (typeof args.content !== 'string') {
            return VMarkMcpServer.errorResult('content (string) is required');
          }
          // Default save: true — only forward an explicit false. A SUPPLIED
          // non-boolean is refused: `=== false` read the string "false" as
          // "use the default" and wrote to disk.
          const saveArg = readOptionalBoolean(args.save, 'save');
          if (!saveArg.ok) return VMarkMcpServer.errorResult(saveArg.error);
          const save = saveArg.value === false ? false : undefined;
          const data = await server.sendBridgeRequest({
            type: 'vmark.document.write',
            tabId,
            content: args.content,
            expected_revision,
            ...(save !== undefined ? { save } : {}),
            ...addresses,
          });
          return structuredJsonResult(data);
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
            ...addresses,
          });
          return structuredJsonResult(data);
        }
      } catch (error) {
        return toErrorResult(error);
      }
      // Generated from DOCUMENT_ACTIONS, the exported source of truth the
      // schema enum also reads. The hardcoded prose went stale the moment an
      // action was added or renamed, and it is the only thing a caller who got
      // the action wrong has to go on.
      return VMarkMcpServer.errorResult(
        `Invalid action: ${String(action)}. Expected: ${DOCUMENT_ACTIONS.join(', ')}`,
      );
    },
  );
}
