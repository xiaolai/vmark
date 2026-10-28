// WI-AL3.3 — the agent's comment client (comment_agent_*): the list sends {docKey, text} to comment_agent_list and reads the user list's reply shape; a reply is a framed request to comment_agent_reply with no baseline field, its request id minted once by the client; markAddressed sends {docKey, comment, expectedCommentGen} to comment_agent_mark_addressed; an answer for another thread is malformed; refusals pass through with their code; the client offers no resolve, reopen or delete and never names a comment_user_ command
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));

import { invoke } from "@tauri-apps/api/core";
import { answerPrepare } from "@/test/agentJournalWireFake";
import { JournalRefusal } from "@/services/agentJournal/journalRefusal";
import * as client from "../agentCommentClient";

const KEY = "path:/a.md";
const DOC = "0190d3c4-0000-7000-8000-0000000000d1";
const TEXT = "# T\n\nhello 世界\n";
const target = { docKey: KEY, comment: "c3", expectedCommentGen: "2" };

type Args = Record<string, unknown>;
const invokeMock = vi.mocked(invoke);
const calls = (command: string): Args[] => invokeMock.mock.calls.filter(([c]) => c === command).map(([, a]) => a as Args);
const payloads = (command: string) => calls(command).map((a) => JSON.parse(String(a.payload)) as Args);
const answer = (command: string, reply: unknown) => invokeMock.mockImplementation(async (cmd) => (cmd === command ? reply : undefined));

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(() => Promise.resolve());
});

describe("the agent comment client", () => {
  it("lists through comment_agent_list with the window's text", async () => {
    answer("comment_agent_list", { doc: null, generation: "0", threads: [] });
    expect(await client.listCommentsForAgent(KEY, TEXT)).toEqual({ doc: null, generation: "0", threads: [] });
    expect(payloads("comment_agent_list")).toEqual([{ docKey: KEY, text: TEXT }]);
  });

  it("frames a reply to comment_agent_reply with no baseline field, minting the request id itself", async () => {
    const replied = { doc: DOC, comment: "c3", reply: "r9", generation: "6", commentGen: "3" };
    invokeMock.mockImplementation(async (cmd: string, args?: unknown) => (cmd === "comment_agent_reply" ? answerPrepare(args, async () => replied) : undefined));
    expect(await client.replyAsAgent(target, "fixed in 第二段")).toEqual(replied);
    const [sent] = payloads("comment_agent_reply");
    expect(Object.keys(sent)).toEqual(["docKey", "comment", "body", "author", "expectedCommentGen", "requestId", "incarnation", "webviewGeneration", "pageIdentity"]);
    expect(sent).toMatchObject({ docKey: KEY, comment: "c3", body: "fixed in 第二段", author: "", expectedCommentGen: "2" });
    expect(sent.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("passes a reply refusal through with its code", async () => {
    invokeMock.mockImplementation(async (cmd: string, args?: unknown) =>
      cmd === "comment_agent_reply"
        ? answerPrepare(args, async () => {
            throw new JournalRefusal("STALE_COMMENT", "moved");
          })
        : undefined,
    );
    await expect(client.replyAsAgent(target, "ok")).rejects.toMatchObject({ journalCode: "STALE_COMMENT" });
  });

  it("marks addressed through comment_agent_mark_addressed with the thread's commentGen", async () => {
    const reply = { doc: DOC, comment: "c3", state: "addressed", generation: "7", commentGen: "3" };
    answer("comment_agent_mark_addressed", reply);
    expect(await client.markAddressedAsAgent(target)).toEqual(reply);
    expect(payloads("comment_agent_mark_addressed")).toEqual([{ docKey: KEY, comment: "c3", expectedCommentGen: "2" }]);
  });

  it("refuses an answer for another thread as malformed", async () => {
    answer("comment_agent_mark_addressed", { doc: DOC, comment: "c4", state: "addressed", generation: "7", commentGen: "3" });
    await expect(client.markAddressedAsAgent(target)).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
  });

  it("offers no resolve, reopen or delete, and names only comment_agent_ commands", () => {
    expect(Object.keys(client).sort()).toEqual(["listCommentsForAgent", "markAddressedAsAgent", "replyAsAgent"]);
    const code = readFileSync(resolve(import.meta.dirname, "../agentCommentClient.ts"), "utf8");
    expect(code).not.toMatch(/["'`]comment_user_/);
    expect(code.match(/["'`]comment_[a-z_]+["'`]/g)?.sort()).toEqual(['"comment_agent_list"', '"comment_agent_mark_addressed"', '"comment_agent_reply"']);
  });
});
