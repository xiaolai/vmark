/**
 * Comment client — the person's comment commands (`comment_user_*`): the
 * create request for the request coordinator, a reply, the state changes,
 * the deletion and the list.
 *
 * Key decisions:
 *   - The command family is the caller: these are the user's commands, so
 *     every record they write names the user. No field names a caller, and
 *     the MCP bridge never imports this file (an import-boundary test pins
 *     it); the agent's family is separate.
 *   - A create and a reply are framed requests (`journalRequest.ts`): the
 *     payload is frozen once, an uncertain answer is retried with the same
 *     bytes and then abandoned, and an identical retry is answered from its
 *     receipt. A create is answered with a decision, never a transaction:
 *     nothing in the buffer changes, and its revision (the recorded
 *     baseline, or the head) is the tab's basis next.
 *   - A state change and a deletion are bound to the `commentGen` the panel
 *     rendered (`STALE_COMMENT` otherwise) and to a fresh call id.
 *   - `author` is display text the journal stores as sent; the person's
 *     comments send none, and the panel labels them by caller.
 *
 * @coordinates-with src-tauri/src/agent_journal/comment/commands_user.rs — the commands
 * @coordinates-with services/agentJournal/comments/commentReplies.ts — the reply decoders
 * @coordinates-with services/agentJournal/journalRequest.ts — the framed requests
 * @module services/agentJournal/comments/commentClient
 */

import type { DecidedReply, JournalBaseRef, PrepareSpec } from "../journalClient";
import { callJournalBound } from "../journalIpc";
import { JournalRefusal } from "../journalRefusal";
import { runPrepareRequest } from "../journalRequest";
import type { JournalProvenancePayload } from "../unsavedProvenance";
import {
  parseCommentCreated,
  parseCommentDeleted,
  parseCommentList,
  parseCommentReplied,
  parseCommentState,
  type CommentCreated,
  type CommentDeleted,
  type CommentList,
  type CommentReplied,
  type CommentStateChanged,
} from "./commentReplies";
import type { CommentSelection } from "./commentSelection";

export interface CommentCreateInput {
  docKey: string;
  /** The head the tab expects; `null` is genesis. */
  parent: string | null;
  observedParent?: JournalBaseRef;
  /** The buffer the selection is in. */
  text: string;
  baselineProvenance: JournalProvenancePayload | null;
  baselineTouched: boolean;
  selection: CommentSelection;
  body: string;
}

/** A create's answer: the thread, recorded on `head`. */
export type CommentCreateReply = DecidedReply<CommentCreated>;

/** A thread the panel acts on: its document, id and the `commentGen` it rendered. */
export interface CommentTarget {
  docKey: string;
  comment: string;
  expectedCommentGen: string;
}

export type CommentStateAction = "markAddressed" | "resolve" | "reopen";

const STATE_COMMANDS: Readonly<Record<CommentStateAction, string>> = {
  markAddressed: "comment_user_mark_addressed",
  resolve: "comment_user_resolve",
  reopen: "comment_user_reopen",
};

/** The create request for the request coordinator (`journaledMutation.ts`). */
export function commentCreatePrepare(input: CommentCreateInput): PrepareSpec<CommentCreateReply> {
  const { docKey, parent, observedParent, text, baselineProvenance, baselineTouched, selection, body } = input;
  const fields = {
    docKey,
    parent,
    ...(observedParent && { observedParent }),
    text,
    baselineProvenance,
    baselineTouched,
    selection,
    body,
    author: "",
  };
  return {
    command: "comment_user_create",
    fields,
    parse: (command, r) => {
      const decision = parseCommentCreated(command, r);
      return { kind: "decided", decision, head: decision.revision };
    },
  };
}

/** Reply to a thread as the person. Throws a `JournalRefusal`. */
export async function replyToComment(target: CommentTarget, body: string): Promise<CommentReplied> {
  const { docKey, comment, expectedCommentGen } = target;
  const fields = { docKey, comment, body, author: "", expectedCommentGen };
  // No transaction: nothing to commit or abort, and a late answer is still a success.
  const run = await runPrepareRequest<CommentReplied & { readonly txn?: never }>({
    docKey,
    build: () => ({
      command: "comment_user_reply",
      fields,
      parse: parseCommentReplied,
    }),
  });
  if (!run.ok) throw run.refusal;
  run.finish();
  return run.prepared;
}

const statePayload = ({ docKey, comment, expectedCommentGen }: CommentTarget) => ({
  payload: JSON.stringify({ docKey, comment, expectedCommentGen }),
});

/** Change a thread's state as the person. Throws a `JournalRefusal`. */
export async function changeCommentState(action: CommentStateAction, target: CommentTarget): Promise<CommentStateChanged> {
  const command = STATE_COMMANDS[action];
  const reply = parseCommentState(command, await callJournalBound(command, statePayload(target)));
  if (reply.comment !== target.comment) throw new JournalRefusal("JOURNAL_UNAVAILABLE", `${command} answered for another thread`);
  return reply;
}

/** Delete a resolved thread. Throws a `JournalRefusal`. */
export async function deleteComment(target: CommentTarget): Promise<CommentDeleted> {
  const command = "comment_user_delete";
  const reply = parseCommentDeleted(command, await callJournalBound(command, statePayload(target)));
  if (reply.comment !== target.comment) throw new JournalRefusal("JOURNAL_UNAVAILABLE", `${command} answered for another thread`);
  return reply;
}

/** A document's threads, anchored in `text` (the window's buffer). Throws a `JournalRefusal`. */
export async function listComments(docKey: string, text: string): Promise<CommentList> {
  const command = "comment_user_list";
  return parseCommentList(command, await callJournalBound(command, { payload: JSON.stringify({ docKey, text }) }));
}
