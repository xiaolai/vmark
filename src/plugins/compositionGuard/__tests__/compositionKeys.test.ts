// @vitest-environment node
/**
 * Tests for compositionKeys.ts — which key events the composition guard claims.
 *
 * The load-bearing case is the undispatched one: ProseMirror's domchange.ts
 * synthesizes a key event it never dispatches, and reads `true` as "discard the
 * parsed DOM change" (#1392). The guard must decline those, and only those.
 */

import { describe, it, expect } from "vitest";
import {
  isDispatchedKeyEvent,
  shouldGuardKeyEvent,
  type GuardedKeyEvent,
} from "../compositionKeys";

/** A never-dispatched event, exactly as prosemirror-view's keyEvent() builds it. */
function synthesized(overrides: Partial<GuardedKeyEvent> = {}): GuardedKeyEvent {
  return { isComposing: false, keyCode: 8, target: null, ...overrides } as GuardedKeyEvent;
}

/** An event that went through real DOM dispatch, so it carries a target. */
function dispatched(overrides: Partial<GuardedKeyEvent> = {}): GuardedKeyEvent {
  return { isComposing: false, keyCode: 65, target: {} as EventTarget, ...overrides } as GuardedKeyEvent;
}

describe("isDispatchedKeyEvent", () => {
  it("is false only when target is null", () => {
    expect(isDispatchedKeyEvent(synthesized())).toBe(false);
  });

  it("is true for an event carrying a target", () => {
    expect(isDispatchedKeyEvent(dispatched())).toBe(true);
  });

  it("fails closed on an event with no target property at all", () => {
    // An unclassifiable event keeps its IME protection rather than losing it.
    expect(isDispatchedKeyEvent({} as GuardedKeyEvent)).toBe(true);
  });
});

describe("shouldGuardKeyEvent", () => {
  it.each([
    { name: "synthesized Backspace during grace", event: synthesized(), grace: true },
    { name: "synthesized Backspace outside grace", event: synthesized(), grace: false },
    { name: "synthesized Enter during grace", event: synthesized({ keyCode: 13 }), grace: true },
    // Unreachable today — prosemirror-view's keyEvent() sets neither flag — but
    // pinned so the key-agnostic rule is not quietly narrowed to Backspace.
    { name: "synthesized event flagged as composing", event: synthesized({ isComposing: true }), grace: true },
    { name: "synthesized event with IME keyCode", event: synthesized({ keyCode: 229 }), grace: true },
  ])("declines a $name", ({ event, grace }) => {
    expect(shouldGuardKeyEvent(event, grace)).toBe(false);
  });

  it.each([
    { name: "composing keystroke", event: dispatched({ isComposing: true }), grace: false },
    { name: "keyCode 229 keystroke", event: dispatched({ keyCode: 229 }), grace: false },
    { name: "ordinary keystroke during grace", event: dispatched(), grace: true },
    { name: "Backspace during grace", event: dispatched({ keyCode: 8 }), grace: true },
    { name: "Enter during grace", event: dispatched({ keyCode: 13 }), grace: true },
  ])("claims a dispatched $name", ({ event, grace }) => {
    expect(shouldGuardKeyEvent(event, grace)).toBe(true);
  });

  it("declines an ordinary dispatched keystroke outside the grace period", () => {
    expect(shouldGuardKeyEvent(dispatched(), false)).toBe(false);
  });
});
