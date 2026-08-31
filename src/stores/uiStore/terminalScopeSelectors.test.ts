// @vitest-environment node
// WI-TS1.3 — scoped visibility selectors (plan 20260831, invariant 4/7, D-T15).
import { describe, expect, it } from "vitest";
import {
  selectVisibleSessionCount,
  selectVisibleTerminalSessions,
} from "./terminalScopeSelectors";
import type { TerminalSession } from "./types";

const mk = (id: string, workspaceInstanceId?: string): TerminalSession => ({
  id,
  label: id,
  ordinal: 1,
  isAlive: true,
  ...(workspaceInstanceId ? { workspaceInstanceId } : {}),
});

const population = {
  sessions: [mk("u1"), mk("a1", "wsi-a"), mk("a2", "wsi-a"), mk("b1", "wsi-b")],
};

describe("selectVisibleTerminalSessions", () => {
  it("rail on: active-instance scope ∪ window-scoped", () => {
    const visible = selectVisibleTerminalSessions(population, "wsi-a", true);
    expect(visible.map((s) => s.id)).toEqual(["u1", "a1", "a2"]);
  });

  it("rail on with no active instance: window-scoped only", () => {
    const visible = selectVisibleTerminalSessions(population, null, true);
    expect(visible.map((s) => s.id)).toEqual(["u1"]);
  });

  it("rail off: ALL sessions, stamped included (D-T15 — stamps are inert)", () => {
    const visible = selectVisibleTerminalSessions(population, "wsi-a", false);
    expect(visible.map((s) => s.id)).toEqual(["u1", "a1", "a2", "b1"]);
  });

  it("invariant 4: stamp → rail off → all visible → rail on → scoped again", () => {
    const on = selectVisibleTerminalSessions(population, "wsi-b", true);
    expect(on.map((s) => s.id)).toEqual(["u1", "b1"]);

    const off = selectVisibleTerminalSessions(population, "wsi-b", false);
    expect(off).toHaveLength(4);

    // The toggle is involutive — stamps survived untouched.
    const onAgain = selectVisibleTerminalSessions(population, "wsi-b", true);
    expect(onAgain.map((s) => s.id)).toEqual(["u1", "b1"]);
  });
});

describe("selectVisibleSessionCount (invariant 7 — the one exported count)", () => {
  it("equals the visible population's size in both rail modes", () => {
    expect(selectVisibleSessionCount(population, "wsi-a", true)).toBe(3);
    expect(selectVisibleSessionCount(population, "wsi-b", true)).toBe(2);
    expect(selectVisibleSessionCount(population, null, true)).toBe(1);
    expect(selectVisibleSessionCount(population, null, false)).toBe(4);
  });
});
