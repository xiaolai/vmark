// @vitest-environment node
// WI-AL2.2g — the freeze is released only on a confirmed clean refusal: through the real transport, IPC validation, page registration and request coordinator, a notAdmitted answer with uncertain false, or a refusal raised before anything was sent, releases the provenance freeze; every uncertain, terminal, malformed or abandoned outcome invalidates it and applies nothing; an fsync failure (indeterminate) is retried under the same request id, and a second uncertain answer abandons with the original payload and reports uncertain: true
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.unmock("@/services/agentJournal/journalTransport");

import { agentJournalEpochFake } from "@/test/agentJournalEpochFake";
import { bindJournalDocument } from "../documentBinding";
import { resetPageRegistration } from "../pageRegistration";
import { registerUnsavedProvenanceSource } from "../unsavedProvenance";
import { runJournaledMutation } from "../journaledMutation";
import type { NamedPayload } from "../provenance/session";
import { KEY, TAB, content, mutation, resetMutationFixture } from "./journaledMutationFixture";
import { boundPair, boundPrepare, preparedReply, requestAnswer, scriptWire } from "./journalWire";

type Wire = ReturnType<typeof scriptWire>;
let wire: Wire;

function source() {
  const freeze = {
    touched: true,
    capture: { view: "v", session: "s", seq: "1" },
    inTurn: <T,>(send: () => Promise<T>) => send(),
    payload: vi.fn(async (): Promise<NamedPayload | null> => null),
    recorded: vi.fn(),
    invalidate: vi.fn(),
    release: vi.fn(),
  };
  registerUnsavedProvenanceSource(TAB, { freeze: () => freeze, fork: () => ({ recorded: () => {}, invalidate: () => {} }) });
  return freeze;
}

/** Bind a document onto `to` and have the journal refuse the move: `to` is left unbound (JOURNAL_IO). */
async function failBindOnto(to: string): Promise<void> {
  agentJournalEpochFake.failNextBinds(1);
  expect(await bindJournalDocument("path:/moved-from.md", to)).toMatchObject({ ok: false });
}

const committed = { doc: "path:/a.md", revision: "rev-1", applied: true, durable: true, certified: false, fallbackReason: null };

beforeEach(() => {
  resetMutationFixture();
  resetPageRegistration();
  wire = scriptWire();
  wire.on("agent_journal_commit", (args) => boundPair(args, committed));
  wire.on("agent_journal_abort", (args) => boundPair(args, { durable: true }));
  wire.on("agent_journal_abandon", () => ({ state: "fenced" }));
});

const prepares = () => wire.payloadsOf("agent_journal_prepare");
const requestIds = () => prepares().map((p) => String(JSON.parse(p).requestId));

