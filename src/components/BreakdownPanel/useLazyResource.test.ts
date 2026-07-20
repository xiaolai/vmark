/**
 * The bugs this hook prevents, both flagged in the audit:
 *
 * - A lifetime cache tied to no key: switching workspace kept showing the old
 *   workspace's data and blocked a refetch for the new one.
 * - A late response from the previous key overwriting the current one.
 *
 * The contract: fetch on each open (the fetch reads the ledger, which is fine
 * on an explicit expand and is the only way stale data after a mutation gets
 * refreshed), reset on key change, and discard responses from a superseded
 * generation.
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useLazyResource } from "./useLazyResource";

describe("useLazyResource", () => {
  it("does not fetch until opened", () => {
    const fetcher = vi.fn().mockResolvedValue("data");
    renderHook(() => useLazyResource("k", fetcher));
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fetches on open and exposes the data", async () => {
    const fetcher = vi.fn().mockResolvedValue("data");
    const { result } = renderHook(() => useLazyResource("k", fetcher));
    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.data).toBe("data"));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("never fetches for a null key", () => {
    const fetcher = vi.fn().mockResolvedValue("data");
    const { result } = renderHook(() => useLazyResource(null, fetcher));
    act(() => result.current.toggle());
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("resets and closes when the key changes", async () => {
    const fetcher = vi.fn().mockResolvedValue("A-data");
    const { result, rerender } = renderHook(
      ({ k }) => useLazyResource(k, fetcher),
      { initialProps: { k: "A" } },
    );
    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.data).toBe("A-data"));
    rerender({ k: "B" });
    // B must not inherit A's data, and must be closed so no B fetch fired yet.
    expect(result.current.data).toBeNull();
    expect(result.current.open).toBe(false);
  });

  it("refetches on each reopen — so post-mutation data is not stale", async () => {
    const fetcher = vi.fn().mockResolvedValue("data");
    const { result } = renderHook(() => useLazyResource("k", fetcher));
    act(() => result.current.toggle()); // open
    await waitFor(() => expect(result.current.data).toBe("data"));
    act(() => result.current.toggle()); // close
    act(() => result.current.toggle()); // reopen
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  });

  it("discards an out-of-order SAME-key response (older resolves last)", async () => {
    // open → close → open before the first fetch returns: two loads under the
    // same key. If the first resolves last, a key-only guard would let it
    // clobber the newer result. The generation guard must drop it.
    let resolveFirst: (v: string) => void = () => {};
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<string>((r) => (resolveFirst = r)),
      )
      .mockResolvedValueOnce("second");
    const { result } = renderHook(() => useLazyResource("k", fetcher));
    act(() => result.current.toggle()); // open → load #1 (pending)
    act(() => result.current.toggle()); // close
    act(() => result.current.toggle()); // reopen → load #2
    await waitFor(() => expect(result.current.data).toBe("second"));
    act(() => {
      resolveFirst("first"); // the stale #1 resolves LAST
    });
    expect(result.current.data).toBe("second");
  });

  it("discards a stale response from a superseded key", async () => {
    let resolveA: (v: string) => void = () => {};
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<string>((r) => (resolveA = r)),
      )
      .mockResolvedValue("B-data");
    const { result, rerender } = renderHook(
      ({ k }) => useLazyResource(k, fetcher),
      { initialProps: { k: "A" } },
    );
    act(() => result.current.toggle()); // open A, fetch pending
    rerender({ k: "B" }); // key change abandons A's generation
    act(() => {
      resolveA("A-data"); // A resolves LATE — must be ignored
    });
    expect(result.current.data).not.toBe("A-data");
  });
});
