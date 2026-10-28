/**
 * Comment handlers — `vmark.comments.list`, `.reply` and `.mark_addressed`:
 * the agent reads a document's review comments, replies to one, or marks
 * one addressed, through the journal's agent command family.
 *
 * Key decisions:
 *   - Only the agent client (`agentCommentClient.ts`) is reached, so every
 *     record names the agent; there is no resolve, reopen or delete, which
 *     are the person's.
 *   - The document is the tab's journal key (`docKeyFor`), as the comment
 *     panel keys it — an untitled tab by the window that holds it; the list anchors the threads in the tab's flushed text.
 *   - A malformed comment id or `expectedCommentGen` is refused
 *     INVALID_COMMENT before any journal call, as is the journal's own
 *     INVALID_REQUEST (an unknown comment, or one of another document).
 *     STALE_COMMENT, COMMENT_NOT_ALLOWED and COMMENT_LIMIT keep their token;
 *     a full comment store or an exhausted thread reads as COMMENT_LIMIT. Anything else is answered
 *     as a journaled write's refusal is (`journalV2Error.ts`).
 *
 * @coordinates-with services/agentJournal/comments/agentCommentClient.ts — the commands
 * @coordinates-with server/mcp/src/tools/comments.ts (repo root) — the MCP tool
 * @module services/mcpBridge/v2/comments
 */

import { respond } from "@/services/mcpBridge/utils";
import { docKeyFor } from "@/services/agentJournal/documentIdentity";
import { isDecimal } from "@/services/agentJournal/journalIpc";
import { JournalRefusal } from "@/services/agentJournal/journalRefusal";
import { isCommentId } from "@/services/agentJournal/comments/commentReplies";
import {
  listCommentsForAgent,
  markAddressedAsAgent,
  replyAsAgent,
  type AgentCommentTarget,
} from "@/services/agentJournal/comments/agentCommentClient";
import { wrapHandler } from "./wrapHandler";
import { readOperationArgs } from "./readOperationArgs";
import { requireTab, structuredError, type GuardedTab } from "./tabGuard";
import { journalRefusalError } from "./journalV2Error";
import type { V2Error } from "./types";

function commentRefusalError(refusal: JournalRefusal): V2Error {
  const code = refusal.journalCode;
  if (code === "STALE_COMMENT" || code === "COMMENT_NOT_ALLOWED" || code === "COMMENT_LIMIT") return { error: code, message: refusal.message };
  // A full comment store and a thread whose change counter is used up are
  // limits too, and permanent: retrying the same change cannot succeed.
  if (code === "COMMENT_STORAGE_FULL" || code === "COMMENT_STATE_EXHAUSTED") return { error: "COMMENT_LIMIT", message: refusal.message };
  if (code === "INVALID_REQUEST") return { error: "INVALID_COMMENT", message: refusal.message };
  return journalRefusalError(refusal);
}

const docKeyOf = (tab: GuardedTab) => docKeyFor(tab, tab.windowLabel);

/** Run `call`, answering its result or its journal refusal. */
async function answer(id: string, call: () => Promise<unknown>): Promise<void> {
  try {
    await respond({ id, success: true, data: await call() });
  } catch (error) {
    if (!(error instanceof JournalRefusal)) throw error;
    await structuredError(id, commentRefusalError(error));
  }
}

/** The thread a change names, or `null` after answering INVALID_COMMENT. */
async function requireTarget(
  id: string,
  wire: { tabId?: string; commentId?: string; expectedCommentGen?: string },
): Promise<AgentCommentTarget | null> {
  const { commentId, expectedCommentGen } = wire;
  if (!isCommentId(commentId) || !isDecimal(expectedCommentGen)) {
    await structuredError(id, {
      error: "INVALID_COMMENT",
      message: "commentId (c<n>) and expectedCommentGen (a decimal) are required, as comments.list gives them",
    });
    return null;
  }
  const tab = await requireTab(id, wire.tabId);
  return tab && { docKey: docKeyOf(tab), comment: commentId, expectedCommentGen };
}

/** Handle `vmark.comments.list`. Args: `{tabId?}`. */
export async function handleCommentsList(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    const wire = readOperationArgs("vmark.comments.list", args);
    const tab = await requireTab(id, wire.tabId);
    if (!tab) return;
    await answer(id, () => listCommentsForAgent(docKeyOf(tab), tab.content));
  });
}

/** Handle `vmark.comments.reply`. Args: `{tabId?, commentId, body, expectedCommentGen}`. */
export async function handleCommentsReply(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    const wire = readOperationArgs("vmark.comments.reply", args);
    const { body } = wire;
    if (body === undefined) {
      await structuredError(id, { error: "INVALID_COMMENT", message: "body must be a string" });
      return;
    }
    const target = await requireTarget(id, wire);
    if (!target) return;
    await answer(id, () => replyAsAgent(target, body));
  });
}

/** Handle `vmark.comments.mark_addressed`. Args: `{tabId?, commentId, expectedCommentGen}`. */
export async function handleCommentsMarkAddressed(id: string, args: Record<string, unknown>): Promise<void> {
  return wrapHandler(id, async () => {
    const target = await requireTarget(id, readOperationArgs("vmark.comments.mark_addressed", args));
    if (!target) return;
    await answer(id, () => markAddressedAsAgent(target));
  });
}
