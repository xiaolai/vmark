/**
 * Comments tool — the agent's side of a document's review comments: list the
 * threads, reply to one, mark one addressed.
 *
 * Key decisions:
 *   - Resolve, reopen and delete are the user's decisions, so the tool has no
 *     such action; the app's agent commands have none either. A caller that
 *     asks for one is refused here, before any bridge request.
 *   - A reply carries no reply id: the app mints it once per call, so a
 *     retried reply is answered from its receipt, never recorded twice.
 *   - Every change names the `commentGen` the agent read; a thread that moved
 *     since is refused STALE_COMMENT and the agent lists again.
 *
 *   - `list` is paged here, over the app's whole list (`commentsPage.ts`): a
 *     document's threads can far exceed the output bound, and a list cut by
 *     the bound left its tail unreachable.
 *
 * @coordinates-with src/services/mcpBridge/v2/comments.ts (repo root) — the handlers
 * @coordinates-with tools/commentsPage.ts — the pages and their cursor
 * @coordinates-with tools/toolArgs.ts — `addresses` on the journaled writes
 */

import { z } from 'zod';
import { VMarkMcpServer } from '../server.js';
import { type CommentList, commentsPage } from './commentsPage.js';
import { bridgeErrorResult } from './staleError.js';
import { optionalIdSchema, readOptionalId, readRequiredId } from './toolArgs.js';

export const COMMENTS_TOOL = 'comments' as const;
export const COMMENTS_ACTIONS = ['list', 'reply', 'mark_addressed'] as const;

export function registerCommentsTool(server: VMarkMcpServer): void {
  server.registerTool(
    {
      name: COMMENTS_TOOL,
      title: 'VMark Review Comments',
      // `list` reads; `reply` and `mark_addressed` append to the thread. Nothing
      // is removed, so the set is not destructive.
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      description:
        "Read and answer the user's review comments on a document. Resolve, reopen and delete are the user's: this tool cannot do them.\n\n" +
        'Actions:\n' +
'- list: Return {doc, generation, threads, nextCursor?} for a tab (omit `tabId` for the focused tab), oldest thread first. Each thread carries its `comment` id, `state` (open/addressed/resolved/reopened), `commentGen`, quoted anchor and replies. ' +
        'A long list comes in pages: while `nextCursor` is present, call list again with `cursor` set to it. A thread split across pages carries `repliesFrom` and `repliesTotal`; its later parts carry only `comment`, `state`, `commentGen`, `continued: true` and the next replies. A body too long for any page as JSON text (heavily escaped) comes as `bodyBase64`, its UTF-8 bytes in base64, in place of `body`. A cursor whose thread was deleted, or one from another document, is refused STALE_COMMENT — list again without one.\n' +
        '- reply: Add a reply to a thread. Args: {tabId?, commentId, body, expectedCommentGen}.\n' +
        '- mark_addressed: Mark a thread addressed. Args: {tabId?, commentId, expectedCommentGen}.\n\n' +
        'To say a write answers comments, pass `addresses: [commentId]` to document.write, document.transform, selection.set or workflow.apply_patch; that records the link on the revision and moves no thread. ' +
        'Refusals that change nothing: STALE_COMMENT (the thread changed or was deleted since you read its `commentGen` — list again), INVALID_COMMENT (no such comment on this document), COMMENT_NOT_ALLOWED (the thread is resolved), COMMENT_LIMIT (too many replies, too long a body, or a thread that can change no more), and the journal refusals JOURNAL_BUSY, JOURNAL_DEGRADED, JOURNAL_UNAVAILABLE and INVALID_TEXT.',
      inputSchema: {
        action: z.enum(COMMENTS_ACTIONS).describe('The action to perform'),
        tabId: optionalIdSchema('Target tab id (from session.get_state). Omit to use the focused tab.'),
        commentId: optionalIdSchema('Thread id from list (reply, mark_addressed).'),
        body: z.string().optional().describe('Reply text (reply only).'),
        expectedCommentGen: optionalIdSchema(
          'The thread\'s `commentGen` from list (reply, mark_addressed).',
        ),
        cursor: z.string().optional().describe('The `nextCursor` of the previous list page (list only).'),
      },
    },
    async (args) => {
      const action = args.action;
      const tab = readOptionalId(args.tabId, 'tabId');
      if (!tab.ok) return VMarkMcpServer.errorResult(tab.error);
      const tabId = tab.value;
      if (action !== 'list' && action !== 'reply' && action !== 'mark_addressed') {
        return VMarkMcpServer.errorResult(
          `Invalid action: ${String(action)}. Expected: ${COMMENTS_ACTIONS.join(', ')}`,
        );
      }
      if (args.cursor !== undefined && (action !== 'list' || typeof args.cursor !== 'string')) {
        return VMarkMcpServer.errorResult('cursor is a string, and only for list');
      }
      try {
        if (action === 'list') {
          const data = await server.sendBridgeRequest<CommentList>({ type: 'vmark.comments.list', tabId });
          const paged = commentsPage(data, args.cursor);
          if (!paged.ok) return VMarkMcpServer.errorResult(paged.error);
          return VMarkMcpServer.successJsonResult(paged.page);
        }
        const commentId = readRequiredId(args.commentId, 'commentId');
        if (!commentId.ok) return VMarkMcpServer.errorResult(commentId.error);
        const gen = readRequiredId(args.expectedCommentGen, 'expectedCommentGen');
        if (!gen.ok) return VMarkMcpServer.errorResult(gen.error);
        const target = { tabId, commentId: commentId.value, expectedCommentGen: gen.value };
        if (action === 'reply') {
          if (typeof args.body !== 'string') return VMarkMcpServer.errorResult('body (string) is required');
          const data = await server.sendBridgeRequest({ type: 'vmark.comments.reply', ...target, body: args.body });
          return VMarkMcpServer.successJsonResult(data);
        }
        const data = await server.sendBridgeRequest({ type: 'vmark.comments.mark_addressed', ...target });
        return VMarkMcpServer.successJsonResult(data);
      } catch (error) {
        return bridgeErrorResult(error, 'comments.list');
      }
    },
  );
}
