/**
 * Tests for useUpdateStall (#1270).
 *
 * The hook exists so a flow that stops progressing stops being permanent.
 * These cases pin the two properties that matter: a live transfer must NOT be
 * reported as stalled (a false positive offers a reset button mid-download),
 * and a state that genuinely stops moving must be.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMcpStore } from "@/stores/mcpStore";
import {
  useUpdateStall,
  stallThresholdFor,
  CHECK_STALL_MS,
  TRANSFER_STALL_MS,
} from "./useUpdateStall";

describe("stallThresholdFor", () => {
  it("bounds only the states that can stall", () => {
    expect(stallThresholdFor("checking")).toBe(CHECK_STALL_MS);
    expect(stallThresholdFor("downloading")).toBe(TRANSFER_STALL_MS);
    expect(stallThresholdFor("installing")).toBe(TRANSFER_STALL_MS);
  });

  // Every other state is either terminal or already clickable, so a stall
  // notion for it would be meaningless.
  it.each(["idle", "up-to-date", "available", "ready", "error"] as const)(
    "leaves %s unbounded",
    (status) => {
      expect(stallThresholdFor(status)).toBeNull();
    },
  );

  // The check carries a 30s request timeout, so its threshold has to sit
  // above that or the hook fires while the bounded call is still legitimately
  // running.
  it("gives the check room beyond its own request timeout", () => {
    expect(CHECK_STALL_MS).toBeGreaterThan(30_000);
  });

  // The download is deliberately unbounded (a total-request timeout would
  // abort slow-but-working transfers), so it needs the more generous window.
  it("gives transfers a longer window than the check", () => {
    expect(TRANSFER_STALL_MS).toBeGreaterThan(CHECK_STALL_MS);
  });
});

describe("useUpdateStall", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useMcpStore.getState().resetUpdate();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not report a stall for a state that cannot stall", () => {
    useMcpStore.getState().setUpdateStatus("available");
    const { result } = renderHook(() => useUpdateStall());

    act(() => {
      vi.advanceTimersByTime(TRANSFER_STALL_MS * 2);
    });

    expect(result.current).toBe(false);
  });

  it("reports a stall once a checking state stops progressing", () => {
    useMcpStore.getState().setUpdateStatus("checking");
    const { result } = renderHook(() => useUpdateStall());

    expect(result.current).toBe(false);

    act(() => {
      vi.advanceTimersByTime(CHECK_STALL_MS + 5_000);
    });

    expect(result.current).toBe(true);
  });

  // The important negative: a download that is still moving bytes must never
  // be offered a reset button, however long it takes overall.
  it("does not report a stall while a download keeps making progress", () => {
    const store = useMcpStore.getState();
    store.setUpdateStatus("downloading");
    store.setDownloadProgress({ downloaded: 0, total: 1_000 });

    const { result, rerender } = renderHook(() => useUpdateStall());

    for (let i = 1; i <= 6; i++) {
      act(() => {
        vi.advanceTimersByTime(TRANSFER_STALL_MS / 2);
        useMcpStore.getState().setDownloadProgress({ downloaded: i * 100, total: 1_000 });
      });
      rerender();
      expect(result.current).toBe(false);
    }
  });

  it("reports a stall when a download stops making progress", () => {
    const store = useMcpStore.getState();
    store.setUpdateStatus("downloading");
    store.setDownloadProgress({ downloaded: 500, total: 1_000 });

    const { result } = renderHook(() => useUpdateStall());

    act(() => {
      vi.advanceTimersByTime(TRANSFER_STALL_MS + 5_000);
    });

    expect(result.current).toBe(true);
  });

  // Recovery moves the flow back to idle; the hook must follow rather than
  // latching on the stale verdict.
  it("clears the stall once the flow leaves the stalled state", () => {
    useMcpStore.getState().setUpdateStatus("checking");
    const { result, rerender } = renderHook(() => useUpdateStall());

    act(() => {
      vi.advanceTimersByTime(CHECK_STALL_MS + 5_000);
    });
    expect(result.current).toBe(true);

    act(() => {
      useMcpStore.getState().resetUpdate();
    });
    rerender();

    expect(result.current).toBe(false);
  });
});
