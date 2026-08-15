// @vitest-environment node
// Audit 20260815-163607 #20 — the reconciliation this covers used to live inline
// in a 61-line effect that no test reached (TerminalPanel.test.tsx mocks the hook).
import { describe, expect, it } from "vitest";
import { diffSessionIds } from "./terminalSessionReconcile";

const ids = (...xs: string[]) => new Set(xs);
const none = () => false;

describe("diffSessionIds", () => {
  it("reports nothing for an unchanged set", () => {
    expect(diffSessionIds(ids("a", "b"), ids("a", "b"), none)).toEqual({ added: [], removed: [] });
  });

  it("reports an added session", () => {
    expect(diffSessionIds(ids("a"), ids("a", "b"), none)).toEqual({ added: ["b"], removed: [] });
  });

  it("reports a removed session", () => {
    expect(diffSessionIds(ids("a", "b"), ids("a"), none)).toEqual({ added: [], removed: ["b"] });
  });

  it("reports an add and a remove in the same tick", () => {
    const d = diffSessionIds(ids("a", "b"), ids("a", "c"), none);
    expect(d).toEqual({ added: ["c"], removed: ["b"] });
  });

  // The guard that stops a session being constructed twice when the store and
  // the instance map disagree — e.g. a hot-exit restore that already built it.
  it("does not re-add a session that already has an instance", () => {
    const d = diffSessionIds(ids(), ids("a"), (id) => id === "a");
    expect(d.added).toEqual([]);
  });

  it("still removes a session that has no instance", () => {
    expect(diffSessionIds(ids("a"), ids(), none).removed).toEqual(["a"]);
  });

  it("handles both sets empty", () => {
    expect(diffSessionIds(ids(), ids(), none)).toEqual({ added: [], removed: [] });
  });

  it("treats a full replacement as every id added and every old id removed", () => {
    const d = diffSessionIds(ids("a", "b"), ids("c", "d"), none);
    expect(d.added.sort()).toEqual(["c", "d"]);
    expect(d.removed.sort()).toEqual(["a", "b"]);
  });

  it("does not mutate either input set", () => {
    const prev = ids("a");
    const next = ids("b");
    diffSessionIds(prev, next, none);
    expect([...prev]).toEqual(["a"]);
    expect([...next]).toEqual(["b"]);
  });
});
