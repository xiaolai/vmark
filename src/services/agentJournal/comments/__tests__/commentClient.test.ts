// WI-AL3.2 — the person's comment client (comment_user_*): a create is a framed request on the tab's flushed buffer naming the head it expects, its selection located in the text it sends, with no author, caller, actor or capture field, and is answered with a decision whose revision becomes the tab's basis; a closed tab sends nothing; a refusal passes through with its code; a reply is framed with no baseline field and a provenance refusal is never resent for it; markAddressed, resolve and reopen each send {docKey, comment, expectedCommentGen} to their own command under a fresh callId; a delete and the list read their replies exactly, and an answer for another thread is malformed
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));

import { invoke } from "@tauri-apps/api/core";
import { agentJournalFake as fake } from "@/test/agentJournalFake";
import { answerPrepare } from "@/test/agentJournalWireFake";
import { JournalRefusal } from "@/services/agentJournal/journalRefusal";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import type { DocumentTab } from "@/stores/tabStoreTypes";
import { journalBasis, resetJournalBases } from "../../documentIdentity";
import { changeCommentState, deleteComment, listComments, replyToComment } from "../commentClient";
import { createComment } from "../commentCreate";

const TAB = "t-1";
const KEY = "path:/a.md";
const DOC = "0190d3c4-0000-7000-8000-0000000000d1";
const REV = "0190d3c4-0000-7000-8000-000000000011";
const TEXT = "# T\n\nhello world\n";
const created = { doc: DOC, comment: "c3", revision: REV, textHash: `sha256-${"a".repeat(64)}`, generation: "5", commentGen: "0" };
const target = { docKey: KEY, comment: "c3", expectedCommentGen: "2" };

type Args = Record<string, unknown>;
const invokeMock = vi.mocked(invoke);
const calls = (command: string): Args[] => invokeMock.mock.calls.filter(([c]) => c === command).map(([, a]) => a as Args);
const payloads = (command: string) => calls(command).map((a) => JSON.parse(String(a.payload)) as Args);

/** Answer `command` with `run(fields)`, framed as the Rust command answers. */
function framed(command: string, run: (fields: Args) => Promise<unknown>) {
  invokeMock.mockImplementation(async (cmd: string, args?: unknown) => (cmd === command ? answerPrepare(args, run) : undefined));
}

const docTab: DocumentTab = { kind: "document", id: TAB, filePath: "/a.md", title: "a", isPinned: false, formatId: "markdown" };

beforeEach(() => {
  fake.reset();
  invokeMock.mockReset();
  invokeMock.mockImplementation(() => Promise.resolve());
  resetJournalBases();
  useDocumentStore.setState({ documents: {} });
  useTabStore.setState({ tabs: { main: [docTab] }, activeTabId: { main: TAB }, untitledCounter: 0 });
  useDocumentStore.getState().initDocument(TAB, TEXT, "/a.md");
});

