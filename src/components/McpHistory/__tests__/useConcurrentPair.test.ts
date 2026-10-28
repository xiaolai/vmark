// WI-AL2.4 — the concurrent pair loader: the two diffs share one budgeted worker that runs one job at a time, so the second is asked for only once the first has answered (its deadline then counts its own work, not the wait behind the first); what is open and loaded belongs to one document and revision, so a row reused for another document starts closed and idle, and a reply for the old identity is dropped. Edge cases: the same revision id on another document, a reply that lands after the identity changed
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const reads = vi.hoisted(() => ({ next: [] as Array<(pair: unknown) => void> }));
vi.mock("@/services/agentJournal/concurrentPairClient", () => ({
  readConcurrentPair: vi.fn(() => new Promise((resolve) => reads.next.push(resolve))),
}));

const diffs = vi.hoisted(() => ({ calls: [] as Array<{ a: string; b: string; settle: () => void }> }));
vi.mock("@/services/agentJournal/review/budgetedDiff", () => ({
  BudgetedDiff: class {
    diff(a: string, b: string) {
      return new Promise((resolve) => {
        const settle = () => resolve({ mode: "exact", changes: [] });
        diffs.calls.push({ a, b, settle });
      });
    }
    close() {}
  },
}));

import { useConcurrentPair } from "../useConcurrentPair";

const PAIR = { observedBefore: "草稿 你好", linearBefore: "草稿 世界!", result: "草稿 世界🎉" };

beforeEach(() => {
  reads.next = [];
  diffs.calls = [];
});

/** Answer the pending read, then each diff as it is asked for. */
async function answerAll(): Promise<void> {
  await act(async () => reads.next.shift()!(PAIR));
  for (let i = 0; i < 2; i++) {
    await waitFor(() => expect(diffs.calls.length).toBeGreaterThan(i));
    await act(async () => diffs.calls[i].settle());
  }
}

describe("useConcurrentPair", () => {
  it("asks for the second diff only once the first has answered", async () => {
    const { result } = renderHook(() => useConcurrentPair("path:/a.md", "r3"));
    act(() => result.current.toggle());
    await act(async () => reads.next.shift()!(PAIR));
    await waitFor(() => expect(diffs.calls).toHaveLength(1));
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(diffs.calls).toHaveLength(1);
    await act(async () => diffs.calls[0].settle());
    await waitFor(() => expect(diffs.calls).toHaveLength(2));
    await act(async () => diffs.calls[1].settle());
    await waitFor(() => expect(result.current.load.status).toBe("ready"));
  });

  it("starts closed and idle for another document with the same revision id", async () => {
    const { result, rerender } = renderHook(({ docKey }) => useConcurrentPair(docKey, "r3"), { initialProps: { docKey: "path:/a.md" } });
    act(() => result.current.toggle());
    await answerAll();
    await waitFor(() => expect(result.current.load.status).toBe("ready"));

    rerender({ docKey: "path:/b.md" });
    expect(result.current.open).toBe(false);
    expect(result.current.load.status).toBe("idle");
  });

  it("drops a reply for the identity it no longer shows", async () => {
    const { result, rerender } = renderHook(({ docKey }) => useConcurrentPair(docKey, "r3"), { initialProps: { docKey: "path:/a.md" } });
    act(() => result.current.toggle());
    rerender({ docKey: "path:/b.md" });
    await answerAll();
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(result.current.open).toBe(false);
    expect(result.current.load.status).toBe("idle");
  });
});
