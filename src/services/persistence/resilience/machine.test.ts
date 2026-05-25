/**
 * Resilience state-machine tests — T07.
 *
 * Locks the transition table from dev-docs/error-recovery.md.
 */

import { describe, it, expect } from "vitest";
import {
  createResilienceMachine,
  isLegalTransition,
  type ResilienceState,
} from "./machine";

describe("isLegalTransition", () => {
  const legal: Array<[ResilienceState, ResilienceState]> = [
    ["idle", "restoring"],
    ["idle", "ready"],
    ["restoring", "ready"],
    ["restoring", "cleaning"],
    ["ready", "snapshotting"],
    ["ready", "cleaning"],
    ["snapshotting", "ready"],
    ["cleaning", "idle"],
  ];

  for (const [from, to] of legal) {
    it(`allows ${from} → ${to}`, () => {
      expect(isLegalTransition(from, to)).toBe(true);
    });
  }

  const illegal: Array<[ResilienceState, ResilienceState]> = [
    ["idle", "snapshotting"], // can't snapshot before restoring
    ["idle", "cleaning"], // nothing to clean from idle
    ["restoring", "snapshotting"], // can't snapshot during restore (torn-write risk)
    ["snapshotting", "cleaning"], // snapshot must finish first
    ["cleaning", "ready"], // cleanup must complete to idle, not bounce back
  ];

  for (const [from, to] of illegal) {
    it(`rejects ${from} → ${to}`, () => {
      expect(isLegalTransition(from, to)).toBe(false);
    });
  }

  it("treats same-state re-entry as legal (no-op)", () => {
    const states: ResilienceState[] = ["idle", "restoring", "ready", "snapshotting", "cleaning"];
    for (const s of states) {
      expect(isLegalTransition(s, s)).toBe(true);
    }
  });
});

describe("createResilienceMachine", () => {
  it("starts in idle", () => {
    const m = createResilienceMachine();
    expect(m.state).toBe("idle");
  });

  it("starts in a given initial state", () => {
    const m = createResilienceMachine("ready");
    expect(m.state).toBe("ready");
  });

  it("applies legal transitions", () => {
    const m = createResilienceMachine("idle");
    expect(m.transition("restoring")).toBe(true);
    expect(m.state).toBe("restoring");
    expect(m.transition("ready")).toBe(true);
    expect(m.state).toBe("ready");
  });

  it("rejects illegal transitions without changing state", () => {
    const m = createResilienceMachine("idle");
    expect(m.transition("snapshotting")).toBe(false);
    expect(m.state).toBe("idle");
  });

  it("locks the documented full lifecycle", () => {
    const m = createResilienceMachine("idle");
    expect(m.transition("restoring")).toBe(true);
    expect(m.transition("ready")).toBe(true);
    expect(m.transition("snapshotting")).toBe(true);
    expect(m.transition("ready")).toBe(true);
    expect(m.transition("cleaning")).toBe(true);
    expect(m.transition("idle")).toBe(true);
    expect(m.state).toBe("idle");
  });
});
