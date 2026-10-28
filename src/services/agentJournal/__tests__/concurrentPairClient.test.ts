// @vitest-environment node
// WI-AL2.4 — both pairs of a revision edited in two windows (`agent_journal_concurrent_pair`): the client sends the document key and revision as one JSON string and returns the observed before-text, the linear before-text and the result unchanged (CJK, emoji and the empty text included); a missing, non-string or extra field is a malformed reply refused as JOURNAL_UNAVAILABLE; the journal's own refusal (a revision that is not concurrent, a lost text) reaches the caller with its code
import { describe, it, expect, vi, beforeEach } from "vitest";

import { invoke } from "@tauri-apps/api/core";
import { readConcurrentPair } from "../concurrentPairClient";
import { JournalRefusal } from "../journalRefusal";

const invokeMock = vi.mocked(invoke);
const REV = "0190d3c4-0000-7000-8000-000000000003";

const reply = (over: Record<string, unknown> = {}) => ({
  observedBefore: "Hi 你好",
  linearBefore: "Hi 你好!",
  result: "Hi 你好🎉",
  ...over,
});

beforeEach(() => invokeMock.mockReset());

describe("readConcurrentPair", () => {
  it("sends the key and revision and returns the three texts unchanged", async () => {
    invokeMock.mockResolvedValueOnce(reply());
    const pair = await readConcurrentPair("path:/a.md", REV);
    expect(invokeMock).toHaveBeenCalledWith("agent_journal_concurrent_pair", { payload: JSON.stringify({ docKey: "path:/a.md", revision: REV }) });
    expect(pair).toEqual({ observedBefore: "Hi 你好", linearBefore: "Hi 你好!", result: "Hi 你好🎉" });
  });

  it("accepts the empty text on any side", async () => {
    invokeMock.mockResolvedValueOnce(reply({ observedBefore: "", linearBefore: "", result: "" }));
    expect(await readConcurrentPair("path:/a.md", REV)).toEqual({ observedBefore: "", linearBefore: "", result: "" });
  });

  it.each([
    ["a missing text", { result: undefined }],
    ["a null text", { linearBefore: null }],
    ["a numeric text", { observedBefore: 7 }],
    ["an extra field", { extra: "x" }],
  ])("refuses %s as JOURNAL_UNAVAILABLE", async (_name, over) => {
    const body: Record<string, unknown> = reply(over);
    for (const [k, v] of Object.entries(body)) if (v === undefined) delete body[k];
    invokeMock.mockResolvedValueOnce(body);
    const err = await readConcurrentPair("path:/a.md", REV).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JournalRefusal);
    expect((err as JournalRefusal).journalCode).toBe("JOURNAL_UNAVAILABLE");
  });

  it("refuses a reply that is not an object", async () => {
    invokeMock.mockResolvedValueOnce(null);
    await expect(readConcurrentPair("path:/a.md", REV)).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });
  });

  it("passes the journal's refusal through with its code", async () => {
    invokeMock.mockRejectedValueOnce({
      code: "INVALID_INPUT",
      message: "INVALID_REQUEST: revision is not a concurrent revision of this document",
      detail: { journalCode: "INVALID_REQUEST" },
    });
    await expect(readConcurrentPair("path:/a.md", REV)).rejects.toMatchObject({ journalCode: "INVALID_REQUEST" });
  });
});
