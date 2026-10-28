// @vitest-environment node
// WI-AL1.3 — the controlled-mutation runner: prepare → re-verify → apply → commit. A re-verify failure (edited, closed, ime composition, selection) appends aborted and nothing is applied; apply runs synchronously after re-verify with no await between; a commit failure is applied with durable false, never an error; a failed aborted append still refuses (the reservation is kept, retries drain it); prepare refusals (JOURNAL_BUSY, STALE_PARENT, JOURNAL_DEGRADED) apply nothing; a key whose bind failed is refused before any prepare until a bind there lands | AL2.2g: the uncertified-map fallback is the request coordinator's (one resend under a new request with no map); a clean refusal is not resent
// The protocol (`runPreparedWrite`) is driven through its one production
// entry, the journaled-mutation coordinator; the tab's basis is read from the
// identity table the coordinator settles. Cases the coordinator suite already
// pins are not repeated here (journaledMutation.test.ts).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { stubProvenancePayload } from "@/test/provenancePayloadFixture";

// The journal client is the shared in-memory fake (`src/test/globalTestHooks.ts`).
import { agentJournalFake as fake } from "@/test/agentJournalFake";
import { TEST_ATTRIBUTION } from "@/test/mcpAttributionFixture";
import { useDocumentStore } from "@/stores/documentStore";
import { journalActorFor } from "../journalActor";
import { controlledPrepare, type AbortReason, type PreparedTxn } from "../journalClient";
import { journalBasis, rememberJournalBasis } from "../documentIdentity";
import { runJournaledMutation } from "../journaledMutation";
import { agentJournalEpochFake } from "@/test/agentJournalEpochFake";
import { bindJournalDocument, noteJournalDocument } from "../documentBinding";
import { KEY, TAB, content, mutation, ops, resetMutationFixture } from "./journaledMutationFixture";

const actor = journalActorFor(TEST_ATTRIBUTION);
const run = (overrides: Parameters<typeof mutation>[0] = {}) => runJournaledMutation(mutation(overrides));
const type = (text: string) => useDocumentStore.getState().setEditorContent(TAB, text);
const basis = () => journalBasis(TAB, KEY);
const head = () => fake.doc(KEY).head;

beforeEach(() => {
  resetMutationFixture();
  // An empty tab over an empty journal document: a prepare records no baseline.
  type("");
});

