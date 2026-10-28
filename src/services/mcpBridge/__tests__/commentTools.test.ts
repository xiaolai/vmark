// WI-AL3.3 — the agent's comment tools on the bridge: vmark.comments.list, reply and mark_addressed reach only the comment_agent_ commands for the tab's document key — an untitled tab keyed by the window that holds it, not the focused one (no resolve, reopen or delete is routed), a refusal keeps its token and a malformed comment id is refused before any journal call; document.write, document.transform, selection.set and workflow.apply_patch forward `addresses` to the prepare, send none when absent, refuse a malformed set as INVALID_ADDRESSES before any prepare, and answer the journal's addresses refusal as INVALID_ADDRESSES with nothing changed
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EditorState as CMState } from "@codemirror/state";
import { EditorView as CMView } from "@codemirror/view";

vi.mock("@/services/mcpBridge/utils", () => ({ respond: vi.fn() }));
vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));

import { invoke } from "@tauri-apps/api/core";
import { useTabStore } from "@/stores/tabStore";
import type { DocumentTab } from "@/stores/tabStoreTypes";
import { useDocumentStore } from "@/stores/documentStore";
import { useEditorStore } from "@/stores/editorStore";
import { useUIStore } from "@/stores/uiStore";
import { respond } from "@/services/mcpBridge/utils";
import { ROUTED_OPERATIONS } from "@/services/mcpBridge/v2/dispatch";
import { handleRequest } from "@/services/mcpBridge/handleRequest";
import { handleDocumentTransform, handleDocumentWrite } from "@/services/mcpBridge/v2/document";
import { handleSelectionSet } from "@/services/mcpBridge/v2/selection";
import { handleWorkflowApplyPatch } from "@/services/mcpBridge/v2/workflow";
import { handleCommentsList, handleCommentsMarkAddressed, handleCommentsReply } from "@/services/mcpBridge/v2/comments";
import { JournalRefusal } from "@/services/agentJournal/journalRefusal";
import { answerPrepare } from "@/test/agentJournalWireFake";
import { agentJournalFake as fake } from "@/test/agentJournalFake";
import { TEST_WRITE_CONTEXT as CTX, withAttribution } from "@/test/mcpAttributionFixture";

const WORKFLOW = "name: ci\non:\n  push:\n    branches: [main]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n";
const DOC = "0190d3c4-0000-7000-8000-0000000000d1";
const views: CMView[] = [];

function seed(id: string, text: string, filePath: string | null = null): void {
  const tab: DocumentTab = { kind: "document", id, filePath, title: id, isPinned: false, formatId: "markdown" };
  useTabStore.setState({ tabs: { main: [tab] }, activeTabId: { main: id }, untitledCounter: 0 });
  useDocumentStore.getState().initDocument(id, text, filePath);
}

function mountSource(tabId: string, text: string, from: number, to: number): void {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new CMView({ state: CMState.create({ doc: text, selection: { anchor: from, head: to } }), parent });
  views.push(view);
  useUIStore.setState({ sourceMode: true });
  useEditorStore.getState().setActiveSourceView(view, tabId);
}

function reply(requestId: string) {
  const call = vi.mocked(respond).mock.calls.find(([r]) => r.id === requestId);
  if (!call) throw new Error(`no reply for ${requestId}`);
  return call[0];
}

function refusal(requestId: string): Record<string, unknown> {
  const r = reply(requestId);
  expect(r.success).toBe(false);
  return JSON.parse(r.error ?? "null") as Record<string, unknown>;
}

type Args = Record<string, unknown>;
const invokeMock = vi.mocked(invoke);
const commentCalls = () => invokeMock.mock.calls.filter(([c]) => c.startsWith("comment_"));
const payloadOf = (command: string) => {
  const call = invokeMock.mock.calls.find(([c]) => c === command);
  return JSON.parse(String((call?.[1] as Args).payload)) as Args;
};

/** Answer `command` with `answer`, every other command as the global fake does. */
function answerComment(command: string, answer: (args: unknown) => Promise<unknown>): void {
  const base = invokeMock.getMockImplementation();
  invokeMock.mockImplementation(async (cmd: string, args?: unknown) => (cmd === command ? answer(args) : base?.(cmd, args as never)));
}

beforeEach(() => {
  vi.clearAllMocks();
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useDocumentStore.setState({ documents: {} });
  useUIStore.setState({ sourceMode: false });
});

afterEach(() => {
  useEditorStore.getState().setActiveSourceView(null);
  for (const v of views.splice(0)) {
    v.dom.parentElement?.remove();
    v.destroy();
  }
});

