// @vitest-environment node
// WI-AL1.4 — editing epochs and window release over IPC: arm replies are validated (doc, decimal epoch, head with its sha256 text hash or neither), close and release pass their arguments as the commands expect, a refusal carries detail.field so a window can tell a refused map from a refused save, and every call on the save path is bounded by a deadline that refuses JOURNAL_TIMEOUT (charged from the call's start, including the client's own work) | AL2.2c: readJournalHead reads a key's head (a revision id, or null at genesis or for a key with no document) and refuses any other reply
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.unmock("@/services/agentJournal/epochClient");
import { invoke } from "@tauri-apps/api/core";
import { armEpoch, bindDocument, closeEpoch, findDocument, readJournalHead, releaseWindow } from "../epochClient";
import { JOURNAL_DEADLINE_MS, withJournalDeadline } from "../journalDeadline";
import { JournalRefusal, toJournalRefusal } from "../journalRefusal";

const invokeMock = vi.mocked(invoke);
const DOC = "0190d3c4-0000-7000-8000-000000000003";
const REV = "0190d3c4-0000-7000-8000-000000000002";
const HASH = `sha256-${"a".repeat(64)}`;

beforeEach(() => invokeMock.mockReset());
afterEach(() => vi.useRealTimers());

describe("armEpoch", () => {
  it("sends the doc key as one JSON payload and returns the validated reply", async () => {
    invokeMock.mockResolvedValueOnce({ doc: DOC, epoch: "18446744073709551615", head: REV, headHash: HASH });
    await expect(armEpoch("path:/读书.md")).resolves.toEqual({ doc: DOC, epoch: "18446744073709551615", head: REV, headHash: HASH });
    expect(invokeMock).toHaveBeenCalledWith("agent_journal_arm_epoch", { payload: JSON.stringify({ docKey: "path:/读书.md" }) });
  });

  it("accepts a document with no head", async () => {
    invokeMock.mockResolvedValueOnce({ doc: DOC, epoch: "1", head: null, headHash: null });
    await expect(armEpoch("k")).resolves.toEqual({ doc: DOC, epoch: "1", head: null, headHash: null });
  });

  it.each([
    ["a numeric epoch", { doc: DOC, epoch: 1, head: null, headHash: null }],
    ["a padded epoch", { doc: DOC, epoch: "01", head: null, headHash: null }],
    ["an epoch past u64::MAX", { doc: DOC, epoch: "18446744073709551616", head: null, headHash: null }],
    ["an empty doc", { doc: "", epoch: "1", head: null, headHash: null }],
    ["a head without its hash", { doc: DOC, epoch: "1", head: REV, headHash: null }],
    ["a hash without its head", { doc: DOC, epoch: "1", head: null, headHash: HASH }],
    ["a hash that is not sha256", { doc: DOC, epoch: "1", head: REV, headHash: "md5-abc" }],
    ["no reply", undefined],
  ])("refuses %s as JOURNAL_UNAVAILABLE", async (_name, reply) => {
    invokeMock.mockResolvedValueOnce(reply);
    await expect(armEpoch("k")).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
  });

  it("reads a rejection as a journal refusal", async () => {
    invokeMock.mockRejectedValueOnce({ code: "invalid_input", message: "INVALID_REQUEST: epoch 1 is still armed", detail: { journalCode: "INVALID_REQUEST" } });
    await expect(armEpoch("k")).rejects.toMatchObject({ journalCode: "INVALID_REQUEST" });
  });
});

