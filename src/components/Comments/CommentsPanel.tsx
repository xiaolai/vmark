/**
 * Comments panel — the focused document's comment threads inside the
 * history popover: add a comment on the selection, and read, reply to,
 * mark addressed, resolve, reopen or delete each thread.
 *
 * Key decisions:
 *   - The list is a journal feed keyed by tab and document, so it is read
 *     again after every journal change in any window. Anchors are resolved
 *     against the tab's text as the store holds it at that read; typing
 *     alone does not re-read.
 *   - A failed read shows none of the old list, so no action is offered on
 *     a thread state the journal may have moved past.
 *   - A thread being replied to that a re-read no longer holds (deleted in
 *     another window) reads "Deleted comment" instead of vanishing.
 *   - Focus is placed by one owner (`useCommentFocus.ts`): every thread
 *     carries its id and generation, and the panel says whether a list is
 *     loaded, so where focus goes is read from what was rendered.
 *   - Which thread is being replied to is kept across the popover closing
 *     (`commentDrafts.ts`), with the reply itself.
 *   - Loaded on demand (`lazyHistoryParts.tsx`): no value import of it may
 *     reach the status bar.
 *
 * @coordinates-with components/McpHistory/McpHistoryButton.tsx — where it mounts
 * @coordinates-with components/McpHistory/useJournalFeed.ts — the live list
 * @coordinates-with components/Comments/useCommentFocus.ts — where focus goes
 * @coordinates-with services/agentJournal/comments/commentClient.ts — the list read
 * @module components/Comments/CommentsPanel
 */

import { useTranslation } from "react-i18next";
import { useDocumentStore } from "@/stores/documentStore";
import { listComments } from "@/services/agentJournal/comments/commentClient";
import { useJournalFeed } from "@/components/McpHistory/useJournalFeed";
import { AddComment } from "./AddComment";
import { CommentThreadView } from "./CommentThreadView";
import { useCommentDraft } from "./commentDrafts";
import { commentRef } from "./commentView";
import { useCommentActions } from "./useCommentActions";
import { useCommentFocus } from "./useCommentFocus";
import "./comments.css";

interface Props {
  tabId: string;
  docKey: string;
  /** Poll interval while the journal's changes are not live, or none. */
  pollMs?: number | null;
}

const SEPARATOR = "\n";

/** The list for a `tabId\ndocKey` feed key, anchored in the tab's current text. */
function readComments(key: string) {
  const at = key.indexOf(SEPARATOR);
  const tabId = key.slice(0, at);
  const text = useDocumentStore.getState().documents[tabId]?.content ?? "";
  return listComments(key.slice(at + 1), text);
}

export function CommentsPanel({ tabId, docKey, pollMs = null }: Props): React.ReactElement {
  const { t } = useTranslation("statusbar");
  const feed = useJournalFeed(`${tabId}${SEPARATOR}${docKey}`, readComments, () => pollMs);
  const actions = useCommentActions(docKey, feed.refresh);
  const [replyingTo, setReplyingTo] = useCommentDraft<string | null>(`replying\n${tabId}\n${docKey}`, null);
  const list = feed.failed ? null : feed.value;
  const replyRef = replyingTo === null ? null : commentRef(replyingTo, list);
  const { intents: focus, sectionRef, onFocus, onBlur } = useCommentFocus(replyingTo);
  const dismiss = () => {
    focus.intend(focus.begin(), { kind: "line" });
    setReplyingTo(null);
  };

  return (
    <section
      ref={sectionRef}
      className="mcp-history-section comments-panel"
      aria-label={t("comments.title")}
      data-list={list ? "loaded" : "none"}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <div className="mcp-history-section__title">{t("comments.title")}</div>
      <AddComment tabId={tabId} onCreated={feed.refresh} focus={focus} />
      {replyRef?.kind === "deleted" && (
        <p className="comments-panel__deleted" role="status">
          {t("comments.deleted")}{" "}
          <button type="button" data-focus="dismiss" className="vm-btn vm-btn--compact" onClick={dismiss}>
            {t("comments.dismiss")}
          </button>
        </p>
      )}
      {feed.failed ? (
        <p role="alert" className="mcp-history-popover__empty">
          {t("comments.loadFailed")}
        </p>
      ) : list && list.threads.length === 0 ? (
        <p className="mcp-history-popover__empty">{t("comments.empty")}</p>
      ) : (
        list && (
          <ul className="comments-panel__list" aria-label={t("comments.listLabel")}>
            {list.threads.map((thread) => (
              <li key={thread.comment} data-comment={thread.comment} data-comment-gen={thread.commentGen}>
                <CommentThreadView docKey={docKey} thread={thread} actions={actions} replying={replyingTo === thread.comment} onReplying={setReplyingTo} focus={focus} />
              </li>
            ))}
          </ul>
        )
      )}
    </section>
  );
}
