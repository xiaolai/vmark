// @vitest-environment node
// WI-AL1.6 — the history panel's checkpoints kept in the journal: the list is validated (a malformed reply is refused, not trusted), a forget sends the ids and answers how many went, and every call first waits for the journal to finish starting (bounded; a failed start is refused)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  forgetJournalCheckpoints,
  JOURNAL_START_WAIT_MS,
  listJournalCheckpoints,
  resetJournalCheckpointClient,
} from "../checkpointClient";

const invokeMock = vi.mocked(invoke);

const entry = {
  id: "cp-1", tabId: null, filePath: "/笔记/a.md", timestamp: 1_700_000_000_123,
  tool: "document.write", description: "改写", contentBefore: "原文",
};

/** Answer `agent_journal_status` with `phases` in turn (the last repeats), other commands with `reply`. */
function journal(phases: string[], reply: (cmd: string) => unknown = () => undefined) {
  let i = 0;
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === "agent_journal_status") return { phase: phases[Math.min(i++, phases.length - 1)] };
    return reply(cmd);
  });
}

beforeEach(() => {
  invokeMock.mockReset();
  resetJournalCheckpointClient();
});
afterEach(() => vi.useRealTimers());

describe("checkpointClient", () => {
  it("lists the journal's checkpoints", async () => {
    journal(["ready"], () => [entry]);
    expect(await listJournalCheckpoints()).toEqual([entry]);
    expect(invokeMock).toHaveBeenCalledWith("agent_journal_checkpoints", {});
  });

  it("refuses a malformed list", async () => {
    for (const bad of [null, {}, [{ ...entry, timestamp: "1" }], [{ ...entry, timestamp: -1 }], [{ ...entry, timestamp: 8.64e15 + 1 }], [{ ...entry, id: "" }], [{ ...entry, contentBefore: 3 }]]) {
      resetJournalCheckpointClient();
      journal(["ready"], () => bad);
      await expect(listJournalCheckpoints()).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
    }
  });

  it("refuses a checkpoint anchored on both a tab and a path, or on neither", async () => {
    const tab = { ...entry, tabId: "tab-1", filePath: null };
    for (const bad of [{ ...entry, tabId: "tab-1" }, { ...entry, filePath: null }]) {
      resetJournalCheckpointClient();
      journal(["ready"], () => [bad]);
      await expect(listJournalCheckpoints()).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
    }
    resetJournalCheckpointClient();
    journal(["ready"], () => [tab]);
    expect(await listJournalCheckpoints()).toEqual([tab]);
  });

  it("forgets ids and answers the whole report", async () => {
    journal(["ready"], () => ({ forgotten: 2, blobError: null }));
    expect(await forgetJournalCheckpoints(["a", "b"])).toEqual({ forgotten: 2, blobError: null });
    expect(invokeMock).toHaveBeenCalledWith("agent_journal_checkpoints_forget", { payload: JSON.stringify({ ids: ["a", "b"] }) });
  });

  it("sends a forget naming no ids, so the journal retries a compaction a failed one owes", async () => {
    journal(["ready"], () => ({ forgotten: 0, blobError: "pack 打不开" }));
    expect(await forgetJournalCheckpoints([])).toEqual({ forgotten: 0, blobError: "pack 打不开" });
    expect(invokeMock).toHaveBeenCalledWith("agent_journal_checkpoints_forget", { payload: JSON.stringify({ ids: [] }) });
  });

  it("refuses a report that forgot something when no id was named", async () => {
    journal(["ready"], () => ({ forgotten: 1, blobError: null }));
    await expect(forgetJournalCheckpoints([])).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
  });

  it("hands back a compaction failure: the records went, their bytes did not yet", async () => {
    journal(["ready"], () => ({ forgotten: 1, blobError: "pack 打不开" }));
    expect(await forgetJournalCheckpoints(["a"])).toEqual({ forgotten: 1, blobError: "pack 打不开" });
  });

  it("refuses a malformed forget report", async () => {
    const bad = [
      { forgotten: -1, blobError: null },
      { forgotten: 3, blobError: null }, // more than the two distinct ids named
      { forgotten: 1.5, blobError: null },
      { forgotten: 1 }, // blobError missing
      { forgotten: 1, blobError: 7 },
      { forgotten: 1, blobError: "" },
    ];
    for (const reply of bad) {
      resetJournalCheckpointClient();
      journal(["ready"], () => reply);
      await expect(forgetJournalCheckpoints(["a", "b", "a"])).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
    }
  });

  it("waits for the journal to finish starting, once", async () => {
    vi.useFakeTimers();
    journal(["starting", "starting", "ready"], () => []);
    const listed = listJournalCheckpoints();
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(listed).resolves.toEqual([]);
    await listJournalCheckpoints();
    const statusCalls = invokeMock.mock.calls.filter(([c]) => c === "agent_journal_status").length;
    expect(statusCalls).toBe(3);
  });

  it("refuses when the journal failed to start or never finished", async () => {
    journal(["failed"]);
    await expect(listJournalCheckpoints()).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
    resetJournalCheckpointClient();
    vi.useFakeTimers();
    journal(["starting"]);
    const listed = listJournalCheckpoints();
    const seen = expect(listed).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
    await vi.advanceTimersByTimeAsync(JOURNAL_START_WAIT_MS + 1_000);
    await seen;
  });

  it("refuses within the start wait when a status call never answers", async () => {
    vi.useFakeTimers();
    invokeMock.mockImplementation(() => new Promise(() => {}));
    const listed = listJournalCheckpoints();
    const seen = expect(listed).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
    await vi.advanceTimersByTimeAsync(JOURNAL_START_WAIT_MS + 1_000);
    await seen;
  });

  it("bounds the start wait by the monotonic clock, not the wall clock", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const wall = vi.spyOn(Date, "now").mockReturnValue(0);
    try {
      journal(["starting"]);
      const listed = listJournalCheckpoints();
      const seen = expect(listed).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
      await vi.advanceTimersByTimeAsync(JOURNAL_START_WAIT_MS + 1_000);
      await seen;
    } finally {
      wall.mockRestore();
    }
  });

  it("never sleeps past the start wait: a poll interval is capped by what is left of it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    // A 30 ms status call puts the polls off the 100 ms grid, so the last
    // full interval would overrun the wait.
    invokeMock.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ phase: "starting" }), 30)));
    let refused: unknown = null;
    listJournalCheckpoints().catch((e: unknown) => (refused = e));
    await vi.advanceTimersByTimeAsync(JOURNAL_START_WAIT_MS);
    expect(refused).toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
  });

  it("asks again after a refused wait, so a later call can succeed", async () => {
    journal(["failed", "ready"], () => []);
    await expect(listJournalCheckpoints()).rejects.toBeTruthy();
    await expect(listJournalCheckpoints()).resolves.toEqual([]);
  });
});
