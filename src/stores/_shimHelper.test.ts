/**
 * Regression tests for the popup-cluster slice shim.
 *
 * Covers the audit-fix patch (2026-05-25) that switched the shim to
 * (a) project only the named slice in the root selector, (b) cache the
 * merged `{...slice, ...actions}` shape per slice reference via WeakMap,
 * and (c) skip subscribers when the slice reference is unchanged across
 * root updates.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { usePopupStore } from "./popupStore";
// `createSliceShim` is intentionally module-internal; we test it through
// the public popup shim API, which is the consumer-facing contract.
import { useLinkPopupStore } from "./linkPopupStore";
import { useMathPopupStore } from "./mathPopupStore";

describe("createSliceShim — caching & subscriber gating", () => {
  beforeEach(() => {
    usePopupStore.setState((s) => ({
      linkPopup: { ...s.linkPopup, isOpen: false, href: "", linkFrom: 0, linkTo: 0, anchorRect: null },
      mathPopup: { ...s.mathPopup, isOpen: false, anchorRect: null, latex: "", nodePos: null },
    }));
  });

  it("returns the same merged-shape reference across calls when the slice is unchanged", () => {
    const a = useLinkPopupStore.getState();
    const b = useLinkPopupStore.getState();
    expect(a).toBe(b);  // WeakMap cache hit: identical reference
  });

  it("returns a new merged-shape reference after the slice changes", () => {
    const before = useLinkPopupStore.getState();
    useLinkPopupStore.getState().openPopup({
      href: "https://example.com",
      linkFrom: 0,
      linkTo: 4,
      anchorRect: { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 } as DOMRect,
    });
    const after = useLinkPopupStore.getState();
    expect(after).not.toBe(before);
    expect(after.isOpen).toBe(true);
    expect(after.href).toBe("https://example.com");
  });

  it("does not wake a subscriber when the root state changes but its slice reference is unchanged", () => {
    // The earlier version of this test called a sibling slice's action
    // (mathOpenPopup), which is a near-tautology — Zustand naturally
    // propagates set() to root subscribers, and the linkPopup slice ref
    // was unchanged regardless of the gate. To genuinely cover the
    // `if (nextSlice === prevSlice) return` short-circuit at
    // _shimHelper.ts, we have to force a root setState that returns a
    // NEW root object while keeping the linkPopup slice reference identical.

    let linkCalls = 0;
    const unsubscribe = useLinkPopupStore.subscribe(() => {
      linkCalls += 1;
    });

    // Re-shuffle the root without touching the linkPopup slice. Zustand's
    // root subscribe will fire on this. The shim's gate must suppress it.
    usePopupStore.setState((s) => ({ ...s }));

    expect(linkCalls).toBe(0);

    // Bonus check: a sibling-slice update also must not wake us, since
    // that path goes through the same gate.
    useMathPopupStore.getState().openPopup(
      { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 } as DOMRect,
      "x^2",
      0,
    );
    expect(linkCalls).toBe(0);

    unsubscribe();
  });

  it("wakes a subscriber when its own slice updates", () => {
    let linkCalls = 0;
    const unsubscribe = useLinkPopupStore.subscribe(() => {
      linkCalls += 1;
    });

    useLinkPopupStore.getState().openPopup({
      href: "https://example.com",
      linkFrom: 0,
      linkTo: 4,
      anchorRect: { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 } as DOMRect,
    });

    expect(linkCalls).toBe(1);
    unsubscribe();
  });
});
