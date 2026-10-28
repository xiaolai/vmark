/**
 * Agent comment client — the MCP bridge's comment commands
 * (`comment_agent_*`): list a document's threads, reply to one, mark one
 * addressed.
 *
 * Key decisions:
 *   - The command family is the caller: these are the agent's commands, so
 *     every record they write names the agent. There is no resolve, reopen
 *     or delete here because the journal has none for the agent.
 *   - A reply is a framed request (`journalRequest.ts`): its request id is
 *     minted here once and the frozen bytes are reused on an uncertain
 *     answer, so a retried reply is answered from its receipt, never
 *     recorded twice. The agent never supplies the id: the receipt binds the
 *     window's incarnation and page, which only this client knows.
 *   - The decoders are the person's (`commentReplies.ts`); the reply shapes
 *     are the same.
 *
 * @coordinates-with src-tauri/src/agent_journal/comment/commands_agent.rs — the commands
 * @coordinates-with services/mcpBridge/v2/comments.ts — the caller
 * @module services/agentJournal/comments/agentCommentClient
 */

import { callJournalBound } from "../journalIpc";
import { JournalRefusal } from "../journalRefusal";
import { runPrepareRequest } from "../journalRequest";
import {
  parseCommentList,
  parseCommentReplied,
  parseCommentState,
  type CommentList,
  type CommentReplied,
  type CommentStateChanged,
} from "./commentReplies";

/** A thread the agent acts on: its document, id and the `commentGen` it read. */
export interface AgentCommentTarget {
  docKey: string;
  comment: string;
  expectedCommentGen: string;
}

/** A document's threads, anchored in `text` (the window's buffer). Throws a `JournalRefusal`. */
export async function listCommentsForAgent(docKey: string, text: string): Promise<CommentList> {
  const command = "comment_agent_list";
  return parseCommentList(command, await callJournalBound(command, { payload: JSON.stringify({ docKey, text }) }));
}

/** Reply to a thread as the agent. Throws a `JournalRefusal`. */
export async function replyAsAgent(target: AgentCommentTarget, body: string): Promise<CommentReplied> {
  const { docKey, comment, expectedCommentGen } = target;
  const fields = { docKey, comment, body, author: "", expectedCommentGen };
  // No transaction: nothing to commit or abort, and a late answer is still a success.
  const run = await runPrepareRequest<CommentReplied & { readonly txn?: never }>({
    docKey,
    build: () => ({ command: "comment_agent_reply", fields, parse: parseCommentReplied }),
  });
  if (!run.ok) throw run.refusal;
  run.finish();
  return run.prepared;
}

/** Mark a thread addressed as the agent. Throws a `JournalRefusal`. */
export async function markAddressedAsAgent(target: AgentCommentTarget): Promise<CommentStateChanged> {
  const command = "comment_agent_mark_addressed";
  const { docKey, comment, expectedCommentGen } = target;
  const reply = parseCommentState(command, await callJournalBound(command, { payload: JSON.stringify({ docKey, comment, expectedCommentGen }) }));
  if (reply.comment !== comment) throw new JournalRefusal("JOURNAL_UNAVAILABLE", `${command} answered for another thread`);
  return reply;
}
