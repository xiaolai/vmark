/**
 * Add comment — the comment panel's "Comment on selection": takes the
 * editor's selection when clicked, shows what it will quote, and sends the
 * comment through the journaled create.
 *
 * Key decisions:
 *   - The selection is read once, on the click, while the editor still
 *     holds it: opening the popover moved focus, not the selection. Typing
 *     the comment does not change what it is anchored to.
 *   - A caret (empty selection) is allowed: the journal anchors it to the
 *     block it is in, and the preview says so.
 *   - A WYSIWYG selection that could not be mapped onto the Markdown
 *     exactly is sent as approximate, and the journal stores it widened to
 *     whole blocks; the preview says the whole block will be quoted.
 *   - No editor selection to read (none mounted, or mounting) is told, not
 *     guessed.
 *   - The draft (selection and body) is kept per tab across the popover
 *     closing (`commentDrafts.ts`); cancel and success forget it, in
 *     whichever panel is open when the create lands.
 *   - Sending a draft takes a lock keyed by the draft (`commentActionLock.ts`),
 *     not component state: a panel reopened while the create runs mounts
 *     busy and cannot send the same draft again. It is not the document's
 *     lock, so a thread action may still run beside a create. While the
 *     create runs the body is read-only and Cancel disabled, so nothing
 *     typed after Submit is silently dropped and the draft cannot be
 *     forgotten under the create.
 *   - It never moves focus itself; each handler says where focus should go
 *     (`useCommentFocus.ts`): the body when the draft opens, the button when
 *     it closes (cancel or success), Submit after a refusal or an abort. Its
 *     draft is its own state, so it resolves those intents after its own
 *     renders too.
 *
 * @coordinates-with services/agentJournal/comments/commentCreate.ts — the selection and the create
 * @coordinates-with components/Comments/commentView.ts — the messages
 * @coordinates-with components/Comments/commentDrafts.ts — the kept draft
 * @coordinates-with components/Comments/commentActionLock.ts — one send per draft
 * @coordinates-with components/Comments/useCommentFocus.ts — where focus goes
 * @module components/Comments/AddComment
 */

import { useLayoutEffect } from "react";
import { useTranslation } from "react-i18next";
import { imeToast as toast } from "@/services/ime/imeToast";
import { createComment, readCommentSelection } from "@/services/agentJournal/comments/commentCreate";
import type { EditorSelection } from "@/services/agentJournal/comments/commentSelection";
import { journalWarn } from "@/utils/debug";
import { releaseCommentAction, takeCommentAction, useCommentActionLock } from "./commentActionLock";
import { useCommentDraft } from "./commentDrafts";
import { createNotice, errorNotice, type CommentNotice } from "./commentView";
import type { CommentFocusIntents } from "./useCommentFocus";

interface Props {
  tabId: string;
  onCreated: () => void;
  focus: CommentFocusIntents;
}

interface Draft {
  selection: EditorSelection;
  body: string;
}

const toControl = (name: string) => ({ kind: "control" as const, scope: "add", name, index: 0, afterGen: null });

export function AddComment({ tabId, onCreated, focus }: Props): React.ReactElement {
  const { t } = useTranslation("statusbar");
  const draftKey = `add\n${tabId}`;
  const [draft, setDraft] = useCommentDraft<Draft | null>(draftKey, null);
  const busy = useCommentActionLock(draftKey);
  useLayoutEffect(() => focus.settle());
  const tell = (n: CommentNotice) => toast[n.tone](n.values ? t(n.key, n.values) : t(n.key));

  const start = () => {
    let sel: EditorSelection | null;
    try {
      sel = readCommentSelection(tabId);
    } catch (e) {
      journalWarn("comment selection unreadable:", e);
      tell(errorNotice(e));
      return;
    }
    if (!sel) {
      toast.info(t("comments.noSelection"));
      return;
    }
    focus.intend(focus.begin(), toControl("addBody"));
    setDraft({ selection: sel, body: "" });
  };

  const close = (token: number) => {
    focus.intend(token, toControl("addButton"));
    setDraft(null);
  };

  const submit = async () => {
    if (!draft || !takeCommentAction(draftKey)) return;
    const token = focus.begin();
    try {
      const outcome = await createComment(tabId, draft.selection, draft.body);
      tell(createNotice(outcome));
      if (outcome.status === "created") close(token);
      else focus.intend(token, toControl("addSubmit"));
    } catch (e) {
      journalWarn("comment create failed:", e);
      tell(errorNotice(e));
      focus.intend(token, toControl("addSubmit"));
    } finally {
      releaseCommentAction(draftKey);
      onCreated();
    }
  };

  if (!draft) {
    return (
      <div className="comments-panel__add">
        <button type="button" data-focus="addButton" className="vm-btn vm-btn--compact" onClick={start}>
          {t("comments.add")}
        </button>
      </div>
    );
  }

  const { selection, body } = draft;
  return (
    <div className="comments-panel__add comments-thread__compose">
      {selection.selected === "" ? (
        <p className="mcp-history-popover__note">{t("comments.onCaret")}</p>
      ) : (
        <blockquote className="comments-thread__quote" title={selection.selected}>
          {selection.selected}
        </blockquote>
      )}
      {/* An unmapped WYSIWYG selection is a guess; the journal stores it widened to whole blocks. */}
      {selection.mode === "wysiwyg" && <p className="mcp-history-popover__note">{t("comments.widened")}</p>}
      <textarea
        data-focus="addBody"
        className="vm-input vm-input--field comments-panel__input"
        rows={3}
        aria-label={t("comments.bodyLabel")}
        value={body}
        readOnly={busy}
        onChange={(e) => setDraft({ selection, body: e.target.value })}
      />
      <div className="comments-thread__actions">
        <button type="button" data-focus="addCancel" className="vm-btn vm-btn--compact" disabled={busy} onClick={() => close(focus.begin())}>
          {t("comments.cancel")}
        </button>
        <button type="button" data-focus="addSubmit" className="vm-btn vm-btn--compact vm-btn--primary" disabled={busy || body.trim() === ""} onClick={() => void submit()}>
          {t("comments.submit")}
        </button>
      </div>
    </div>
  );
}
