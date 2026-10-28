// @vitest-environment node
// WI-AL3.2 — the comment panel's view model: the person's actions in each state follow R36's user column (reply in every state, markAddressed from open or reopened, resolve from open, addressed or reopened, reopen from resolved only, delete when resolved only), so the panel never offers a refused cell; the anchor notes say ambiguous with its count, orphaned, found by heading or anywhere, and "creation revision no longer retained" after a reopen past GC; an id the list no longer holds is a deleted comment; every refusal and abort has its own message; an ambiguous or orphaned anchor's note asks for attention, the informational notes do not
import { describe, it, expect } from "vitest";
import { JournalRefusal } from "@/services/agentJournal/journalRefusal";
import type { CommentList, CommentThread, ThreadState } from "@/services/agentJournal/comments/commentReplies";
import { anchorNotes, commentRef, createNotice, errorNotice, userActions } from "../commentView";

const thread = (over: Partial<CommentThread> = {}): CommentThread => ({
  comment: "c1",
  state: "open",
  commentGen: "0",
  revision: "0190d3c4-0000-7000-8000-000000000011",
  creationRetained: true,
  quote: "hello",
  body: "why?",
  author: "",
  caller: "user",
  replies: [],
  anchor: { status: "resolved", tier: "context", start: 0, end: 5, byHint: true },
  ...over,
});

describe("userActions — the user column of the R36 matrix", () => {
  it.each<[ThreadState, string[]]>([
    ["open", ["reply", "markAddressed", "resolve"]],
    ["addressed", ["reply", "resolve"]],
    ["reopened", ["reply", "markAddressed", "resolve"]],
    ["resolved", ["reply", "reopen", "delete"]],
  ])("the full matrix: %s offers %j", (state, actions) => {
    expect(userActions(state)).toEqual(actions);
  });

  it("offers reopen only on a resolved thread, and delete only there", () => {
    for (const s of ["open", "addressed", "reopened"] as const) {
      expect(userActions(s)).not.toContain("reopen");
      expect(userActions(s)).not.toContain("delete");
    }
  });
});

describe("anchorNotes", () => {
  it("says nothing for a thread found by its context on a retained revision", () => {
    expect(anchorNotes(thread())).toEqual([]);
  });

  it("names the count of an ambiguous anchor", () => {
    expect(anchorNotes(thread({ anchor: { status: "ambiguous", tier: "context", candidates: [3, 40, 90] } }))).toEqual([
      { key: "comments.anchorAmbiguous", values: { count: 3 }, attention: true },
    ]);
  });

  it("says an orphaned anchor's text is gone", () => {
    expect(anchorNotes(thread({ anchor: { status: "orphaned" } }))).toEqual([{ key: "comments.anchorOrphaned", attention: true }]);
  });

  it("says how a widened anchor was found", () => {
    expect(anchorNotes(thread({ anchor: { status: "resolved", tier: "headingPath", start: 0, end: 5, byHint: false } }))).toEqual([{ key: "comments.anchorHeading" }]);
    expect(anchorNotes(thread({ anchor: { status: "resolved", tier: "anywhere", start: 0, end: 5, byHint: false } }))).toEqual([{ key: "comments.anchorAnywhere" }]);
  });

  it("after a reopen past GC, says the creation revision is no longer retained, before the anchor", () => {
    expect(anchorNotes(thread({ state: "reopened", creationRetained: false, anchor: { status: "orphaned" } }))).toEqual([
      { key: "comments.creationNotRetained" },
      { key: "comments.anchorOrphaned", attention: true },
    ]);
  });
});

describe("commentRef", () => {
  const list: CommentList = { doc: null, generation: "4", threads: [thread()] };

  it("finds a thread the list holds", () => {
    expect(commentRef("c1", list)).toEqual({ kind: "thread", thread: list.threads[0] });
  });

  it("an id the list no longer holds is a deleted comment", () => {
    expect(commentRef("c2", list)).toEqual({ kind: "deleted" });
  });

  it("is unknown while no list is held", () => {
    expect(commentRef("c1", null)).toEqual({ kind: "unknown" });
  });
});

describe("notices", () => {
  it.each([
    ["STALE_COMMENT", "comments.refusedStale"],
    ["COMMENT_NOT_ALLOWED", "comments.refusedNotAllowed"],
    ["COMMENT_STORAGE_FULL", "comments.refusedStorageFull"],
    ["COMMENT_LIMIT", "comments.refusedLimit"],
    ["COMMENT_ANCHOR_TOO_LONG", "comments.refusedAnchorTooLong"],
    ["COMMENT_STATE_EXHAUSTED", "comments.refusedExhausted"],
    ["JOURNAL_BUSY", "comments.refusedBusy"],
    ["STALE_PARENT", "comments.refusedStaleParent"],
  ] as const)("%s has its own message", (code, key) => {
    expect(errorNotice(new JournalRefusal(code, "x"))).toMatchObject({ key });
  });

  it("names any other code, and reads a non-refusal as a failure", () => {
    expect(errorNotice(new JournalRefusal("JOURNAL_IO", "x"))).toEqual({ tone: "error", key: "comments.refusedOther", values: { code: "JOURNAL_IO" } });
    expect(errorNotice(new Error("boom"))).toEqual({ tone: "error", key: "comments.failed" });
  });

  it("maps each create outcome", () => {
    const created = { doc: "d", comment: "c1", revision: "r", textHash: "h", generation: "1", commentGen: "0" };
    expect(createNotice({ status: "created", created })).toEqual({ tone: "success", key: "comments.created" });
    for (const reason of ["edited", "closed", "composing", "selection", "applyRefused"] as const) {
      expect(createNotice({ status: "aborted", reason }).key).toBe(`comments.aborted${reason[0].toUpperCase()}${reason.slice(1)}`);
    }
    expect(createNotice({ status: "refused", refusal: new JournalRefusal("COMMENT_LIMIT", "x") }).key).toBe("comments.refusedLimit");
  });
});
