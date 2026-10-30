/**
 * Tests for useMediaAsset — the asset-grant lifecycle behind MediaView.
 *
 * Covers: the grant is requested for media paths only; `granted` flips once
 * the grant settles, including when it REJECTS; a path change resets the
 * grant and a stale grant for the old path cannot mark the new one; errors
 * are scoped to one path-and-version so a reload gets a fresh attempt; and
 * the reload key rides in the `asset://` URL.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((p: string) => `asset://localhost/${encodeURIComponent(p)}`),
}));

import { invoke } from "@tauri-apps/api/core";
import { useMediaAsset } from "./useMediaAsset";

const mockInvoke = vi.mocked(invoke);

/** A grant the test settles by hand. */
function deferredGrant() {
  let resolve: () => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue(undefined);
});

describe("useMediaAsset", () => {
  it("requests a grant for the media path and reports granted once it resolves", async () => {
    const grant = deferredGrant();
    mockInvoke.mockReturnValueOnce(grant.promise);

    const { result } = renderHook(() => useMediaAsset("/w/photo.png", 0));

    expect(mockInvoke).toHaveBeenCalledWith("grant_asset_access", { path: "/w/photo.png" });
    expect(result.current.granted).toBe(false);

    await act(async () => grant.resolve());
    expect(result.current.granted).toBe(true);
  });

  it("still reports granted when the grant REJECTS, so the element's onError shows the fallback", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("outside scope"));

    const { result } = renderHook(() => useMediaAsset("/w/photo.png", 0));

    await waitFor(() => expect(result.current.granted).toBe(true));
  });

  it("does not request a grant for a non-media path", () => {
    const { result } = renderHook(() => useMediaAsset("/w/notes.txt", 0));

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(result.current.granted).toBe(false);
  });

  it("resets on a path change, and a late grant for the old path cannot mark the new one", async () => {
    const oldGrant = deferredGrant();
    const newGrant = deferredGrant();
    mockInvoke.mockReturnValueOnce(oldGrant.promise).mockReturnValueOnce(newGrant.promise);

    const { result, rerender } = renderHook(({ path }) => useMediaAsset(path, 0), {
      initialProps: { path: "/w/a.png" },
    });
    rerender({ path: "/w/b.png" });

    await act(async () => oldGrant.resolve());
    expect(result.current.granted).toBe(false);

    await act(async () => newGrant.resolve());
    expect(result.current.granted).toBe(true);
  });

  it("scopes an error to one path-and-version: a reload gets a fresh attempt", async () => {
    const { result, rerender } = renderHook(({ key }) => useMediaAsset("/w/a.png", key), {
      initialProps: { key: 0 },
    });
    await waitFor(() => expect(result.current.granted).toBe(true));

    act(() => result.current.markErrored());
    expect(result.current.errored).toBe(true);
    const failedAttempt = result.current.attempt;

    rerender({ key: 1 });
    expect(result.current.errored).toBe(false);
    expect(result.current.attempt).not.toBe(failedAttempt);
    // The reload does not re-request a grant: the path did not change.
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("carries the reload key in the asset URL, and omits it before the first reload", () => {
    const { result, rerender } = renderHook(({ key }) => useMediaAsset("/w/a.png", key), {
      initialProps: { key: 0 },
    });
    expect(result.current.src).not.toMatch(/[?&]v=/);

    rerender({ key: 3 });
    expect(result.current.src).toMatch(/[?&]v=3$/);
  });
});
