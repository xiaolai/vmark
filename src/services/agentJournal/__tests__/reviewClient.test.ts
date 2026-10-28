// @vitest-environment node
// WI-AL2.3 — the review panel's decisions (`agent_journal_review_decide`): keep, un-keep and mark handled each send one item {hunkId, expectedReviewGen} with the head the panel rendered (null is genesis) as one JSON payload under a fresh callId, and read {generation}; "Clear reviewed" sends every hunk the matrix lets it settle (kept, reverted, superseded, resolvedByHumanEdit) in one batch and none that it cannot, and sends nothing when there is nothing to clear; an empty decision is refused before anything is sent; a reply with a numeric, missing or extra field is malformed (JOURNAL_UNAVAILABLE); a journal refusal such as STALE_REVIEW passes through with its code
import { describe, it, expect, vi, beforeEach } from "vitest";

import { invoke } from "@tauri-apps/api/core";
import type { DocumentHistory, LiveHunk } from "../docHistoryClient";
import { clearReviewed, decideReview, keepHunk, markHunkHandled, unkeepHunk } from "../reviewClient";

const invokeMock = vi.mocked(invoke);
const CMD = "agent_journal_review_decide";
const KEY = "path:/读书.md";
const HEAD = "0190d3c4-0000-7000-8000-000000000002";

const live = (hunkId: string, state: LiveHunk["state"], reviewGen = "3"): LiveHunk => ({
  hunkId,
  kind: "change",
  state,
  target: HEAD,
  baseRange: { from: 0, to: 1 },
  targetRange: { from: 0, to: 1 },
  reviewGen,
  span: { from: 0, to: 1 },
  editedSince: false,
});

const history = (hunks: LiveHunk[], head: string | null = HEAD): DocumentHistory => ({
  generation: "9",
  head,
  rows: [],
  truncated: false,
  hunks,
  blocked: [],
  degraded: false,
});

/** Answer the decide command with `reply` (the transport binds it). */
const answer = (reply: unknown) => invokeMock.mockImplementation(async (cmd) => (cmd === CMD ? reply : undefined));
const sent = () =>
  invokeMock.mock.calls.filter(([cmd]) => cmd === CMD).map(([, args]) => JSON.parse((args as { payload: string }).payload) as unknown);

beforeEach(() => invokeMock.mockReset());

describe("one hunk's decision", () => {
  it.each([
    ["keep", keepHunk],
    ["unkeep", unkeepHunk],
    ["markHandled", markHunkHandled],
  ] as const)("%s sends the hunk's reviewGen and the rendered head, and reads the generation", async (action, decide) => {
    answer({ generation: "18446744073709551615" });
    expect(await decide(KEY, HEAD, live("h:1", "pending", "7"))).toEqual({ generation: "18446744073709551615" });
    expect(sent()).toEqual([{ docKey: KEY, expectedHead: HEAD, action, items: [{ hunkId: "h:1", expectedReviewGen: "7" }] }]);
    // The wire fake checks and strips the callId; callBind.test.ts pins it.
    expect(Object.keys(invokeMock.mock.calls[0][1] as Record<string, unknown>)).toEqual(["payload"]);
  });

  it("sends a null head as genesis, never omits it", async () => {
    answer({ generation: "1" });
    await keepHunk(KEY, null, live("h:1", "pending"));
    expect(sent()).toEqual([expect.objectContaining({ expectedHead: null })]);
  });
});

describe("Clear reviewed", () => {
  it("settles every hunk the matrix lets it settle, in one batch, against the history's head", async () => {
    answer({ generation: "10" });
    const hunks = [
      live("h:p", "pending"),
      live("h:k", "kept", "1"),
      live("h:r", "reverted", "2"),
      live("h:c", "conflicted"),
      live("h:s", "superseded", "4"),
      live("h:h", "resolvedByHumanEdit", "5"),
    ];
    expect(await clearReviewed(KEY, history(hunks))).toEqual({ generation: "10" });
    expect(sent()).toEqual([
      {
        docKey: KEY,
        expectedHead: HEAD,
        action: "clearReviewed",
        items: [
          { hunkId: "h:k", expectedReviewGen: "1" },
          { hunkId: "h:r", expectedReviewGen: "2" },
          { hunkId: "h:s", expectedReviewGen: "4" },
          { hunkId: "h:h", expectedReviewGen: "5" },
        ],
      },
    ]);
  });

  it("sends nothing when nothing can be cleared", async () => {
    answer({ generation: "10" });
    expect(await clearReviewed(KEY, history([live("h:p", "pending"), live("h:c", "conflicted")]))).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("decideReview", () => {
  it("refuses an empty decision before sending anything", async () => {
    await expect(decideReview({ docKey: KEY, expectedHead: HEAD, action: "keep", items: [] })).rejects.toMatchObject({ journalCode: "INVALID_REQUEST" });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it.each([
    ["a numeric generation", { generation: 10 }],
    ["a non-canonical generation", { generation: "010" }],
    ["a missing generation", {}],
    ["an extra field", { generation: "10", head: HEAD }],
    ["no object", null],
  ])("refuses %s as JOURNAL_UNAVAILABLE", async (_label, reply) => {
    answer(reply);
    await expect(keepHunk(KEY, HEAD, live("h:1", "pending"))).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
  });

  it("passes a STALE_REVIEW refusal through with its code", async () => {
    invokeMock.mockRejectedValueOnce({ code: "conflict", message: "moved", detail: { journalCode: "STALE_REVIEW" } });
    await expect(keepHunk(KEY, HEAD, live("h:1", "pending"))).rejects.toMatchObject({ journalCode: "STALE_REVIEW" });
  });
});
