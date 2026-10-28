// WI-AL2.4 — outcome messages per R29 row: every revert outcome and every refusal a review action can meet maps to its own translated message and tone (applied, applied not durable, applied with an error, applied with an error and not durable, recovery required, a conflicted decision, a found base, each abort reason, AMBIGUOUS_REVERT, REVERT_REFUSED conflicted and reapply, STALE_REVIEW, STALE_PARENT, REVIEW_BACKLOG_FULL, REVIEW_STATE_EXHAUSTED, JOURNAL_BUSY), and an unknown failure is never silent
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { JournalRefusal, type JournalCode } from "@/services/agentJournal/journalRefusal";
import type { HunkRevertOutcome } from "@/services/agentJournal/hunkRevert";
import type { RevertDecided } from "@/services/agentJournal/revertReplies";
import { resolveKey } from "@/test/i18nResolve";
import { errorNotice, revertNotice } from "../reviewOutcome";

const decided = (action: RevertDecided["action"]): HunkRevertOutcome => ({
  status: "decided",
  decision: { doc: "d", hunk: "h", action, reviewGen: "1", generation: "2", baseline: null, head: null },
});
const refused = (code: JournalCode, revertReason: "conflicted" | "reapply" | null = null): HunkRevertOutcome => ({
  status: "refused",
  refusal: new JournalRefusal(code, code, null, null, { revertReason }),
});

describe("revertNotice — one message per revert outcome", () => {
  it.each<[string, HunkRevertOutcome, string, string]>([
    ["applied", { status: "applied", durable: true }, "success", "review.outcomeReverted"],
    ["applied, not durable", { status: "applied", durable: false }, "warning", "review.outcomeRevertedNotDurable"],
    ["applied with an error", { status: "appliedWithError", error: new Error("x"), durable: true }, "warning", "review.outcomeRevertedWithError"],
    ["applied with an error, not durable", { status: "appliedWithError", error: new Error("x"), durable: false }, "warning", "review.outcomeRevertedWithErrorNotDurable"],
    ["recovery required", { status: "recoveryRequired", error: new Error("x") }, "error", "review.outcomeRecoveryRequired"],
    ["a conflicted decision", decided("conflicted"), "warning", "review.outcomeConflicted"],
    ["a found base", decided("revertFoundBase"), "info", "review.outcomeFoundBase"],
    ["aborted: edited", { status: "aborted", reason: "edited" }, "warning", "review.abortedEdited"],
    ["aborted: closed", { status: "aborted", reason: "closed" }, "warning", "review.abortedClosed"],
    ["aborted: composing", { status: "aborted", reason: "composing" }, "warning", "review.abortedComposing"],
    ["aborted: selection", { status: "aborted", reason: "selection" }, "warning", "review.abortedSelection"],
    ["aborted: applyRefused", { status: "aborted", reason: "applyRefused" }, "error", "review.abortedApplyRefused"],
    ["AMBIGUOUS_REVERT", refused("AMBIGUOUS_REVERT"), "warning", "review.refusedAmbiguous"],
    ["REVERT_REFUSED conflicted", refused("REVERT_REFUSED", "conflicted"), "warning", "review.refusedConflicted"],
    ["REVERT_REFUSED reapply", refused("REVERT_REFUSED", "reapply"), "warning", "review.refusedReapply"],
    ["STALE_REVIEW", refused("STALE_REVIEW"), "warning", "review.refusedStale"],
    ["STALE_PARENT", refused("STALE_PARENT"), "warning", "review.refusedStaleParent"],
    ["REVIEW_BACKLOG_FULL", refused("REVIEW_BACKLOG_FULL"), "error", "review.refusedBacklogFull"],
    ["REVIEW_STATE_EXHAUSTED", refused("REVIEW_STATE_EXHAUSTED"), "error", "review.refusedExhausted"],
    ["JOURNAL_BUSY", refused("JOURNAL_BUSY"), "warning", "review.refusedBusy"],
  ])("%s", (_label, outcome, tone, key) => {
    const notice = revertNotice(outcome);
    expect(notice).toMatchObject({ tone, key });
    // The key is a real English string, not echoed back.
    expect(resolveKey(notice.key, ["statusbar"], notice.values)).not.toBe(notice.key);
  });

  it("every row has its own message", () => {
    const keys = new Set(
      [
        { status: "applied", durable: true },
        { status: "applied", durable: false },
        decided("conflicted"),
        decided("revertFoundBase"),
        refused("REVERT_REFUSED", "conflicted"),
        refused("REVERT_REFUSED", "reapply"),
        refused("AMBIGUOUS_REVERT"),
      ].map((o) => revertNotice(o as HunkRevertOutcome).key),
    );
    expect(keys.size).toBe(7);
  });
});

describe("errorNotice — a review decision that failed", () => {
  it("a refusal reads as its token's message", () => {
    expect(errorNotice(new JournalRefusal("STALE_REVIEW", "x"))).toMatchObject({ key: "review.refusedStale" });
  });

  it("a REVERT_REFUSED with no reason, or any other token, names the token", () => {
    const notice = errorNotice(new JournalRefusal("JOURNAL_IO", "x"));
    expect(notice).toMatchObject({ tone: "error", key: "review.refusedOther", values: { code: "JOURNAL_IO" } });
    expect(resolveKey(notice.key, ["statusbar"], notice.values)).toContain("JOURNAL_IO");
    expect(errorNotice(new JournalRefusal("REVERT_REFUSED", "x"))).toMatchObject({ key: "review.refusedOther" });
  });

  it("a rejection that is no refusal reads as a failure", () => {
    expect(errorNotice(new Error("boom"))).toMatchObject({ tone: "error", key: "review.actionFailed" });
  });
});