describe("freeze disposition", () => {
  it("the freeze is released only on a confirmed clean refusal", async () => {
    const clean = source();
    wire.on("agent_journal_prepare", (a) => requestAnswer(String(a.payload), "STALE_PARENT", false, { state: "notAdmitted" }).then((e) => Promise.reject(e)));
    expect(await runJournaledMutation(mutation())).toMatchObject({ status: "refused", refusal: { uncertain: false } });
    expect(clean.release).toHaveBeenCalled();

    const lost = source();
    wire.on("agent_journal_prepare", () => Promise.reject(new Error("reply lost")));
    expect(await runJournaledMutation(mutation())).toMatchObject({ status: "refused", refusal: { uncertain: true } });
    expect(lost.release).not.toHaveBeenCalled();
    expect(lost.invalidate).toHaveBeenCalled();
    expect(content()).toBe("before");
  });

  it("a clean notAdmitted releases, never invalidates", async () => {
    const freeze = source();
    wire.on("agent_journal_prepare", (a) => requestAnswer(String(a.payload), "STALE_PARENT", false, { state: "notAdmitted" }, { head: "h" }).then((e) => Promise.reject(e)));
    const out = await runJournaledMutation(mutation());
    expect(out).toMatchObject({ status: "refused", refusal: { journalCode: "STALE_PARENT", uncertain: false } });
    const release = freeze.release;
    expect(release).toHaveBeenCalled();
    expect(freeze.invalidate).not.toHaveBeenCalled();
    expect(content()).toBe("before");
  });

  it("a refusal raised before anything was sent releases", async () => {
    const freeze = source();
    await failBindOnto(KEY);
    const out = await runJournaledMutation(mutation());
    expect(out).toMatchObject({ status: "refused", refusal: { journalCode: "JOURNAL_IO", uncertain: false } });
    expect(freeze.release).toHaveBeenCalled();
    expect(freeze.invalidate).not.toHaveBeenCalled();
    expect(prepares()).toEqual([]);
  });

  it("two dropped replies abandon once with the original payload, invalidate, and apply nothing", async () => {
    const freeze = source();
    wire.on("agent_journal_prepare", () => Promise.reject(new Error("reply lost")));
    const out = await runJournaledMutation(mutation());
    expect(out).toMatchObject({ status: "refused", refusal: { journalCode: "JOURNAL_UNAVAILABLE", uncertain: true } });
    const releaseOnRetry = freeze.release;
    expect(releaseOnRetry).not.toHaveBeenCalled();
    expect(freeze.invalidate).toHaveBeenCalled();
    expect(prepares()).toHaveLength(2);
    expect(new Set(prepares()).size).toBe(1);
    expect(wire.payloadsOf("agent_journal_abandon")).toEqual([prepares()[0]]);
    expect(content()).toBe("before");
  });

  it("an fsync failure (indeterminate) is retried under the same request id, then applies", async () => {
    const freeze = source();
    let n = 0;
    wire.on("agent_journal_prepare", (a) => {
      n += 1;
      if (n === 1) return Promise.reject({ code: "io", message: "JOURNAL_IO", detail: { journalCode: "JOURNAL_IO", indeterminate: true, uncertain: true } });
      return boundPrepare(String(a.payload), preparedReply());
    });
    expect(await runJournaledMutation(mutation())).toMatchObject({ status: "applied", durable: true });
    expect(new Set(requestIds()).size).toBe(1);
    expect(prepares()).toHaveLength(2);
    expect(freeze.release).not.toHaveBeenCalled();
    expect(wire.calls.filter((c) => c.command === "agent_journal_abandon")).toEqual([]);
  });

  it.each<[string, (payload: string) => Promise<unknown>]>([
    ["a malformed reply", async () => ({ txn: "x" })],
    ["a reply bound to another request id", async (p) => ({ ...((await boundPrepare(p, preparedReply())) as object), bind: { requestId: "other", digest: "0".repeat(64) } })],
    ["an inFlight answer", (p) => requestAnswer(p, "JOURNAL_BUSY", true, { state: "inFlight" }).then((e) => Promise.reject(e))],
  ])("%s twice is uncertain: invalidated, abandoned once, nothing applied", async (_label, answer) => {
    const freeze = source();
    wire.on("agent_journal_prepare", (a) => answer(String(a.payload)));
    const out = await runJournaledMutation(mutation());
    expect(out).toMatchObject({ status: "refused", refusal: { uncertain: true } });
    expect(freeze.release).not.toHaveBeenCalled();
    expect(freeze.invalidate).toHaveBeenCalled();
    expect(wire.payloadsOf("agent_journal_abandon")).toHaveLength(1);
    expect(content()).toBe("before");
  });

  it.each([
    [{ state: "terminal", status: "committed" }],
    [{ state: "terminalPending", terminal: "aborted" }],
    [{ state: "abandoned" }],
  ])("a request that already ended (%o) invalidates, never applies, never abandons", async (request) => {
    const freeze = source();
    wire.on("agent_journal_prepare", (a) => requestAnswer(String(a.payload), "STALE_REQUEST", false, request).then((e) => Promise.reject(e)));
    const out = await runJournaledMutation(mutation());
    expect(out).toMatchObject({ status: "refused", refusal: { journalCode: "STALE_REQUEST" } });
    expect(freeze.release).not.toHaveBeenCalled();
    expect(freeze.invalidate).toHaveBeenCalled();
    expect(prepares()).toHaveLength(1);
    expect(wire.calls.filter((c) => c.command === "agent_journal_abandon")).toEqual([]);
  });

  it("admitted, reply lost, then the retry fails readiness: no release, invalidated, abandoned once", async () => {
    const freeze = source();
    wire.on("agent_journal_prepare", async () => {
      await failBindOnto(KEY);
      throw new Error("reply lost");
    });
    const out = await runJournaledMutation(mutation());
    expect(out).toMatchObject({ status: "refused", refusal: { uncertain: true } });
    expect(freeze.release).not.toHaveBeenCalled();
    expect(freeze.invalidate).toHaveBeenCalled();
    expect(prepares()).toHaveLength(1);
    expect(wire.payloadsOf("agent_journal_abandon")).toEqual(prepares());
    expect(content()).toBe("before");
  });

  it("an uncertain answer, then a clean notAdmitted on the retry, releases", async () => {
    const freeze = source();
    let n = 0;
    wire.on("agent_journal_prepare", (a) => {
      n += 1;
      if (n === 1) return Promise.reject(new Error("reply lost"));
      return requestAnswer(String(a.payload), "JOURNAL_BUSY", false, { state: "notAdmitted" }).then((e) => Promise.reject(e));
    });
    expect(await runJournaledMutation(mutation())).toMatchObject({ status: "refused", refusal: { journalCode: "JOURNAL_BUSY" } });
    expect(freeze.release).toHaveBeenCalled();
    expect(freeze.invalidate).not.toHaveBeenCalled();
  });
});
