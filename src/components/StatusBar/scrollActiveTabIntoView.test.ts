// @vitest-environment node
//
// WI-TNAV1.3 — scroll the active pill into view (F2).
//
// Activating a tab never scrolled its pill into view, so `Mod-Shift-]` past the
// visible region switched the document while the active pill stayed off-screen.
//
// The decision is pure and carries two laws. The DOM effect that consumes it is
// tested in `useScrollActiveTabIntoView.test.tsx` (jsdom) — these cases prove
// nothing about whether anything actually scrolls, which is the whole of F2.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { activationKey, scrollDecision, BROWSER_PILL_KEY } from "./scrollActiveTabIntoView";

const keyArb = fc.oneof(
  fc.constant(null),
  fc.constant(BROWSER_PILL_KEY),
  fc.constantFrom("t1", "t2", "t3"),
);

describe("scrollDecision", () => {
  it("is absorbed by isDragging, for every other input", () => {
    // Computing the behaviour first and checking `isDragging` inside only one
    // branch passes an example-based version of this and fails here.
    fc.assert(
      fc.property(keyArb, keyArb, fc.boolean(), (prevKey, nextKey, reducedMotion) => {
        expect(scrollDecision({ prevKey, nextKey, isDragging: true, reducedMotion })).toBeNull();
      }),
    );
  });

  it("never scrolls when the activation key is unchanged", () => {
    // Idempotence. Triggering off a render rather than a key change means a
    // scroll on every keystroke that touches the status bar.
    fc.assert(
      fc.property(keyArb, fc.boolean(), (key, reducedMotion) => {
        expect(scrollDecision({ prevKey: key, nextKey: key, isDragging: false, reducedMotion })).toBeNull();
      }),
    );
  });

  it("scrolls with block and inline nearest on a changed key", () => {
    // `block: "center"` would scroll the whole page for a status bar sitting at
    // the viewport edge.
    expect(
      scrollDecision({ prevKey: "a", nextKey: "b", isDragging: false, reducedMotion: false }),
    ).toEqual({ behavior: "smooth", block: "nearest", inline: "nearest" });
  });

  it.each([
    { reducedMotion: true, behavior: "auto" },
    { reducedMotion: false, behavior: "smooth" },
  ])("honours prefers-reduced-motion ($reducedMotion)", ({ reducedMotion, behavior }) => {
    expect(
      scrollDecision({ prevKey: "a", nextKey: "b", isDragging: false, reducedMotion })?.behavior,
    ).toBe(behavior);
  });
});

describe("activationKey", () => {
  it("changes when the browser pill activates even though activeTabId stays null", () => {
    // `StatusBar.tsx:218` passes `activeTabId={null}` whenever the browser pill
    // is active, so an `activeTabId`-only trigger can NEVER reveal that pill —
    // and no activeTabId-based test would notice.
    const inactive = activationKey({ activeTabId: null, browserWorkspaceActive: false});
    const active = activationKey({ activeTabId: null, browserWorkspaceActive: true});

    expect(inactive).not.toBe(active);
    expect(active).toBe(BROWSER_PILL_KEY);
    expect(
      scrollDecision({ prevKey: inactive, nextKey: active, isDragging: false, reducedMotion: false }),
    ).not.toBeNull();
    // …and back. Deactivating the browser workspace activates a DOCUMENT tab —
    // `(null, inactive)` means "no pill is current", which is not a scroll
    // target and correctly decides nothing. The claim that matters in both
    // directions is that the KEY moves; only the direction with a target scrolls.
    const backToDoc = activationKey({
      activeTabId: "t1",
      browserWorkspaceActive: false,
    });
    expect(backToDoc).not.toBe(active);
    expect(
      scrollDecision({ prevKey: active, nextKey: backToDoc, isDragging: false, reducedMotion: false }),
    ).not.toBeNull();
    expect(
      scrollDecision({ prevKey: active, nextKey: inactive, isDragging: false, reducedMotion: false }),
    ).toBeNull();
  });

  it("tracks the document tab when the browser workspace is inactive", () => {
    expect(activationKey({ activeTabId: "t3", browserWorkspaceActive: false})).toBe("t3");
  });
});