describe("bindDocument", () => {
  it("sends the source's expected document only when it is known", async () => {
    invokeMock.mockResolvedValue(DOC);
    await bindDocument("path:/a.md", "path:/b.md");
    expect(invokeMock).toHaveBeenLastCalledWith("agent_journal_bind_document", { payload: JSON.stringify({ from: "path:/a.md", to: "path:/b.md" }) });
    await bindDocument("path:/a.md", "path:/b.md", DOC);
    expect(invokeMock).toHaveBeenLastCalledWith("agent_journal_bind_document", {
      payload: JSON.stringify({ from: "path:/a.md", to: "path:/b.md", expectedDoc: DOC }),
    });
  });

  it("sends an explicit null when the source must carry no document", async () => {
    invokeMock.mockResolvedValue(DOC);
    await bindDocument("tab:main/t1", "path:/b.md", null);
    expect(invokeMock).toHaveBeenLastCalledWith("agent_journal_bind_document", {
      payload: JSON.stringify({ from: "tab:main/t1", to: "path:/b.md", expectedDoc: null }),
    });
  });

  it("returns the document the destination carries now", async () => {
    invokeMock.mockResolvedValueOnce(DOC);
    await expect(bindDocument("tab:main/t1", "path:/b.md", null)).resolves.toBe(DOC);
  });

  it.each([
    ["an empty id", ""],
    ["a null reply", null],
    ["a number", 7],
    ["no reply", undefined],
  ])("refuses %s as JOURNAL_UNAVAILABLE", async (_name, reply) => {
    invokeMock.mockResolvedValueOnce(reply);
    await expect(bindDocument("a", "b")).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
  });
});

describe("findDocument", () => {
  it("sends the doc key as one JSON payload and returns the document or null", async () => {
    invokeMock.mockResolvedValueOnce(DOC);
    await expect(findDocument("path:/读书.md")).resolves.toBe(DOC);
    expect(invokeMock).toHaveBeenLastCalledWith("agent_journal_find_document", { payload: JSON.stringify({ docKey: "path:/读书.md" }) });
    invokeMock.mockResolvedValueOnce(null);
    await expect(findDocument("k")).resolves.toBeNull();
  });

  it.each([
    ["an empty id", ""],
    ["a number", 7],
    ["no reply", undefined],
  ])("refuses %s as JOURNAL_UNAVAILABLE", async (_name, reply) => {
    invokeMock.mockResolvedValueOnce(reply);
    await expect(findDocument("k")).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
  });

  it("reads a rejection as a journal refusal", async () => {
    invokeMock.mockRejectedValueOnce({ code: "invalid_input", message: "INVALID_REQUEST: empty key", detail: { journalCode: "INVALID_REQUEST" } });
    await expect(findDocument("")).rejects.toMatchObject({ journalCode: "INVALID_REQUEST" });
  });
});

describe("readJournalHead", () => {
  it("sends the doc key as one JSON payload and returns the head or null", async () => {
    invokeMock.mockResolvedValueOnce(REV);
    await expect(readJournalHead("path:/读书.md")).resolves.toBe(REV);
    expect(invokeMock).toHaveBeenLastCalledWith("agent_journal_head", { payload: JSON.stringify({ docKey: "path:/读书.md" }) });
    invokeMock.mockResolvedValueOnce(null);
    await expect(readJournalHead("k")).resolves.toBeNull();
  });

  it.each([
    ["an empty id", ""],
    ["an object", { revision: REV }],
    ["no reply", undefined],
  ])("refuses %s as JOURNAL_UNAVAILABLE", async (_name, reply) => {
    invokeMock.mockResolvedValueOnce(reply);
    await expect(readJournalHead("k")).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
  });

  it("reads a rejection as a journal refusal", async () => {
    invokeMock.mockRejectedValueOnce({ code: "invalid_input", message: "JOURNAL_UNAVAILABLE: off", detail: { journalCode: "JOURNAL_UNAVAILABLE" } });
    await expect(readJournalHead("k")).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
  });
});

describe("closeEpoch and releaseWindow", () => {
  it("closes by doc key and decimal epoch", async () => {
    invokeMock.mockResolvedValueOnce(null);
    await closeEpoch("k", "7");
    expect(invokeMock).toHaveBeenCalledWith("agent_journal_close_epoch", { payload: JSON.stringify({ docKey: "k", epoch: "7" }) });
  });

  it("releases a window name", async () => {
    invokeMock.mockResolvedValueOnce(null);
    await releaseWindow("main/tab-1@n1");
    expect(invokeMock).toHaveBeenCalledWith("agent_journal_release_window", { window: "main/tab-1@n1" });
  });

  it("rejects with a journal refusal when the command does", async () => {
    invokeMock.mockRejectedValueOnce(new Error("ipc down"));
    await expect(releaseWindow("w")).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
  });
});

