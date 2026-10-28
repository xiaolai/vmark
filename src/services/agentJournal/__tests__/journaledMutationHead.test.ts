// @vitest-environment node
// WI-AL2.2c — strict expectedHead (R32) in the journaled-mutation coordinator: a tab with no journal basis reads the document's head before it prepares, after the tab's save already in flight when the write began (never one submitted later), and sends that head as the parent, a tab with a basis sends its basis without a read; a head read that is refused or outlives the budget refuses with nothing prepared and the freeze released; a STALE_PARENT drops the basis, so the retry re-reads and succeeds; the payload is requested for any basis and the prepare names the predecessor it was built on as observedParent (genesis, the expected head, the tab's own revision or pending save), and a payload whose basis is none of those is dropped (a snapshotOnly barrier with no observedParent) rather than sent on a predecessor nobody can name
import { describe, it, expect, vi, beforeEach } from "vitest";

import { agentJournalFake as fake } from "@/test/agentJournalFake";
import { agentJournalEpochFake as epochs } from "@/test/agentJournalEpochFake";
import { TEST_ATTRIBUTION } from "@/test/mcpAttributionFixture";
import { journalActorFor } from "../journalActor";
import type { JournalObservedRef, PrepareInput } from "../journalClient";
import { journalBasis, rememberJournalBasis, rememberPendingSave, setOutstandingSaveBase } from "../documentIdentity";
import { runJournaledMutation } from "../journaledMutation";
import { JournalRefusal } from "../journalRefusal";
import { registerUnsavedProvenanceSource } from "../unsavedProvenance";
import type { ProvenancePayload } from "../provenance/payload";
import { KEY, TAB, mutation, resetMutationFixture } from "./journaledMutationFixture";

beforeEach(resetMutationFixture);

/** The journal already holds `before` at revision `head`. */
function journaled(head: string): void {
  const d = fake.doc(KEY);
  d.head = head;
  d.text = "before";
}

const MAP = { map: "certified" } as unknown as ProvenancePayload;

/** A provenance source whose freeze names its payload for `basis`; the spies it hands out. */
function source(basis: string) {
  const asked: Array<string | null> = [];
  const release = vi.fn();
  registerUnsavedProvenanceSource(TAB, {
    freeze: () => ({
      touched: false,
      capture: { view: "main/t-1", session: "0f8e2a4c-1b3d-4e5f-8a9b-0c1d2e3f4a5b", seq: "1" },
      inTurn: (send) => send(),
      payload: async (expected) => {
        asked.push(expected);
        return { basis, payload: MAP };
      },
      recorded: vi.fn(),
      invalidate: vi.fn(),
      release,
    }),
    fork: () => ({ recorded: vi.fn(), invalidate: vi.fn() }),
  });
  return { asked, release };
}

const sent = (): PrepareInput => fake.prepareControlledWrite.mock.calls[0][0];
const sentActor = () => journalActorFor(TEST_ATTRIBUTION);

