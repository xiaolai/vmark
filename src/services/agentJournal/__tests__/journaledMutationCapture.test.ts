// @vitest-environment node
// WI-AL2.2a — the journaled-mutation coordinator hands its prepare the capture id of the freeze it took, unchanged, and every controlled prepare that freezes sends it (an agent write's and a history restore's, the restore with its own requestId), inside the freeze's send turn, so it waits for an earlier freeze of its session (a save still writing to disk) to be answered, and for one that never answers only until that one's deadline; with no provenance source there is no freeze and no capture is sent; whichever way the mutation or restore ends, its freeze is settled, so a later freeze of the session can send | AL2.2g: the restore prepare is answered with a reply bound to its frozen payload; a released send reaches the journal after its registration and payload digest, so it is awaited rather than timed
import { describe, it, expect, vi, beforeEach } from "vitest";

import { invoke } from "@tauri-apps/api/core";
import { agentJournalFake as fake } from "@/test/agentJournalFake";
import { answerPrepare } from "@/test/agentJournalWireFake";
import type { PrepareInput } from "../journalClient";
import { restoreFromHistory } from "../historyRestore";
import { registerUnsavedProvenanceSource } from "../unsavedProvenance";
import { runJournaledMutation } from "../journaledMutation";
import type { CaptureId } from "../provenance/captureId";
import { ProvenanceSession } from "../provenance/session";
import { JOURNAL_DEADLINE_MS } from "../journalDeadline";
import { TAB, mutation, resetMutationFixture } from "./journaledMutationFixture";

beforeEach(() => {
  resetMutationFixture();
  vi.mocked(invoke).mockReset();
});

const CAPTURE: CaptureId = { view: "main/t-1", session: "0f8e2a4c-1b3d-4e5f-8a9b-0c1d2e3f4a5b", seq: "7" };

function source(): void {
  registerUnsavedProvenanceSource(TAB, {
    freeze: () => ({ touched: false, capture: CAPTURE, inTurn: (send) => send(), payload: async () => null, recorded: vi.fn(), invalidate: vi.fn(), release: vi.fn() }),
    fork: () => ({ recorded: vi.fn(), invalidate: vi.fn() }),
  });
}