describe("the comment operations the bridge routes", () => {
  it("are list, reply and mark_addressed — never resolve, reopen or delete", () => {
    expect(ROUTED_OPERATIONS.filter((op) => op.startsWith("vmark.comments.")).sort()).toEqual([
      "vmark.comments.list",
      "vmark.comments.mark_addressed",
      "vmark.comments.reply",
    ]);
  });

  it("an agent cannot resolve a comment, and nothing is appended", async () => {
    seed("t1", "x\n");
    const action = "resolve";
    await handleRequest(withAttribution({ id: "x1", type: `vmark.comments.${action}`, args: { commentId: "c3", expectedCommentGen: "2" } }));
    const isError = reply("x1").success === false;
    expect(isError).toBe(true);
    expect(reply("x1").error).toContain("Unknown request type: vmark.comments.resolve");
    expect(commentCalls()).toEqual([]);
    expect(fake.prepareControlledWrite).not.toHaveBeenCalled();
    expect(fake.log).toEqual([]);
  });
});

describe("vmark.comments.*", () => {
  it("list sends the tab's document key and text to comment_agent_list", async () => {
    seed("t1", "# 标题\n\nhello\n", "/notes/a.md");
    const list = { doc: null, generation: "0", threads: [] };
    answerComment("comment_agent_list", async () => list);
    await handleCommentsList("l1", { tabId: "t1" });
    expect(reply("l1")).toMatchObject({ success: true, data: list });
    expect(payloadOf("comment_agent_list")).toEqual({ docKey: "path:/notes/a.md", text: "# 标题\n\nhello\n" });
  });

  it("reply is a framed comment_agent_reply for the thread and commentGen", async () => {
    seed("t1", "x\n");
    const replied = { doc: DOC, comment: "c3", reply: "r9", generation: "6", commentGen: "3" };
    answerComment("comment_agent_reply", (args) => answerPrepare(args, async () => replied));
    await handleCommentsReply("r1", { commentId: "c3", body: "已修复", expectedCommentGen: "2" });
    expect(reply("r1")).toMatchObject({ success: true, data: replied });
    expect(payloadOf("comment_agent_reply")).toMatchObject({ docKey: "tab:main/t1", comment: "c3", body: "已修复", expectedCommentGen: "2" });
  });

  it("mark_addressed sends the thread and commentGen to comment_agent_mark_addressed", async () => {
    seed("t1", "x\n");
    const state = { doc: DOC, comment: "c3", state: "addressed", generation: "7", commentGen: "3" };
    answerComment("comment_agent_mark_addressed", async () => state);
    await handleCommentsMarkAddressed("m1", { commentId: "c3", expectedCommentGen: "2" });
    expect(reply("m1")).toMatchObject({ success: true, data: state });
    expect(payloadOf("comment_agent_mark_addressed")).toEqual({ docKey: "tab:main/t1", comment: "c3", expectedCommentGen: "2" });
  });

  it("an explicit untitled tab in another window is keyed by its own window, for list, reply and mark_addressed", async () => {
    const tab = (id: string): DocumentTab => ({ kind: "document", id, filePath: null, title: id, isPinned: false, formatId: "markdown" });
    useTabStore.setState({ tabs: { main: [tab("t1")], w2: [tab("t2")] }, activeTabId: { main: "t1", w2: "t2" }, untitledCounter: 0 });
    useDocumentStore.getState().initDocument("t1", "focused\n", null);
    useDocumentStore.getState().initDocument("t2", "other window\n", null);
    answerComment("comment_agent_list", async () => ({ doc: null, generation: "0", threads: [] }));
    await handleCommentsList("l2", { tabId: "t2" });
    expect(payloadOf("comment_agent_list")).toEqual({ docKey: "tab:w2/t2", text: "other window\n" });
    answerComment("comment_agent_reply", (args) => answerPrepare(args, async () => ({})));
    await handleCommentsReply("r3", { tabId: "t2", commentId: "c3", body: "ok", expectedCommentGen: "2" });
    expect(payloadOf("comment_agent_reply")).toMatchObject({ docKey: "tab:w2/t2" });
    answerComment("comment_agent_mark_addressed", async () => ({}));
    await handleCommentsMarkAddressed("m4", { tabId: "t2", commentId: "c3", expectedCommentGen: "2" });
    expect(payloadOf("comment_agent_mark_addressed")).toMatchObject({ docKey: "tab:w2/t2" });
  });

  it.each([
    ["STALE_COMMENT", "STALE_COMMENT"],
    ["COMMENT_NOT_ALLOWED", "COMMENT_NOT_ALLOWED"],
    ["COMMENT_STORAGE_FULL", "COMMENT_LIMIT"],
    ["COMMENT_STATE_EXHAUSTED", "COMMENT_LIMIT"],
    ["INVALID_REQUEST", "INVALID_COMMENT"],
    ["JOURNAL_BUSY", "JOURNAL_BUSY"],
  ] as const)("a %s refusal answers %s", async (code, error) => {
    seed("t1", "x\n");
    answerComment("comment_agent_mark_addressed", async () => {
      throw { code: "INVALID_INPUT", message: `${code}: no`, detail: { journalCode: code } };
    });
    await handleCommentsMarkAddressed("m2", { commentId: "c3", expectedCommentGen: "2" });
    expect(refusal("m2")).toMatchObject({ error });
  });

  it.each([
    [{ commentId: "3", expectedCommentGen: "2" }],
    [{ commentId: "c03", expectedCommentGen: "2" }],
    [{ commentId: "c3", expectedCommentGen: "-1" }],
    [{ commentId: "c3" }],
  ])("refuses %o as INVALID_COMMENT before any journal call", async (args) => {
    seed("t1", "x\n");
    await handleCommentsMarkAddressed("m3", args);
    expect(refusal("m3")).toMatchObject({ error: "INVALID_COMMENT" });
    expect(commentCalls()).toEqual([]);
  });

  it("refuses a reply with no body before any journal call", async () => {
    seed("t1", "x\n");
    await handleCommentsReply("r2", { commentId: "c3", expectedCommentGen: "2" });
    expect(refusal("r2")).toMatchObject({ error: "INVALID_COMMENT" });
    expect(commentCalls()).toEqual([]);
  });
});

