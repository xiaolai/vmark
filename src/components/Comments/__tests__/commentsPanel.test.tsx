// WI-AL3.2 — the comments panel through the real client: it lists the document's threads anchored in the tab's text, with ambiguous (and its count) and orphaned anchors, and "creation revision no longer retained" on a thread reopened after its creation revision was collected; the person's buttons are exactly the user column of the matrix; reopen and resolve send the rendered commentGen to their own command and re-read; a STALE_COMMENT refusal is told and re-read; delete asks first and sends nothing when cancelled; a reply is sent and the box closes, and while it is sent the box is neither edited nor cancelled; a thread being replied to that a re-read no longer holds reads "Deleted comment"; a failed read shows no thread
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("@/services/ime/imeToast", () => ({ imeToast: toast }));

import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { resolveKey } from "@/test/i18nResolve";
import { agentJournalFake as fake } from "@/test/agentJournalFake";
import { answerPrepare } from "@/test/agentJournalWireFake";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { JournalRefusal } from "@/services/agentJournal/journalRefusal";
import type { CommentThread } from "@/services/agentJournal/comments/commentReplies";
import { CommentsPanel } from "../CommentsPanel";
import { forgetCommentDrafts } from "../commentDrafts";
import { releaseCommentAction } from "../commentActionLock";

const TAB = "t-1";
const KEY = "path:/a.md";
const DOC = "0190d3c4-0000-7000-8000-0000000000d1";
const TEXT = "# T\n\nhello world\n";
const en = (key: string, values?: Record<string, unknown>) => resolveKey(key, ["statusbar"], values);

const thread = (comment: string, over: Partial<CommentThread> = {}): CommentThread => ({
  comment,
  state: "open",
  commentGen: "2",
  revision: "0190d3c4-0000-7000-8000-000000000011",
  creationRetained: true,
  quote: `quote of ${comment}`,
  body: `body of ${comment}`,
  author: "",
  caller: "user",
  replies: [],
  anchor: { status: "resolved", tier: "context", start: 5, end: 10, byHint: true },
  ...over,
});

type Args = Record<string, unknown>;
let threads: CommentThread[];
let listFails = false;
let answer: (command: string, args: Args) => Promise<unknown>;

const payloads = (command: string) =>
  vi.mocked(invoke).mock.calls.filter(([c]) => c === command).map(([, a]) => JSON.parse(String((a as Args).payload)) as Args);
const listReads = () => payloads("comment_user_list").length;
const article = (comment: string) => screen.findByRole("article", { name: `quote of ${comment}` });
const buttonNames = (el: HTMLElement) => within(el).queryAllByRole("button").map((b) => b.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  fake.reset();
  forgetCommentDrafts();
  releaseCommentAction(KEY);
  threads = [];
  listFails = false;
  answer = async () => undefined;
  vi.mocked(invoke).mockImplementation(async (command: string, args?: unknown) => {
    if (command === "comment_user_list") {
      if (listFails) throw new JournalRefusal("JOURNAL_IO", "disk");
      return { doc: DOC, generation: "3", threads };
    }
    return answer(command, args as Args);
  });
  useDocumentStore.setState({ documents: {} });
  useTabStore.setState({
    tabs: { main: [{ kind: "document", id: TAB, filePath: "/a.md", title: "a", isPinned: false, formatId: "markdown" }] },
    activeTabId: { main: TAB },
    untitledCounter: 0,
  });
  useDocumentStore.getState().initDocument(TAB, TEXT, "/a.md");
});

