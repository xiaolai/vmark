// @vitest-environment node
// The journaled-mutation coordinator: one tab mutation through the agent edit
// journal with injectable prepare / verify / apply / recover / outcome
// adapters. Each adapter failure point has a defined answer: a prepare that
// throws changes nothing and commits nothing; a verify mismatch aborts before
// the apply; an apply that refuses aborts, one that throws is read back
// (unchanged → abort and rethrow, changed → committed as applied-with-error,
// unreadable → left open for recovery); a commit that fails is applied, not
// durable, and the next mutation is refused until the journal drains.
// Provenance and the effects hook: journaledMutationEffects.test.ts.
import { describe, it, expect, vi, beforeEach } from "vitest";

import { agentJournalFake as fake } from "@/test/agentJournalFake";
import { useRevisionStore, useDocumentStore } from "@/stores/documentStore";
import type { PreparedTxn, PrepareSpec } from "../journalClient";
import {
  isJournalBasisEvicted,
  journalBasis,
  releaseTabJournal,
  rememberJournalBasis,
  JOURNAL_IDENTITY_BUDGET,
} from "../documentIdentity";
import { runJournaledMutation, type JournaledOutcome } from "../journaledMutation";
import { KEY, TAB, content, mutation, ops, resetMutationFixture } from "./journaledMutationFixture";

beforeEach(resetMutationFixture);

describe("runJournaledMutation — the pipeline", () => {
  it("prepares, applies, commits durably and advances the tab's basis", async () => {
    const out = await runJournaledMutation(mutation());
    expect(out).toEqual({ status: "applied", value: "v", durable: true });
    expect(content()).toBe("after");
    expect(ops()).toEqual(["prepare", "commit"]);
    expect(fake.doc(KEY).text).toBe("after");
    expect(journalBasis(TAB, KEY)).toBe(fake.doc(KEY).head);
  });

  it("hands the prepare adapter the baseline: key, the tab's basis as parent, preimage, provenance", async () => {
    rememberJournalBasis(TAB, KEY, "rev-known");
    const prepare = vi.fn((): Promise<PrepareSpec<PreparedTxn>> => Promise.reject(new Error("stop")));
    await runJournaledMutation(mutation({ prepare }));
    expect(prepare).toHaveBeenCalledWith({
      docKey: KEY,
      parent: "rev-known",
      preimage: "before",
      baselineProvenance: null,
      baselineTouched: false,
    });
  });

  it("an equal text is still committed", async () => {
    const out = await runJournaledMutation(mutation({ apply: () => ({ postimage: "before", value: "same" }) }));
    expect(out).toMatchObject({ status: "applied", value: "same" });
    expect(ops()).toEqual(["prepare", "commit"]);
  });

  it("returns whatever the outcome mapper answers, awaited", async () => {
    const out = await runJournaledMutation({
      ...mutation(),
      outcome: async (o: JournaledOutcome<string>) => `mapped:${o.status}`,
    });
    expect(out).toBe("mapped:applied");
  });
});

