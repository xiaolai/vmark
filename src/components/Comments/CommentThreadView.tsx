/**
 * Comment thread view — one comment thread in the comment panel: its state,
 * who wrote it, the quoted text, how its anchor resolves now, its body and
 * replies, the actions the person may take, and the reply box.
 *
 * Key decisions:
 *   - Every string from the journal (body, replies, quote, author) is
 *     rendered as a React text child, never as markup: a body holding HTML
 *     shows its characters and creates no element.
 *   - `author` is display text the writer stored as sent; who wrote it is
 *     the caller the journal recorded from the command family, shown first.
 *   - The buttons are exactly `userActions(state)`.
 *   - The reply being written is kept per thread across the popover
 *     closing (`commentDrafts.ts`). While any action on the document runs
 *     the reply box is read-only and Cancel disabled, so a reply being sent
 *     is neither edited under it nor forgotten.
 *   - It never moves focus itself: each handler says where focus should
 *     go after what it did (`useCommentFocus.ts`) — the reply box when
 *     opened, Reply when it closes, Send when a reply is refused, the
 *     pressed action (or the one now in its place) once the re-read shows
 *     the new state, and the thread's neighbour after a delete. Every
 *     control names itself in `data-focus` for that.
 *
 * @coordinates-with components/Comments/commentView.ts — actions and notes
 * @coordinates-with components/Comments/useCommentActions.ts — what a button does
 * @coordinates-with components/Comments/commentDrafts.ts — the kept reply
 * @coordinates-with components/Comments/useCommentFocus.ts — where focus goes
 * @module components/Comments/CommentThreadView
 */

import { useTranslation } from "react-i18next";
import type { CommentThread, ThreadState } from "@/services/agentJournal/comments/commentReplies";
import { useCommentDraft } from "./commentDrafts";
import { anchorNotes, userActions, type UserCommentAction } from "./commentView";
import type { CommentActions } from "./useCommentActions";
import type { CommentFocusIntents } from "./useCommentFocus";

const STATE_KEYS: Readonly<Record<ThreadState, string>> = {
  open: "comments.stateOpen",
  addressed: "comments.stateAddressed",
  resolved: "comments.stateResolved",
  reopened: "comments.stateReopened",
};

const ACTION_KEYS: Readonly<Record<Exclude<UserCommentAction, "reply">, string>> = {
  markAddressed: "comments.markAddressed",
  resolve: "comments.resolve",
  reopen: "comments.reopen",
  delete: "comments.delete",
};

interface Props {
  /** The document's key: the reply draft is kept under it. */
  docKey: string;
  thread: CommentThread;
  actions: CommentActions;
  replying: boolean;
  onReplying: (comment: string | null) => void;
  focus: CommentFocusIntents;
}

function Author({ caller, author }: { caller: CommentThread["caller"]; author: string }): React.ReactElement {
  const { t } = useTranslation("statusbar");
  return (
    <span className="comments-thread__who">
      {t(caller === "user" ? "comments.byYou" : "comments.byAgent")}
      {author && <span className="comments-thread__author">{author}</span>}
    </span>
  );
}

export function CommentThreadView({ docKey, thread, actions, replying, onReplying, focus }: Props): React.ReactElement {
  const { t } = useTranslation("statusbar");
  const [reply, setReply] = useCommentDraft(`reply\n${docKey}\n${thread.comment}`, "");
  const available = userActions(thread.state);
  const { comment } = thread;
  const toControl = (name: string, index = 0, afterGen: string | null = null) => ({ kind: "control" as const, scope: comment, name, index, afterGen });

  const openReply = () => {
    focus.intend(focus.begin(), toControl("replyBox"));
    onReplying(comment);
  };

  const closeReply = (token: number) => {
    setReply("");
    focus.intend(token, toControl("reply"));
    onReplying(null);
  };

  const sendReply = async () => {
    const token = focus.begin();
    if (await actions.run("reply", thread, reply)) closeReply(token);
    else focus.intend(token, toControl("replySend"));
  };

  const runAction = async (action: UserCommentAction, index: number): Promise<void> => {
    const token = focus.begin();
    const gen = thread.commentGen;
    const recorded = await actions.run(action, thread);
    focus.intend(token, recorded && action === "delete" ? { kind: "leave", comment } : toControl(action, index, recorded ? gen : null));
  };

  return (
    <article className="comments-thread" data-state={thread.state} aria-label={thread.quote}>
      <header className="comments-thread__header">
        <span className="comments-thread__state">{t(STATE_KEYS[thread.state])}</span>
        <Author caller={thread.caller} author={thread.author} />
      </header>
      <blockquote className="comments-thread__quote" title={thread.quote}>
        {thread.quote}
      </blockquote>
      {anchorNotes(thread).map((n) => (
        <p key={n.key} className={`mcp-history-popover__note comments-thread__note${n.attention ? " comments-thread__note--attention" : ""}`}>
          {n.values ? t(n.key, n.values) : t(n.key)}
        </p>
      ))}
      <p className="comments-thread__body">{thread.body}</p>
      {thread.replies.length > 0 && (
        <ul className="comments-thread__replies">
          {thread.replies.map((r) => (
            <li key={r.reply} className="comments-thread__reply">
              <Author caller={r.caller} author={r.author} />
              <p className="comments-thread__body">{r.body}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="comments-thread__actions">
        {available.includes("reply") && !replying && (
          <button type="button" data-action="reply" data-focus="reply" className="vm-btn vm-btn--compact" disabled={actions.busy} onClick={openReply}>
            {t("comments.reply")}
          </button>
        )}
        {available.flatMap((a, i) =>
          a === "reply"
            ? []
            : [
                <button key={a} type="button" data-action={a} data-focus={a} className={`vm-btn vm-btn--compact${a === "delete" ? " vm-btn--danger" : ""}`} disabled={actions.busy} onClick={() => void runAction(a, i)}>
                  {t(ACTION_KEYS[a])}
                </button>,
              ],
        )}
      </div>
      {replying && (
        <div className="comments-thread__compose">
          <textarea
            data-focus="replyBox"
            className="vm-input vm-input--field comments-panel__input"
            rows={2}
            aria-label={t("comments.replyLabel")}
            value={reply}
            readOnly={actions.busy}
            onChange={(e) => setReply(e.target.value)}
          />
          <div className="comments-thread__actions">
            <button type="button" data-focus="replyCancel" className="vm-btn vm-btn--compact" disabled={actions.busy} onClick={() => closeReply(focus.begin())}>
              {t("comments.cancel")}
            </button>
            <button type="button" data-focus="replySend" className="vm-btn vm-btn--compact vm-btn--primary" disabled={actions.busy || reply.trim() === ""} onClick={() => void sendReply()}>
              {t("comments.sendReply")}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