describe("the controlled-mutation protocol, through the coordinator", () => {
  it.each<AbortReason>(["edited", "closed", "composing", "selection"])(
    "a re-verify failure (%s) appends aborted and applies nothing",
    async (reason) => {
      expect(await run({ verify: () => reason })).toEqual({ status: "aborted", reason });
      expect(content()).toBe("");
      expect(ops()).toEqual(["prepare", "abort"]);
      expect(fake.log[1].detail).toBe(reason);
      // Durable: the aborted append landed and released the reservation.
      expect(fake.doc(KEY).reservedBy).toBeNull();
      expect(basis()).toBeNull();
    },
  );

  it("an aborted write keeps the baseline its prepare recorded as the tab's new basis", async () => {
    expect((await run()).status).toBe("applied");
    const parent = basis();
    type("typed by the user");
    expect(await run({ verify: () => "edited" })).toEqual({ status: "aborted", reason: "edited" });
    expect(head()).not.toBe(parent);
    expect(basis()).toBe(head());
    expect((await run()).status).toBe("applied");
  });

  it("an aborted write with no baseline keeps the parent it stated as its basis", async () => {
    await run();
    const parent = basis();
    expect(await run({ verify: () => "selection" })).toMatchObject({ status: "aborted" });
    expect(basis()).toBe(parent);
  });

  it("runs apply synchronously after re-verify: no microtask can run between them", async () => {
    let interleaved = false;
    await run({
      verify: () => {
        void Promise.resolve().then(() => {
          interleaved = true;
        });
        return null;
      },
      apply: () => {
        expect(interleaved).toBe(false);
        return { postimage: "x", value: "ok" };
      },
    });
    expect(interleaved).toBe(true);
  });

  it("re-verifies only after the prepare is acknowledged", async () => {
    fake.holdNextPrepare();
    const verify = vi.fn(() => null);
    const pending = run({ verify });
    await vi.waitFor(() => expect(ops()).toEqual(["prepare"]));
    expect(verify).not.toHaveBeenCalled();
    fake.release();
    await pending;
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("a commit the journal refuses ends uncommitted: applied, not durable, basis stays the pre-write head", async () => {
    await run();
    const parent = basis();
    fake.refuseNextCommits();
    const out = await run({
      apply: () => {
        type("second");
        return { postimage: "second", value: "v" };
      },
    });
    expect(out).toEqual({ status: "applied", value: "v", durable: false });
    expect(content()).toBe("second");
    expect(basis()).toBe(parent);
    expect(fake.doc(KEY).reservedBy).toBeNull();
    type("after");
    expect((await run()).status).toBe("applied");
  });

  it("a failed aborted append still refuses, keeps the reservation, and a retry releases it", async () => {
    fake.failNextAborts();
    expect(await run({ verify: () => "edited" })).toEqual({ status: "aborted", reason: "edited" });
    expect(basis()).toBeNull();
    expect(fake.doc(KEY).reservedBy).not.toBeNull();
    expect(await run()).toMatchObject({ status: "refused", refusal: { journalCode: "JOURNAL_DEGRADED" } });
    fake.drain();
    expect(fake.doc(KEY).reservedBy).toBeNull();
    expect((await run()).status).toBe("applied");
  });

  it("an abort that throws is still an aborted refusal, not durable: the reservation stays", async () => {
    fake.abortControlledWrite.mockRejectedValueOnce(new Error("ipc closed"));
    expect(await run({ verify: () => "closed" })).toEqual({ status: "aborted", reason: "closed" });
    expect(fake.doc(KEY).reservedBy).not.toBeNull();
    expect(basis()).toBeNull();
  });

  it("two windows preparing one document: exactly one is applied, the other is JOURNAL_BUSY", async () => {
    fake.holdNextPrepare();
    const first = run();
    await vi.waitFor(() => expect(ops()).toEqual(["prepare"]));
    const apply = vi.fn(() => ({ postimage: "b", value: "b" }));
    const second = await run({ apply });
    fake.release();
    expect((await first).status).toBe("applied");
    expect(second).toMatchObject({ status: "refused", refusal: { journalCode: "JOURNAL_BUSY" } });
    expect(apply).not.toHaveBeenCalled();
  });

  it("a stale parent is refused with the current head and applies nothing", async () => {
    await run();
    rememberJournalBasis(TAB, KEY, "rev-old");
    const apply = vi.fn(() => ({ postimage: "x", value: "x" }));
    const out = await run({ apply });
    expect(out).toMatchObject({ status: "refused", refusal: { journalCode: "STALE_PARENT" } });
    expect(out.status === "refused" && out.refusal.head).toBe(head());
    expect(apply).not.toHaveBeenCalled();
  });

  it("a verify that throws aborts the transaction and rethrows the error", async () => {
    const boom = new Error("verify crashed");
    const out = run({
      verify: () => {
        throw boom;
      },
    });
    await expect(out).rejects.toBe(boom);
    expect(ops()).toEqual(["prepare", "abort"]);
    expect(fake.doc(KEY).reservedBy).toBeNull();
    expect(basis()).toBeNull();
  });

  it("an apply that throws after mutating commits the text read back: applied with error, never aborted", async () => {
    const boom = new Error("flush crashed");
    const out = await run({
      apply: () => {
        type("half written");
        throw boom;
      },
    });
    expect(out).toEqual({ status: "appliedWithError", error: boom, durable: true });
    expect(basis()).toBe(head());
    expect(ops()).toEqual(["prepare", "commit"]);
    expect(fake.log[1].detail).toBe("half written");
    expect(fake.doc(KEY).text).toBe("half written");
    expect(fake.doc(KEY).reservedBy).toBeNull();
  });

  it("an applied-with-error write whose commit fails is not durable and keeps the pre-write basis", async () => {
    fake.commitControlledWrite.mockRejectedValueOnce(new Error("ipc closed"));
    const out = await run({
      apply: () => {
        type("half written");
        throw new Error("flush crashed");
      },
    });
    expect(out).toMatchObject({ status: "appliedWithError", durable: false });
    expect(fake.commitControlledWrite.mock.calls[0][1]).toBe("half written");
    expect(basis()).toBeNull();
  });

  it("an apply that throws with the document read back unchanged aborts and rethrows the error", async () => {
    type("测试 unchanged");
    const boom = new Error("dispatch refused");
    const out = run({
      apply: () => {
        throw boom;
      },
    });
    await expect(out).rejects.toBe(boom);
    expect(ops()).toEqual(["prepare", "abort"]);
    expect(fake.doc(KEY).reservedBy).toBeNull();
  });

  it.each([
    ["a verify that throws", "verify"],
    ["an apply that throws and reads back unchanged", "apply"],
  ] as const)("%s after the prepare recorded a baseline aborts with that baseline as the basis", async (_label, which) => {
    await run();
    const parent = basis();
    type("typed 用户");
    const boom = new Error("crashed");
    const crash = (): never => {
      throw boom;
    };
    await expect(run(which === "verify" ? { verify: crash } : { apply: crash })).rejects.toBe(boom);
    expect(head()).not.toBe(parent);
    expect(basis()).toBe(head());
    expect(fake.doc(KEY).reservedBy).toBeNull();
    expect((await run()).status).toBe("applied");
  });

  it("an apply that throws and cannot be read back keeps the transaction open for recovery, never aborted", async () => {
    const boom = new Error("flush crashed");
    const out = await run({
      apply: () => {
        throw boom;
      },
      recover: () => {
        throw new Error("tab gone");
      },
    });
    expect(out).toEqual({ status: "recoveryRequired", error: boom });
    const prepared = (await fake.prepareControlledWrite.mock.results[0].value) as PreparedTxn;
    expect(fake.doc(KEY).reservedBy).toBe(prepared.txn);
    expect(ops()).toEqual(["prepare"]);
  });

  it("a map the journal does not certify is resent once without it: the baseline is then snapshot-only", async () => {
    const map = stubProvenancePayload();
    fake.refuseNextProvenance(2);
    type("typed");
    const out = await run({
      prepare: (b) => controlledPrepare({ ...b, actor, tool: "document.write", baselineProvenance: map }),
    });
    expect(out.status).toBe("applied");
    expect(fake.prepareControlledWrite.mock.calls.map(([input]) => input.baselineProvenance)).toEqual([map, null]);
  });

  it("any other refusal is not retried", async () => {
    fake.refuseNextPrepares("JOURNAL_BUSY");
    const out = await run({
      prepare: (b) => controlledPrepare({ ...b, actor, tool: "document.write", baselineProvenance: stubProvenancePayload() }),
    });
    expect(out).toMatchObject({ status: "refused" });
    expect(fake.prepareControlledWrite).toHaveBeenCalledTimes(1);
  });

  it("prepares only once a running bind of the document's key has landed", async () => {
    const release = agentJournalEpochFake.holdNextBind();
    const bound = bindJournalDocument("tab:main/cm1", "path:/bound.md");
    const out = run({ docKey: "path:/bound.md" });
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.prepareControlledWrite).not.toHaveBeenCalled();
    release();
    await bound;
    expect(await out).toMatchObject({ status: "applied", durable: true });
  });

  it("refuses a write to a key whose bind failed without preparing, until a bind there lands", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    agentJournalEpochFake.setDocument("tab:main/cm2", "doc-cm2");
    noteJournalDocument("tab:main/cm2", "doc-cm2");
    agentJournalEpochFake.failNextBinds(1);
    await bindJournalDocument("tab:main/cm2", "path:/unbound.md");
    const apply = vi.fn(() => ({ postimage: "x", value: "x" }));
    const out = await run({ docKey: "path:/unbound.md", apply });
    expect(out).toMatchObject({ status: "refused", refusal: { journalCode: "JOURNAL_IO" } });
    expect(fake.prepareControlledWrite).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    await bindJournalDocument("tab:main/cm2", "path:/unbound.md");
    expect(await run({ docKey: "path:/unbound.md" })).toMatchObject({ status: "applied", durable: true });
    warn.mockRestore();
  });

  it.each([
    ["another document", { doc: "path:/other.md" }],
    ["another revision", { revision: "rev-other" }],
    ["not applied", { applied: false }],
  ])("a commit acknowledgement naming %s is not durable and keeps the pre-write basis", async (_label, patch) => {
    const real = fake.commitControlledWrite.getMockImplementation()!;
    fake.commitControlledWrite.mockImplementationOnce(async (...args) => ({ ...(await real(...args)), ...patch }));
    expect(await run()).toEqual({ status: "applied", value: "v", durable: false });
    expect(basis()).toBeNull();
  });
});