describe("CommentsPanel — the list", () => {
  it("reads the threads anchored in the tab's text and shows each anchor's state", async () => {
    threads = [
      thread("c1", { anchor: { status: "ambiguous", tier: "context", candidates: [5, 9] } }),
      thread("c2", { anchor: { status: "orphaned" } }),
    ];
    render(<CommentsPanel tabId={TAB} docKey={KEY} />);

    // Ambiguous and orphaned anchors need the person's attention, unlike the informational notes.
    expect(await screen.findByText(en("comments.anchorAmbiguous", { count: 2 }))).toHaveClass("comments-thread__note--attention");
    expect(screen.getByText(en("comments.anchorOrphaned"))).toHaveClass("comments-thread__note--attention");
    expect(payloads("comment_user_list")[0]).toEqual({ docKey: KEY, text: TEXT });
  });

  it("shows a thread reopened after GC as no longer retained, with reopen gone and resolve offered", async () => {
    threads = [thread("c1", { state: "reopened", creationRetained: false, anchor: { status: "orphaned" } })];
    render(<CommentsPanel tabId={TAB} docKey={KEY} />);

    const el = await article("c1");
    expect(within(el).getByText(en("comments.creationNotRetained"))).toBeInTheDocument();
    expect(buttonNames(el)).toEqual([en("comments.reply"), en("comments.markAddressed"), en("comments.resolve")]);
  });

  it("offers exactly the user column of the matrix in each state", async () => {
    threads = [thread("c1", { state: "open" }), thread("c2", { state: "addressed" }), thread("c3", { state: "resolved" })];
    render(<CommentsPanel tabId={TAB} docKey={KEY} />);

    expect(buttonNames(await article("c1"))).toEqual([en("comments.reply"), en("comments.markAddressed"), en("comments.resolve")]);
    expect(buttonNames(await article("c2"))).toEqual([en("comments.reply"), en("comments.resolve")]);
    expect(buttonNames(await article("c3"))).toEqual([en("comments.reply"), en("comments.reopen"), en("comments.delete")]);
  });

  it("shows no thread when the read fails", async () => {
    listFails = true;
    render(<CommentsPanel tabId={TAB} docKey={KEY} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(en("comments.loadFailed"));
    expect(screen.queryByRole("article")).toBeNull();
  });
});

describe("CommentsPanel — the person's actions", () => {
  it("reopen sends the rendered commentGen to comment_user_reopen and re-reads", async () => {
    threads = [thread("c1", { state: "resolved" })];
    answer = async (command) => {
      if (command !== "comment_user_reopen") return undefined;
      threads = [thread("c1", { state: "reopened", commentGen: "3" })];
      return { doc: DOC, comment: "c1", state: "reopened", generation: "4", commentGen: "3" };
    };
    const user = userEvent.setup();
    render(<CommentsPanel tabId={TAB} docKey={KEY} />);

    await user.click(within(await article("c1")).getByRole("button", { name: en("comments.reopen") }));

    expect(payloads("comment_user_reopen")).toEqual([{ docKey: KEY, comment: "c1", expectedCommentGen: "2" }]);
    expect(await screen.findByText(en("comments.stateReopened"))).toBeInTheDocument();
    expect(listReads()).toBeGreaterThanOrEqual(2);
  });

  it("a STALE_COMMENT refusal is told, and the list is read again", async () => {
    threads = [thread("c1")];
    answer = async (command) => {
      if (command === "comment_user_resolve") throw new JournalRefusal("STALE_COMMENT", "moved");
    };
    const user = userEvent.setup();
    render(<CommentsPanel tabId={TAB} docKey={KEY} />);
    await user.click(within(await article("c1")).getByRole("button", { name: en("comments.resolve") }));

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(en("comments.refusedStale")));
    await waitFor(() => expect(listReads()).toBeGreaterThanOrEqual(2));
  });

  it("delete asks first, and sends nothing when cancelled", async () => {
    threads = [thread("c1", { state: "resolved" })];
    answer = async (command) => (command === "comment_user_delete" ? { doc: DOC, comment: "c1", generation: "5" } : undefined);
    vi.mocked(ask).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const user = userEvent.setup();
    render(<CommentsPanel tabId={TAB} docKey={KEY} />);
    const del = within(await article("c1")).getByRole("button", { name: en("comments.delete") });

    await user.click(del);
    expect(ask).toHaveBeenCalledWith(en("comments.deleteMessage"), expect.objectContaining({ title: en("comments.deleteTitle"), kind: "warning" }));
    expect(payloads("comment_user_delete")).toEqual([]);

    await user.click(within(await article("c1")).getByRole("button", { name: en("comments.delete") }));
    await waitFor(() => expect(payloads("comment_user_delete")).toEqual([{ docKey: KEY, comment: "c1", expectedCommentGen: "2" }]));
  });

  it("sends a reply and closes the box", async () => {
    threads = [thread("c1")];
    answer = async (command, args) =>
      command === "comment_user_reply" ? answerPrepare(args, async () => ({ doc: DOC, comment: "c1", reply: "r4", generation: "4", commentGen: "3" })) : undefined;
    const user = userEvent.setup();
    render(<CommentsPanel tabId={TAB} docKey={KEY} />);

    await user.click(within(await article("c1")).getByRole("button", { name: en("comments.reply") }));
    await user.type(screen.getByRole("textbox", { name: en("comments.replyLabel") }), "done");
    await user.click(screen.getByRole("button", { name: en("comments.sendReply") }));

    await waitFor(() => expect(payloads("comment_user_reply")).toHaveLength(1));
    expect(payloads("comment_user_reply")[0]).toMatchObject({ docKey: KEY, comment: "c1", body: "done", author: "", expectedCommentGen: "2" });
    await waitFor(() => expect(screen.queryByRole("textbox", { name: en("comments.replyLabel") })).toBeNull());
  });

  it("while a reply is sent, neither edits it nor cancels it, and frees both once it is answered", async () => {
    threads = [thread("c1")];
    let refuse: (e: unknown) => void = () => {};
    answer = async (command, args) =>
      command === "comment_user_reply" ? answerPrepare(args, () => new Promise((_resolve, reject) => (refuse = reject))) : undefined;
    const user = userEvent.setup();
    render(<CommentsPanel tabId={TAB} docKey={KEY} />);

    await user.click(within(await article("c1")).getByRole("button", { name: en("comments.reply") }));
    const box = screen.getByRole("textbox", { name: en("comments.replyLabel") });
    await user.type(box, "done");
    await user.click(screen.getByRole("button", { name: en("comments.sendReply") }));
    await waitFor(() => expect(payloads("comment_user_reply")).toHaveLength(1));

    expect(box).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: en("comments.cancel") })).toBeDisabled();
    await user.type(box, " more");
    expect(box).toHaveValue("done");

    refuse(new JournalRefusal("STALE_COMMENT", "moved"));
    await waitFor(() => expect(box).not.toHaveAttribute("readonly"));
    expect(box).toHaveValue("done");
    expect(screen.getByRole("button", { name: en("comments.cancel") })).toBeEnabled();
  });

  it("a thread being replied to that a re-read no longer holds reads Deleted comment", async () => {
    threads = [thread("c1"), thread("c2")];
    answer = async (command) => {
      if (command !== "comment_user_resolve") return undefined;
      threads = [thread("c2", { state: "resolved" })];
      return { doc: DOC, comment: "c2", state: "resolved", generation: "4", commentGen: "3" };
    };
    const user = userEvent.setup();
    render(<CommentsPanel tabId={TAB} docKey={KEY} />);

    await user.click(within(await article("c1")).getByRole("button", { name: en("comments.reply") }));
    // Another window deletes c1; this window's next re-read (after its own action) no longer holds it.
    await user.click(within(await article("c2")).getByRole("button", { name: en("comments.resolve") }));

    expect(await screen.findByRole("status")).toHaveTextContent(en("comments.deleted"));
    await user.click(screen.getByRole("button", { name: en("comments.dismiss") }));
    expect(screen.queryByText(en("comments.deleted"))).toBeNull();
  });
});