describe("runJournaledMutation — capture id", () => {
  it("passes the freeze's capture id to the prepare", async () => {
    source();
    const seen: Array<CaptureId | undefined> = [];
    const base = mutation();
    await runJournaledMutation(
      mutation({
        prepare: (baseline) => {
          seen.push(baseline.capture);
          return base.prepare(baseline);
        },
      }),
    );
    expect(seen).toEqual([CAPTURE]);
  });

  it("sends the capture id on the controlled prepare", async () => {
    source();
    expect(await runJournaledMutation(mutation())).toMatchObject({ status: "applied" });
    expect(fake.prepareControlledWrite.mock.calls[0][0]).toMatchObject({ capture: CAPTURE });
  });

  it("waits to prepare until an earlier freeze of its session has been answered", async () => {
    vi.useFakeTimers();
    try {
      const session = new ProvenanceSession("before", { arm: () => Promise.reject(new Error("unarmed")), close: async () => {} }, { warn: vi.fn(), view: "main/t-1" });
      registerUnsavedProvenanceSource(TAB, session);
      const save = session.freeze("before"); // a save frozen at submission, still writing to disk
      let answerSave: () => void = () => {};
      const saveSent = save.inTurn(() => new Promise<void>((resolve) => (answerSave = resolve)));
      const run = runJournaledMutation(mutation());
      await vi.advanceTimersByTimeAsync(10);
      expect(fake.prepareControlledWrite).not.toHaveBeenCalled();
      answerSave();
      await saveSent;
      // The send registers the page and digests the payload: real async work, not timers.
      await vi.waitFor(() => expect(fake.prepareControlledWrite).toHaveBeenCalledOnce());
      expect(await run).toMatchObject({ status: "applied" });
      expect(fake.prepareControlledWrite.mock.calls[0][0]).toMatchObject({ capture: { seq: "2" } });
    } finally {
      vi.useRealTimers();
    }
  });

  it("a prepare that never settles holds a later write of its session only until its deadline", async () => {
    vi.useFakeTimers();
    try {
      const session = new ProvenanceSession("before", { arm: () => Promise.reject(new Error("unarmed")), close: async () => {} }, { warn: vi.fn(), view: "main/t-1" });
      registerUnsavedProvenanceSource(TAB, session);
      const hung = runJournaledMutation(mutation({ prepare: () => new Promise(() => {}) }));
      await vi.advanceTimersByTimeAsync(1000);
      const later = runJournaledMutation(mutation());
      await vi.advanceTimersByTimeAsync(JOURNAL_DEADLINE_MS - 1000 - 1);
      expect(fake.prepareControlledWrite).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await vi.waitFor(() => expect(fake.prepareControlledWrite).toHaveBeenCalledOnce());
      expect(await hung).toMatchObject({ status: "refused", refusal: { journalCode: "JOURNAL_TIMEOUT" } });
      expect(await later).toMatchObject({ status: "applied" });
      expect(fake.prepareControlledWrite.mock.calls[0][0]).toMatchObject({ capture: { seq: "2" } });
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends no capture when the tab has no provenance source", async () => {
    await runJournaledMutation(mutation());
    expect(fake.prepareControlledWrite.mock.calls[0][0]).not.toHaveProperty("capture");
  });
});

/** Each way a journaled mutation can end, with its freeze taken from a real session. */
const ENDS: Array<[string, () => Promise<unknown>]> = [
  ["applied", () => runJournaledMutation(mutation())],
  ["refused at the prepare", () => runJournaledMutation(mutation({ prepare: () => Promise.reject(new Error("refused")) }))],
  ["aborted by an edit before the prepare was sent", () => runJournaledMutation(mutation({ recheck: () => "edited" }))],
  ["aborted by an edit before the apply", () => runJournaledMutation(mutation({ verify: () => "edited" }))],
  ["with an apply that throws", () => runJournaledMutation(mutation({ apply: () => { throw new Error("apply"); } }))],
  ["with an outcome mapper that throws", () => runJournaledMutation(mutation({ outcome: () => { throw new Error("mapper"); } }))],
  ["as a refused history restore", () => {
    vi.mocked(invoke).mockRejectedValue(new Error("refused"));
    return restoreFromHistory(TAB, { from: "revision", revision: "rev-old" });
  }],
];

describe("a journaled mutation's freeze is settled on every exit", () => {
  it.each(ENDS)("a later freeze of the session can send after a mutation %s", async (_name, end) => {
    vi.useFakeTimers();
    try {
      const session = new ProvenanceSession("before", { arm: () => Promise.reject(new Error("unarmed")), close: async () => {} }, { warn: vi.fn(), view: "main/t-1" });
      registerUnsavedProvenanceSource(TAB, session);
      await end().catch(() => {});
      const send = vi.fn(async () => {});
      void session.freeze("later").inTurn(send);
      await vi.advanceTimersByTimeAsync(0);
      expect(send).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("restoreFromHistory — capture id", () => {
  it("sends the freeze's capture id and a v4 requestId on the restore prepare", async () => {
    source();
    vi.mocked(invoke).mockImplementation(async (command: string, args?: unknown) => {
      if (command !== "agent_journal_restore_prepare") return undefined;
      return answerPrepare(args, async ({ source: _source, ...rest }) => {
        const p = await fake.prepareControlledWrite({ ...rest, tool: "history.restore" } as unknown as PrepareInput);
        return { ...p, text: "restored", resolves: null };
      });
    });
    expect(await restoreFromHistory(TAB, { from: "revision", revision: "rev-old" })).toMatchObject({ status: "applied" });
    const [, args] = vi.mocked(invoke).mock.calls.find(([c]) => c === "agent_journal_restore_prepare") ?? [];
    expect(JSON.parse((args as { payload: string }).payload)).toMatchObject({
      capture: CAPTURE,
      requestId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
    });
  });
});