describe("createComment", () => {
  it("sends the buffer, the expected head and the located selection, and adopts the thread's revision as the basis", async () => {
    framed("comment_user_create", async () => created);
    const at = TEXT.indexOf("world");
    const out = await createComment(TAB, { mode: "markdown", from: at, to: at + 5, selected: "world", text: TEXT }, "<b>why?</b>");
    expect(out).toEqual({ status: "created", created });
    const [sent] = payloads("comment_user_create");
    expect(Object.keys(sent)).toEqual([
      "docKey", "parent", "text", "baselineProvenance", "baselineTouched", "selection", "body", "author",
      "requestId", "incarnation", "webviewGeneration", "pageIdentity",
    ]);
    expect(sent).toMatchObject({ docKey: KEY, parent: null, text: TEXT, body: "<b>why?</b>", author: "", selection: { start: at, end: at + 5, precision: "exact" } });
    expect(journalBasis(TAB, KEY)).toBe(REV);
  });

  it("locates the selection in the text it sends, not the text it was read from", async () => {
    framed("comment_user_create", async () => created);
    await createComment(TAB, { mode: "markdown", from: 0, to: 5, selected: "hello", text: "hello there" }, "x");
    const [sent] = payloads("comment_user_create");
    expect(sent.selection).toEqual({ start: TEXT.indexOf("hello"), end: TEXT.indexOf("hello") + 5, precision: "approximate" });
  });

  it("passes a refusal through with its code", async () => {
    framed("comment_user_create", async () => {
      throw new JournalRefusal("COMMENT_ANCHOR_TOO_LONG", "too long");
    });
    const out = await createComment(TAB, { mode: "wysiwyg", selected: "", estimate: 0 }, "x");
    expect(out).toMatchObject({ status: "refused", refusal: { journalCode: "COMMENT_ANCHOR_TOO_LONG" } });
  });

  it("sends nothing for a closed tab", async () => {
    useDocumentStore.setState({ documents: {} });
    expect(await createComment(TAB, { mode: "wysiwyg", selected: "", estimate: 0 }, "x")).toEqual({ status: "aborted", reason: "closed" });
    expect(calls("comment_user_create")).toEqual([]);
  });
});

describe("replyToComment", () => {
  it("frames the reply with no baseline field and reads the reply", async () => {
    const replied = { doc: DOC, comment: "c3", reply: "r9", generation: "6", commentGen: "3" };
    framed("comment_user_reply", async () => replied);
    expect(await replyToComment(target, "ok")).toEqual(replied);
    const [sent] = payloads("comment_user_reply");
    expect(Object.keys(sent)).toEqual(["docKey", "comment", "body", "author", "expectedCommentGen", "requestId", "incarnation", "webviewGeneration", "pageIdentity"]);
  });

  it("never resends a reply refused for provenance it does not carry", async () => {
    framed("comment_user_reply", async () => {
      throw new JournalRefusal("INVALID_REQUEST", "provenance", undefined, "provenance");
    });
    await expect(replyToComment(target, "ok")).rejects.toMatchObject({ journalCode: "INVALID_REQUEST" });
    expect(calls("comment_user_reply")).toHaveLength(1);
  });
});

describe("the call-bound commands", () => {
  const answer = (command: string, reply: unknown) => invokeMock.mockImplementation(async (cmd) => (cmd === command ? reply : undefined));

  it.each([
    ["markAddressed", "comment_user_mark_addressed", "addressed"],
    ["resolve", "comment_user_resolve", "resolved"],
    ["reopen", "comment_user_reopen", "reopened"],
  ] as const)("%s sends the thread's commentGen to %s", async (action, command, state) => {
    const reply = { doc: DOC, comment: "c3", state, generation: "7", commentGen: "3" };
    answer(command, reply);
    expect(await changeCommentState(action, target)).toEqual(reply);
    expect(payloads(command)).toEqual([{ docKey: KEY, comment: "c3", expectedCommentGen: "2" }]);
  });

  it("an answer for another thread is malformed", async () => {
    answer("comment_user_resolve", { doc: DOC, comment: "c4", state: "resolved", generation: "7", commentGen: "3" });
    await expect(changeCommentState("resolve", target)).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
    answer("comment_user_delete", { doc: DOC, comment: "c4", generation: "7" });
    await expect(deleteComment(target)).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
  });

  it("deletes and lists", async () => {
    answer("comment_user_delete", { doc: DOC, comment: "c3", generation: "8" });
    expect(await deleteComment(target)).toEqual({ doc: DOC, comment: "c3", generation: "8" });
    answer("comment_user_list", { doc: null, generation: "0", threads: [] });
    expect(await listComments(KEY, TEXT)).toEqual({ doc: null, generation: "0", threads: [] });
    expect(payloads("comment_user_list")).toEqual([{ docKey: KEY, text: TEXT }]);
  });
});
