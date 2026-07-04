import { describe, expect, it } from "vitest";
import { asArrayBufferBacked } from "./binary";

describe("asArrayBufferBacked", () => {
  it("returns the same view (zero-copy) when already ArrayBuffer-backed", () => {
    const view = new Uint8Array([1, 2, 3]);
    expect(asArrayBufferBacked(view)).toBe(view);
  });

  it("preserves byte offset and length of a subarray view", () => {
    const base = new Uint8Array([0, 1, 2, 3, 4, 5]);
    const sub = base.subarray(2, 5);
    const result = asArrayBufferBacked(sub);
    expect(result).toBe(sub);
    expect(Array.from(result)).toEqual([2, 3, 4]);
  });

  it("copies into a fresh ArrayBuffer-backed view when backed by SharedArrayBuffer", () => {
    // SharedArrayBuffer may be unavailable in some environments (needs COOP/COEP);
    // skip the copy branch there — the zero-copy branch above is the real path.
    if (typeof SharedArrayBuffer === "undefined") return;
    const shared = new SharedArrayBuffer(3);
    const view = new Uint8Array(shared);
    view.set([7, 8, 9]);
    const result = asArrayBufferBacked(view);
    expect(result).not.toBe(view);
    expect(result.buffer).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(result)).toEqual([7, 8, 9]);
  });

  it("handles empty views", () => {
    const view = new Uint8Array(0);
    expect(Array.from(asArrayBufferBacked(view))).toEqual([]);
  });
});