describe("runJournaledMutation — the expected head", () => {
  it("a tab with no basis reads the head and prepares on it", async () => {
    journaled("rev-h");
    expect(await runJournaledMutation(mutation())).toMatchObject({ status: "applied" });
    expect(epochs.readJournalHead).toHaveBeenCalledWith(KEY);
    expect(sent().parent).toBe("rev-h");
  });

  it("a new document reads a null head: genesis", async () => {
    expect(await runJournaledMutation(mutation())).toMatchObject({ status: "applied" });
    expect(sent().parent).toBeNull();
  });

  it("a tab with a basis sends it without reading the head", async () => {
    journaled("rev-h");
    rememberJournalBasis(TAB, KEY, "rev-h");
    expect(await runJournaledMutation(mutation())).toMatchObject({ status: "applied" });
    expect(epochs.readJournalHead).not.toHaveBeenCalled();
    expect(sent().parent).toBe("rev-h");
  });

  it("a save of the tab already in flight is waited for before the head is read", async () => {
    journaled("rev-h");
    let settle: (next: JournalObservedRef | null) => void = () => {};
    setOutstandingSaveBase(TAB, KEY, new Promise((resolve) => (settle = resolve)));
    const run = runJournaledMutation(mutation());
    // One macrotask turn drains every microtask: an unwaited path reaches the asserted call within it.
    await new Promise((resolve) => setImmediate(resolve));
    expect(epochs.readJournalHead).not.toHaveBeenCalled();
    fake.doc(KEY).head = "rev-s";
    settle({ ref: "revision", revision: "rev-s" });
    expect(await run).toMatchObject({ status: "applied" });
    expect(sent().parent).toBe("rev-s");
  });

  it("a save submitted after the write began is not waited for", async () => {
    journaled("rev-h");
    const run = runJournaledMutation(mutation());
    setOutstandingSaveBase(TAB, KEY, new Promise(() => {}));
    expect(await run).toMatchObject({ status: "applied" });
    expect(sent().parent).toBe("rev-h");
  });

  it("a null parent past genesis is STALE_PARENT", async () => {
    journaled("rev-h");
    const input = { docKey: KEY, parent: null, preimage: "before", baselineProvenance: null, baselineTouched: false };
    const refused = fake.prepareControlledWrite({ ...input, actor: sentActor(), tool: "test.tool" });
    await expect(refused).rejects.toMatchObject({ journalCode: "STALE_PARENT", head: "rev-h" });
    expect(fake.doc(KEY).head).toBe("rev-h");
  });

  it("a refused head read refuses with nothing prepared and releases the freeze", async () => {
    journaled("rev-h");
    const { release } = source("rev-h");
    epochs.failNextHeads();
    const out = await runJournaledMutation(mutation());
    expect(out).toMatchObject({ status: "refused", refusal: { journalCode: "JOURNAL_UNAVAILABLE" } });
    expect(fake.prepareControlledWrite).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });

  it("a head read that outlives the budget refuses JOURNAL_TIMEOUT with nothing prepared", async () => {
    vi.useFakeTimers();
    try {
      epochs.readJournalHead.mockImplementationOnce(() => new Promise(() => {}));
      const run = runJournaledMutation(mutation());
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await run).toMatchObject({ status: "refused", refusal: { journalCode: "JOURNAL_TIMEOUT" } });
      expect(fake.prepareControlledWrite).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a stale basis is refused, then the retry re-reads the head and succeeds", async () => {
    journaled("rev-h");
    rememberJournalBasis(TAB, KEY, "rev-stale");
    const first = await runJournaledMutation(mutation());
    expect(first).toMatchObject({ status: "refused", refusal: { journalCode: "STALE_PARENT" } });
    expect(first).toMatchObject({ refusal: expect.any(JournalRefusal) });
    expect(journalBasis(TAB, KEY)).toBeNull();
    expect(await runJournaledMutation(mutation())).toMatchObject({ status: "applied" });
    expect(fake.prepareControlledWrite.mock.calls[1][0].parent).toBe("rev-h");
  });
});

describe("runJournaledMutation — observedParent", () => {
  it("asks the freeze for its payload on whatever basis it holds", async () => {
    journaled("rev-h");
    const { asked } = source("rev-h");
    await runJournaledMutation(mutation());
    expect(asked).toEqual([null]);
  });

  it.each([
    ["the expected head", "rev-h", () => {}, { ref: "revision", revision: "rev-h" }],
    ["genesis", "genesis", () => {}, { ref: "genesis" }],
    ["the tab's pending save", "obs-1", () => rememberPendingSave(TAB, KEY, "obs-1"), { ref: "pending", observation: "obs-1" }],
  ])("a payload built on %s names it", async (_name, basis, setup, observedParent) => {
    journaled("rev-h");
    setup();
    source(basis);
    expect(await runJournaledMutation(mutation())).toMatchObject({ status: "applied" });
    expect(sent()).toMatchObject({ baselineProvenance: MAP, observedParent });
  });

  it("a payload on the revision the tab holds names it", async () => {
    journaled("rev-h");
    rememberJournalBasis(TAB, KEY, "rev-h");
    source("rev-h");
    await runJournaledMutation(mutation());
    expect(sent()).toMatchObject({ parent: "rev-h", observedParent: { ref: "revision", revision: "rev-h" } });
  });

  it("a payload on a predecessor the tab cannot name is dropped: no map, no observedParent", async () => {
    journaled("rev-h");
    source("rev-elsewhere");
    expect(await runJournaledMutation(mutation())).toMatchObject({ status: "applied" });
    expect(sent().baselineProvenance).toBeNull();
    expect(sent()).not.toHaveProperty("observedParent");
  });

  it("with no provenance source nothing names a predecessor", async () => {
    journaled("rev-h");
    await runJournaledMutation(mutation());
    expect(sent()).not.toHaveProperty("observedParent");
  });
});