describe("runJournaledMutation — adapter failure points", () => {
  it("a prepare that throws changes nothing and commits nothing", async () => {
    const apply = vi.fn(() => ({ postimage: "after", value: "v" }));
    const out = await runJournaledMutation(mutation({ prepare: () => Promise.reject(new Error("ipc down")), apply }));
    expect(out).toMatchObject({ status: "refused" });
    expect(apply).not.toHaveBeenCalled();
    expect(content()).toBe("before");
    expect(ops()).toEqual([]);
  });

  it("a STALE_PARENT prepare refusal drops the tab's basis", async () => {
    rememberJournalBasis(TAB, KEY, "rev-stale");
    fake.refuseNextPrepares("STALE_PARENT");
    expect(await runJournaledMutation(mutation())).toMatchObject({ status: "refused" });
    expect(journalBasis(TAB, KEY)).toBeNull();
    expect(content()).toBe("before");
  });

  it("an evicted basis refuses STALE_PARENT before anything is prepared", async () => {
    rememberJournalBasis(TAB, KEY, "rev-old");
    for (let i = 0; i <= JOURNAL_IDENTITY_BUDGET; i++) rememberJournalBasis(`o-${i}`, `path:/o${i}.md`, "r");
    expect(isJournalBasisEvicted(TAB, KEY)).toBe(true);
    const prepare = vi.fn((): Promise<PrepareSpec<PreparedTxn>> => Promise.reject(new Error("unreachable")));
    const out = await runJournaledMutation(mutation({ prepare, retryHint: "re-read and retry" }));
    expect(out).toMatchObject({ status: "refused", refusal: { journalCode: "STALE_PARENT" } });
    expect(out.status === "refused" && out.refusal.message).toBe("the tab's journal basis was evicted; re-read and retry");
    expect(prepare).not.toHaveBeenCalled();
    // The refusal forgot the tombstone: the retry rebases on the journal's head.
    expect(isJournalBasisEvicted(TAB, KEY)).toBe(false);
    expect(await runJournaledMutation(mutation())).toMatchObject({ status: "applied" });
  });

  it("a verify mismatch aborts with its reason and never applies", async () => {
    const apply = vi.fn(() => ({ postimage: "after", value: "v" }));
    const out = await runJournaledMutation(mutation({ verify: () => "edited", apply }));
    expect(out).toEqual({ status: "aborted", reason: "edited" });
    expect(apply).not.toHaveBeenCalled();
    expect(ops()).toEqual(["prepare", "abort"]);
  });

  it("an apply the editor refuses aborts and changes nothing", async () => {
    const out = await runJournaledMutation(mutation({ apply: () => ({ refused: "applyRefused" }) }));
    expect(out).toEqual({ status: "aborted", reason: "applyRefused" });
    expect(content()).toBe("before");
    expect(ops()).toEqual(["prepare", "abort"]);
  });

  it("an apply that throws with the buffer unchanged aborts, keeps the recorded baseline, and rethrows", async () => {
    const out = runJournaledMutation(
      mutation({
        apply: () => {
          throw new Error("editor crashed");
        },
      }),
    );
    await expect(out).rejects.toThrow("editor crashed");
    expect(ops()).toEqual(["prepare", "abort"]);
    // The prepare recorded the unjournaled buffer as a baseline: that is the basis now.
    expect(journalBasis(TAB, KEY)).toBe(fake.doc(KEY).head);
  });

  it("an apply that throws after changing the buffer commits the text read back, bumps the revision: applied with error", async () => {
    const held = useRevisionStore.getState().getRevision(TAB);
    const out = await runJournaledMutation(
      mutation({
        apply: () => {
          useDocumentStore.getState().setEditorContent(TAB, "half");
          throw new Error("listener crashed");
        },
      }),
    );
    expect(out).toMatchObject({ status: "appliedWithError", durable: true });
    expect(ops()).toEqual(["prepare", "commit"]);
    expect(fake.doc(KEY).text).toBe("half");
    expect(useRevisionStore.getState().getRevision(TAB)).not.toBe(held);
    expect(journalBasis(TAB, KEY)).toBe(fake.doc(KEY).head);
  });

  it("an apply that throws and cannot be read back leaves the transaction open and drops the basis", async () => {
    rememberJournalBasis(TAB, KEY, "rev-x");
    fake.doc(KEY).head = "rev-x";
    fake.doc(KEY).text = "before";
    const out = await runJournaledMutation(
      mutation({
        apply: () => {
          throw new Error("editor crashed");
        },
        recover: () => {
          throw new Error("no buffer");
        },
      }),
    );
    expect(out).toMatchObject({ status: "recoveryRequired" });
    expect(ops()).toEqual(["prepare"]);
    expect(fake.doc(KEY).reservedBy).not.toBeNull();
    expect(journalBasis(TAB, KEY)).toBeNull();
  });

  it("a commit that throws is applied, not durable, keeps the pre-mutation basis, and is not read back", async () => {
    rememberJournalBasis(TAB, KEY, "rev-x");
    fake.doc(KEY).head = "rev-x";
    fake.doc(KEY).text = "before";
    fake.commitControlledWrite.mockRejectedValueOnce(new Error("ipc closed"));
    const recover = vi.fn(() => "after");
    const out = await runJournaledMutation(mutation({ recover }));
    expect(out).toEqual({ status: "applied", value: "v", durable: false });
    expect(content()).toBe("after");
    expect(recover).not.toHaveBeenCalled();
    expect(journalBasis(TAB, KEY)).toBe("rev-x");
  });

  it("a commit whose append fails is applied, not durable; the next mutation is refused until the journal drains", async () => {
    fake.failNextCommits();
    expect(await runJournaledMutation(mutation())).toEqual({ status: "applied", value: "v", durable: false });
    const next = await runJournaledMutation(mutation({ apply: () => ({ postimage: "after", value: "again" }) }));
    expect(next).toMatchObject({ status: "refused", refusal: { journalCode: "JOURNAL_DEGRADED" } });
    fake.drain();
    expect(await runJournaledMutation(mutation())).toMatchObject({ status: "applied", durable: true });
  });

  it("a tab closed while the journal answered learns no basis", async () => {
    fake.holdNextPrepare();
    const pending = runJournaledMutation(mutation());
    await vi.waitFor(() => expect(ops()).toEqual(["prepare"]));
    releaseTabJournal(TAB);
    fake.release();
    await pending;
    expect(journalBasis(TAB, KEY)).toBeNull();
  });
});
