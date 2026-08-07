/**
 * The bug this hook exists to prevent: each mutation control guarded an
 * append-only ledger write with a `busy` STATE flag. State reads are stale
 * within a render tick, so two native clicks firing before React commits both
 * observe `busy === false` and both append — a duplicate ratification, anchor,
 * or judgment. A synchronous ref flips on the first call, refusing the second
 * in the same tick.
 */
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useInFlightAction } from "./useInFlightAction";

describe("useInFlightAction", () => {
  it("refuses a second call synchronously while the first is in flight", async () => {
    const fn = vi.fn().mockReturnValue(new Promise<void>(() => {}));
    const { result } = renderHook(() => useInFlightAction());
    const [run] = result.current;
    // Two calls in ONE tick — the state-based guard would let both through.
    act(() => {
      run(fn);
      run(fn);
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("exposes busy while running and clears it after", async () => {
    let release: () => void = () => {};
    const fn = vi.fn().mockReturnValue(
      new Promise<void>((r) => {
        release = r;
      }),
    );
    const { result } = renderHook(() => useInFlightAction());
    act(() => result.current[0](fn));
    expect(result.current[1]).toBe(true);
    await act(async () => {
      release();
    });
    expect(result.current[1]).toBe(false);
  });

  it("allows a fresh call once the first settles", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useInFlightAction());
    await act(async () => result.current[0](fn));
    await act(async () => result.current[0](fn));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("clears the guard even when the action rejects", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useInFlightAction());
    await act(async () => result.current[0](fn));
    expect(result.current[1]).toBe(false);
    await act(async () => result.current[0](fn));
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
