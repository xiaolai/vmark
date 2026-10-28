/**
 * Comment actions — the comment panel's reply, mark addressed, resolve,
 * reopen and delete, one at a time, each refusal told to the person and
 * every action followed by a fresh read of the list.
 *
 * Key decisions:
 *   - Each action names the `commentGen` the panel rendered, so an action on
 *     a thread that moved since (another window, the agent) is refused
 *     `STALE_COMMENT` and the re-read shows where it is now.
 *   - Delete is irreversible, so it asks first; only a resolved thread
 *     offers it, and the journal refuses it in any other state.
 *   - After any action, whatever its result, the list is read again.
 *   - `busy` is the document's action lock (`commentActionLock.ts`), so a
 *     panel reopened while an action runs is busy too and starts no other.
 *
 * @coordinates-with services/agentJournal/comments/commentClient.ts — the commands
 * @coordinates-with components/Comments/commentView.ts — the messages
 * @coordinates-with components/Comments/commentActionLock.ts — one action at a time
 * @module components/Comments/useCommentActions
 */

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { imeToast as toast } from "@/services/ime/imeToast";
import { confirmAction } from "@/services/dialogs/confirmAction";
import { changeCommentState, deleteComment, replyToComment, type CommentTarget } from "@/services/agentJournal/comments/commentClient";
import type { CommentThread } from "@/services/agentJournal/comments/commentReplies";
import { journalWarn } from "@/utils/debug";
import { releaseCommentAction, takeCommentAction, useCommentActionLock } from "./commentActionLock";
import { errorNotice, type CommentNotice, type UserCommentAction } from "./commentView";

export interface CommentActions {
  busy: boolean;
  /** Run `action` on `thread` (`body` for a reply); resolves whether it was recorded. */
  run: (action: UserCommentAction, thread: CommentThread, body?: string) => Promise<boolean>;
}

export function useCommentActions(docKey: string, onChanged: () => void): CommentActions {
  const { t } = useTranslation("statusbar");
  const busy = useCommentActionLock(docKey);

  const tell = useCallback((n: CommentNotice) => toast[n.tone](n.values ? t(n.key, n.values) : t(n.key)), [t]);

  const send = useCallback(
    async (action: UserCommentAction, target: CommentTarget, body: string): Promise<boolean> => {
      switch (action) {
        case "reply":
          await replyToComment(target, body);
          return true;
        case "delete": {
          const confirmed = await confirmAction({
            title: t("comments.deleteTitle"),
            message: t("comments.deleteMessage"),
            actionLabel: t("comments.deleteAction"),
            kind: "warning",
          });
          if (!confirmed) return false;
          await deleteComment(target);
          return true;
        }
        default:
          await changeCommentState(action, target);
          return true;
      }
    },
    [t],
  );

  const run = useCallback(
    async (action: UserCommentAction, thread: CommentThread, body = ""): Promise<boolean> => {
      if (!takeCommentAction(docKey)) return false;
      try {
        return await send(action, { docKey, comment: thread.comment, expectedCommentGen: thread.commentGen }, body);
      } catch (e) {
        journalWarn("comment action failed:", e);
        tell(errorNotice(e));
        return false;
      } finally {
        releaseCommentAction(docKey);
        onChanged();
      }
    },
    [docKey, send, tell, onChanged],
  );

  return { busy, run };
}
