// @vitest-environment node
// WI-AL3.2 — the comment reply decoders read every reply exactly: the state and deletion replies, and the list with its threads, replies and the three anchor states (resolved with its tier and hint, ambiguous with its candidates, orphaned); a missing or extra field, a non-canonical id or counter, an unknown state, caller or tier, or a reversed range is malformed (JOURNAL_UNAVAILABLE), never read
import { describe, it, expect } from "vitest";
import { parseCommentDeleted, parseCommentList, parseCommentState } from "../commentReplies";

const DOC = "0190d3c4-0000-7000-8000-0000000000d1";
const REV = "0190d3c4-0000-7000-8000-000000000011";

const thread = () => ({
  comment: "c7",
  state: "open",
  commentGen: "18446744073709551613",
  revision: REV,
  creationRetained: false,
  quote: "hello",
  body: "<img src=x onerror=alert(1)>",
  author: "Reviewer",
  caller: "user",
  replies: [{ reply: "r9", body: "ok", author: "Agent", caller: "agent" }],
  anchor: { status: "resolved", tier: "context", start: 9, end: 14, byHint: false },
});

const list = () => ({ doc: DOC, generation: "9007199254740993", threads: [thread()] });

const refuses = (run: () => unknown) => {
  expect(run).toThrow(expect.objectContaining({ journalCode: "JOURNAL_UNAVAILABLE" }));
};

describe("parseCommentState", () => {
  const reply = { doc: DOC, comment: "c7", state: "resolved", generation: "3", commentGen: "1" };

  it("reads a state reply whole", () => {
    expect(parseCommentState("comment_user_resolve", reply)).toEqual(reply);
  });

  it.each([
    ["an unknown state", { ...reply, state: "deleted" }],
    ["a non-canonical comment id", { ...reply, comment: "c07" }],
    ["a reply id for a comment", { ...reply, comment: "r7" }],
    ["a numeric generation", { ...reply, generation: 3 }],
    ["an extra field", { ...reply, extra: true }],
    ["a missing field", { doc: DOC, comment: "c7", state: "open", generation: "3" }],
  ])("refuses %s", (_what, r) => {
    refuses(() => parseCommentState("comment_user_resolve", r));
  });
});

describe("parseCommentDeleted", () => {
  it("reads a deletion and refuses a state reply in its place", () => {
    const reply = { doc: DOC, comment: "c7", generation: "4" };
    expect(parseCommentDeleted("comment_user_delete", reply)).toEqual(reply);
    refuses(() => parseCommentDeleted("comment_user_delete", { ...reply, state: "resolved", commentGen: "1" }));
  });
});

describe("parseCommentList", () => {
  it("reads a list with every field kept, the body untouched", () => {
    expect(parseCommentList("comment_user_list", list())).toEqual(list());
  });

  it("reads an unknown document as no threads", () => {
    const empty = { doc: null, generation: "0", threads: [] };
    expect(parseCommentList("comment_user_list", empty)).toEqual(empty);
  });

  it.each([
    ["ambiguous", { status: "ambiguous", tier: "anywhere", candidates: [0, 40] }],
    ["orphaned", { status: "orphaned" }],
    ["resolved by hint", { status: "resolved", tier: "headingPath", start: 0, end: 0, byHint: true }],
  ])("reads an anchor that is %s", (_what, anchor) => {
    const r = { ...list(), threads: [{ ...thread(), anchor }] };
    expect(parseCommentList("comment_user_list", r).threads[0].anchor).toEqual(anchor);
  });

  it.each([
    ["an unknown anchor status", { status: "lost" }],
    ["an unknown tier", { status: "ambiguous", tier: "fuzzy", candidates: [1] }],
    ["a reversed range", { status: "resolved", tier: "context", start: 5, end: 4, byHint: false }],
    ["a fractional offset", { status: "resolved", tier: "context", start: 1.5, end: 4, byHint: false }],
    ["an orphan with offsets", { status: "orphaned", start: 0 }],
    ["an ambiguous anchor with no candidate", { status: "ambiguous", tier: "context", candidates: [] }],
  ])("refuses %s", (_what, anchor) => {
    refuses(() => parseCommentList("comment_user_list", { ...list(), threads: [{ ...thread(), anchor }] }));
  });

  it.each([
    ["an unknown caller", { caller: "system" }],
    ["a forged extra field", { deleted: true }],
    ["a missing creationRetained", { creationRetained: undefined }],
    ["a body that is not text", { body: 1 }],
  ])("refuses a thread with %s", (_what, patch) => {
    const t = JSON.parse(JSON.stringify({ ...thread(), ...patch })) as unknown;
    refuses(() => parseCommentList("comment_user_list", { ...list(), threads: [t] }));
  });

  it("refuses a reply with an extra field or a comment id", () => {
    const bad = [{ reply: "c9", body: "x", author: "a", caller: "user" }];
    refuses(() => parseCommentList("comment_user_list", { ...list(), threads: [{ ...thread(), replies: bad }] }));
    const extra = [{ reply: "r9", body: "x", author: "a", caller: "user", at: 1 }];
    refuses(() => parseCommentList("comment_user_list", { ...list(), threads: [{ ...thread(), replies: extra }] }));
  });

  it("accepts an empty body and author (display text, not ids)", () => {
    const r = { ...list(), threads: [{ ...thread(), body: "", author: "", quote: "" }] };
    expect(parseCommentList("comment_user_list", r).threads[0].body).toBe("");
  });
});
