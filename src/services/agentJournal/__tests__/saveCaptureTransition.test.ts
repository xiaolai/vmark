// @vitest-environment node
// How a save capture's answer is classified before anything is settled: nothing sent; an answer in time (its base is the revision, else the pending observation, else none); an answer past the deadline (still hands the save behind it what the journal recorded); a refusal in time (keeps the journal's code); a refusal past the deadline (leaves no base). Edge cases: an answer that holds neither id (the head already held the text), a non-journal error
import { describe, it, expect } from "vitest";
import type { CapturedSave } from "../journalClient";
import { JournalRefusal } from "../journalRefusal";
import { failureTransition, replyTransition } from "../saveCapture";

const recorded: CapturedSave = { doc: "d-文档", journaled: "yes", observation: null, revision: "r-7" };
const pending: CapturedSave = { doc: "d", journaled: "pending", observation: "o-3", revision: null };
const unchanged: CapturedSave = { doc: "d", journaled: "no", observation: null, revision: null };

describe("replyTransition", () => {
  it("nothing sent is unsent, live or not", () => {
    expect(replyTransition(null, true)).toEqual({ kind: "unsent" });
    expect(replyTransition(null, false)).toEqual({ kind: "unsent" });
  });

  it.each([
    [recorded, { ref: "revision", revision: "r-7" }],
    [pending, { ref: "pending", observation: "o-3" }],
    [unchanged, null],
  ])("an answer in time is answered, leaving its base (%#)", (out, next) => {
    expect(replyTransition(out, true)).toEqual({ kind: "answered", out, next });
  });

  it("an answer past the deadline is late, and still leaves what it recorded", () => {
    expect(replyTransition(recorded, false)).toEqual({ kind: "late", next: { ref: "revision", revision: "r-7" } });
    expect(replyTransition(pending, false)).toEqual({ kind: "late", next: { ref: "pending", observation: "o-3" } });
  });
});

describe("failureTransition", () => {
  it("a refusal in time keeps the journal's code", () => {
    const t = failureTransition(new JournalRefusal("JOURNAL_BUSY", "busy"), true);
    expect(t.kind).toBe("refused");
    expect(t.kind === "refused" && t.refusal.journalCode).toBe("JOURNAL_BUSY");
  });

  it("any other error in time is a refusal too, never a throw", () => {
    const t = failureTransition(new Error("ipc gone"), true);
    expect(t.kind).toBe("refused");
  });

  it("a refusal past the deadline is late and leaves no base", () => {
    expect(failureTransition(new JournalRefusal("JOURNAL_BUSY", "busy"), false)).toEqual({ kind: "late", next: null });
  });
});
