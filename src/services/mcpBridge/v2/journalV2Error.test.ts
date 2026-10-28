// @vitest-environment node
// The bridge answers for journal refusals and aborts: INVALID_TEXT before any prepare, each actionable token kept, unavailability folded, an abort carrying its reason — and an envelope type that only lets ABORTED carry a reason. | AL2.2g: a journal timeout, clean or uncertain, folds into JOURNAL_UNAVAILABLE (nothing was made), not INTERNAL
import { describe, expect, expectTypeOf, it } from "vitest";
import { JournalRefusal } from "@/services/agentJournal/journalRefusal";
import type { AbortReason } from "@/services/agentJournal/journalClient";
import { abortedError, invalidTextError, journalRefusalError } from "./journalV2Error";
import type { V2Error } from "./types";

describe("journalV2Error", () => {
  it("answers INVALID_TEXT with the same envelope the journal's refusal maps to", () => {
    expect(invalidTextError()).toEqual(journalRefusalError(new JournalRefusal("INVALID_TEXT", "lone surrogate")));
    expect(invalidTextError()).toMatchObject({ error: "INVALID_TEXT", message: expect.stringMatching(/surrogate/) });
  });

  it.each(["JOURNAL_BUSY", "STALE_PARENT", "JOURNAL_DEGRADED", "REVIEW_BACKLOG_FULL"] as const)("keeps %s", (code) => {
    expect(journalRefusalError(new JournalRefusal(code, "x")).error).toBe(code);
  });

  it("folds a journal that cannot record into JOURNAL_UNAVAILABLE", () => {
    expect(journalRefusalError(new JournalRefusal("JOURNAL_IO", "disk")).error).toBe("JOURNAL_UNAVAILABLE");
  });

  it.each([false, true])("folds a journal that did not answer in time (uncertain: %s) into JOURNAL_UNAVAILABLE: nothing was made", (uncertain) => {
    const refusal = new JournalRefusal("JOURNAL_TIMEOUT", "the agent edit journal did not confirm the prepare in time", null, null, { uncertain });
    expect(journalRefusalError(refusal)).toMatchObject({ error: "JOURNAL_UNAVAILABLE", message: expect.stringMatching(/in time/) });
  });

  it.each(["edited", "closed", "composing", "selection", "applyRefused"] as const)("an abort carries its reason %s", (reason) => {
    expect(abortedError(reason)).toMatchObject({ error: "ABORTED", reason });
  });

  it("only an ABORTED envelope can carry a reason, and it must be an abort reason", () => {
    expectTypeOf<Extract<V2Error, { error: "ABORTED" }>["reason"]>().toEqualTypeOf<AbortReason>();
    expectTypeOf<"edited">().not.toExtend<Extract<V2Error, { error: "STALE_PARENT" }>["reason"]>();
    // @ts-expect-error — a reason on a non-ABORTED code is not a V2Error
    const invalid: V2Error = { error: "INTERNAL", message: "m", reason: "edited" };
    // @ts-expect-error — ABORTED without a reason is not a V2Error
    const missing: V2Error = { error: "ABORTED", message: "m" };
    expect([invalid, missing]).toHaveLength(2);
  });
});