describe("toJournalRefusal field", () => {
  it("carries detail.field, so a refused map is told apart from a refused save", () => {
    const r = toJournalRefusal({ code: "invalid_input", message: "m", detail: { journalCode: "INVALID_REQUEST", field: "provenance" } });
    expect([r.journalCode, r.field]).toEqual(["INVALID_REQUEST", "provenance"]);
  });

  it("is null when the refusal names no field, or a non-string one", () => {
    expect(toJournalRefusal({ code: "x", message: "m", detail: { journalCode: "JOURNAL_BUSY" } }).field).toBeNull();
    expect(toJournalRefusal({ code: "x", message: "m", detail: { journalCode: "JOURNAL_BUSY", field: 3 } }).field).toBeNull();
  });
});

describe("withJournalDeadline", () => {
  it("answers what the call answers in time", async () => {
    await expect(withJournalDeadline("capture", () => Promise.resolve(5))).resolves.toBe(5);
  });

  it("refuses JOURNAL_TIMEOUT when the journal never answers", async () => {
    vi.useFakeTimers();
    const out = withJournalDeadline("capture", () => new Promise<never>(() => {}));
    const seen = expect(out).rejects.toMatchObject({ journalCode: "JOURNAL_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(JOURNAL_DEADLINE_MS);
    await seen;
  });

  it("charges the call's own asynchronous work, not only the wait for the reply", async () => {
    vi.useFakeTimers();
    let replied = false;
    // Delayed promises handed to the subject, which the fake clock advances.
    const hashing = () => new Promise<void>((r) => setTimeout(r, JOURNAL_DEADLINE_MS - 1));
    const reply = () =>
      new Promise<number>((r) =>
        setTimeout(() => {
          replied = true;
          r(1);
        }, 10),
      );
    const out = withJournalDeadline("capture", () => hashing().then(reply));
    const seen = expect(out).rejects.toMatchObject({ journalCode: "JOURNAL_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(JOURNAL_DEADLINE_MS);
    await seen;
    expect(replied).toBe(false);
  });

  /** Hold the thread for `ms` of wall time (a library doing work it never yields from). */
  const block = (ms: number) => {
    const until = performance.now() + ms;
    while (performance.now() < until) {
      /* busy */
    }
  };

  it("charges synchronous work inside the call, even when it answers at once", async () => {
    vi.useRealTimers();
    await expect(
      withJournalDeadline("capture", () => {
        block(40);
        return Promise.resolve(1);
      }, 20),
    ).rejects.toMatchObject({ journalCode: "JOURNAL_TIMEOUT" });
  });

  it("charges a continuation that blocks the thread past the deadline before it answers", async () => {
    vi.useRealTimers();
    await expect(
      withJournalDeadline("capture", async () => {
        await Promise.resolve();
        block(40); // a library's queued continuation, not the settling callback
        return 1;
      }, 20),
    ).rejects.toMatchObject({ journalCode: "JOURNAL_TIMEOUT" });
  });

  it("charges library dispatch work in a timer that settles late", async () => {
    vi.useRealTimers();
    await expect(
      withJournalDeadline("capture", () => new Promise((resolve) => setTimeout(() => {
        block(40);
        resolve(1);
      }, 0)), 20),
    ).rejects.toMatchObject({ journalCode: "JOURNAL_TIMEOUT" });
  });

  it("passes a refusal through and turns a thrown error into a refusal", async () => {
    const refusal = new JournalRefusal("JOURNAL_BUSY", "busy");
    await expect(withJournalDeadline("capture", () => Promise.reject(refusal))).rejects.toBe(refusal);
    await expect(withJournalDeadline("capture", () => { throw new Error("sync"); })).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
  });

  it("clears its timer once answered", async () => {
    vi.useFakeTimers();
    await withJournalDeadline("capture", () => Promise.resolve(1));
    expect(vi.getTimerCount()).toBe(0);
  });
});