describe("addresses on the journaled writes", () => {
  const writes = [
    ["document.write", () => seed("t1", "old\n"), (id: string, extra: Args) => handleDocumentWrite(id, { content: "新\n", save: false, ...extra }, CTX)],
    ["document.transform", () => seed("t1", "测试ABC"), (id: string, extra: Args) => handleDocumentTransform(id, { kind: "cjk-spacing", ...extra }, CTX)],
    [
      "selection.set",
      () => {
        seed("t1", "hello world");
        mountSource("t1", "hello world", 6, 11);
      },
      (id: string, extra: Args) => handleSelectionSet(id, { content: "世界", ...extra }, CTX),
    ],
    [
      "workflow.apply_patch",
      () => seed("t1", WORKFLOW, "/repo/.github/workflows/ci.yml"),
      (id: string, extra: Args) => handleWorkflowApplyPatch(id, { patches: [{ kind: "workflow.set", path: "name", value: "x" }], ...extra }, CTX),
    ],
  ] as const;

  it.each(writes)("%s forwards addresses to the prepare", async (tool, setup, run) => {
    setup();
    await run("a1", { addresses: ["c1", "c2"] });
    expect(reply("a1").success).toBe(true);
    expect(fake.prepareControlledWrite).toHaveBeenCalledWith(expect.objectContaining({ tool, addresses: ["c1", "c2"] }));
  });

  it.each(writes)("%s sends no addresses when none are given", async (_, setup, run) => {
    setup();
    await run("a2", {});
    expect(fake.prepareControlledWrite.mock.calls[0][0]).not.toHaveProperty("addresses");
  });

  it.each([["c1"], [["c1", 2]], [["comment-1"]], [["c01"]], [[""]]])("refuses addresses %o as INVALID_ADDRESSES before any prepare", async (addresses) => {
    seed("t1", "old\n");
    await handleDocumentWrite("a3", { content: "new\n", save: false, addresses }, CTX);
    expect(refusal("a3")).toMatchObject({ error: "INVALID_ADDRESSES" });
    expect(fake.prepareControlledWrite).not.toHaveBeenCalled();
    expect(useDocumentStore.getState().documents.t1?.content).toBe("old\n");
  });

  it("answers the journal's addresses refusal as INVALID_ADDRESSES, nothing changed", async () => {
    seed("t1", "old\n");
    fake.prepareControlledWrite.mockRejectedValueOnce(new JournalRefusal("INVALID_REQUEST", "addresses: comment c9 is resolved", null, "addresses"));
    await handleDocumentWrite("a4", { content: "new\n", save: false, addresses: ["c9"] }, CTX);
    expect(refusal("a4")).toMatchObject({ error: "INVALID_ADDRESSES", message: expect.stringContaining("c9 is resolved") });
    expect(useDocumentStore.getState().documents.t1?.content).toBe("old\n");
    expect(fake.log.filter((e) => e.op === "commit")).toEqual([]);
  });
});
