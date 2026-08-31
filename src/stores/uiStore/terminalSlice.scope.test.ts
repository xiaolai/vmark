// @vitest-environment node
// WI-TS1.1 — owner stamping + union cap/ordinal allocation on
// terminalCreateSession (plan 20260831-terminal-per-instance-sessions, D-T1/D-T5).
import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_TERMINAL_SESSIONS,
  resetTerminalSessionStore,
  useUIStore,
} from "@/stores/uiStore";

function create(ownerInstanceId?: string) {
  return useUIStore
    .getState()
    .terminalCreateSession(ownerInstanceId ? { ownerInstanceId } : undefined);
}

beforeEach(() => {
  resetTerminalSessionStore();
});

describe("terminalCreateSession — owner stamping (D-T1)", () => {
  it("stamps workspaceInstanceId when ownerInstanceId is given", () => {
    const s = create("wsi-a");
    expect(s?.workspaceInstanceId).toBe("wsi-a");
  });

  it("leaves the key ABSENT (not undefined) without an owner — window-scoped", () => {
    const s = create();
    expect(s).not.toBeNull();
    expect(Object.keys(s ?? {})).not.toContain("workspaceInstanceId");
  });

  it("preserves lastActiveByScope across creations", () => {
    useUIStore.setState((state) => ({
      terminal: { ...state.terminal, lastActiveByScope: { "wsi-a": null } },
    }));
    create("wsi-a");
    expect(useUIStore.getState().terminal.lastActiveByScope).toEqual({ "wsi-a": null });
  });
});

describe("terminalCreateSession — union cap (D-T5, creation-time gate only)", () => {
  it("caps per visible union: a full scope blocks, a fresh scope does not", () => {
    for (let i = 0; i < MAX_TERMINAL_SESSIONS; i++) {
      expect(create("wsi-a")).not.toBeNull();
    }
    expect(create("wsi-a")).toBeNull();
    // Another scope's union is empty — creation proceeds.
    expect(create("wsi-b")).not.toBeNull();
  });

  it("window-scoped sessions count toward every scope's union", () => {
    create(); // window-scoped — visible in every scope
    for (let i = 0; i < MAX_TERMINAL_SESSIONS - 1; i++) {
      expect(create("wsi-a")).not.toBeNull();
    }
    expect(create("wsi-a")).toBeNull();
  });

  it("an unscoped creation counts every session (exact for rail-off and both rail-on carve-outs)", () => {
    for (let i = 0; i < MAX_TERMINAL_SESSIONS; i++) create("wsi-a");
    expect(create()).toBeNull();
  });

  it("cap is a creation gate, not a population invariant: rekey can exceed it and kills nothing", () => {
    for (let i = 0; i < 3; i++) create("wsi-a");
    for (let i = 0; i < 3; i++) create("wsi-old");
    useUIStore.getState().terminalRekeyScope("wsi-old", "wsi-a");

    const sessions = useUIStore.getState().terminal.sessions;
    expect(sessions).toHaveLength(6);
    expect(sessions.every((s) => s.workspaceInstanceId === "wsi-a")).toBe(true);
    // Over-cap population is representable; creation stays blocked.
    expect(create("wsi-a")).toBeNull();
  });
});

describe("terminalCreateSession — union ordinals (D-T5)", () => {
  it("allocates the smallest unused ordinal across the visible union", () => {
    create("wsi-a"); // A:1
    create("wsi-a"); // A:2
    const b = create("wsi-b");
    expect(b?.ordinal).toBe(1); // B's union is empty — reuses 1 invisibly to A

    const unscoped = create();
    // Window-scoped: visible in every scope, so distinct from EVERY ordinal.
    expect(unscoped?.ordinal).toBe(3);
  });

  it("no two co-visible sessions share an ordinal", () => {
    create("wsi-a");
    create("wsi-b");
    create();
    create("wsi-a");
    const sessions = useUIStore.getState().terminal.sessions;
    const visibleInA = sessions.filter(
      (s) => !s.workspaceInstanceId || s.workspaceInstanceId === "wsi-a",
    );
    const ordinals = visibleInA.map((s) => s.ordinal);
    expect(new Set(ordinals).size).toBe(ordinals.length);
  });

  it("rail-off allocation is identical to today: 1..5 then null", () => {
    const ordinals: number[] = [];
    for (let i = 0; i < MAX_TERMINAL_SESSIONS; i++) {
      const s = create();
      if (s) ordinals.push(s.ordinal);
    }
    expect(ordinals).toEqual([1, 2, 3, 4, 5]);
    expect(create()).toBeNull();
  });
});

describe("terminalRemoveSession — visible-population fallback (WI-TS1.2)", () => {
  it("falls back to the last remaining VISIBLE session when visibleIds is given", () => {
    const sa = create("wsi-a")!;
    const sb = create("wsi-b")!;
    const su = create()!;
    useUIStore.getState().terminalSetActiveSession(sa.id);

    // A's visible population is {sa, su} — sb is another scope's session.
    useUIStore.getState().terminalRemoveSession(sa.id, { visibleIds: [sa.id, su.id] });

    expect(useUIStore.getState().terminal.activeSessionId).toBe(su.id);
    expect(useUIStore.getState().terminal.sessions.map((s) => s.id)).toEqual([
      sb.id,
      su.id,
    ]);
  });

  it("without the hint, behaves exactly as before (last remaining)", () => {
    const s1 = create()!;
    const s2 = create()!;
    useUIStore.getState().terminalSetActiveSession(s1.id);
    useUIStore.getState().terminalRemoveSession(s1.id);
    expect(useUIStore.getState().terminal.activeSessionId).toBe(s2.id);
  });

  it("falls back to null when nothing visible remains", () => {
    const sa = create("wsi-a")!;
    const sb = create("wsi-b")!;
    useUIStore.getState().terminalSetActiveSession(sa.id);
    useUIStore.getState().terminalRemoveSession(sa.id, { visibleIds: [sa.id] });
    expect(useUIStore.getState().terminal.activeSessionId).toBeNull();
    expect(useUIStore.getState().terminal.sessions.map((s) => s.id)).toEqual([sb.id]);
  });
});

describe("terminalRemoveSession — fallback activation clears activity (R3-1)", () => {
  it("the fallback session's pending activity dot clears on activation (D-T11)", () => {
    const s1 = create()!;
    const s2 = create()!; // active
    expect(useUIStore.getState().terminal.activeSessionId).toBe(s2.id);
    // s1 is NOT active, so it can carry an activity dot.
    useUIStore.getState().terminalMarkActivity(s1.id);
    expect(
      useUIStore.getState().terminal.sessions.find((s) => s.id === s1.id)?.hasActivity,
    ).toBe(true);

    useUIStore.getState().terminalRemoveSession(s2.id);

    // s1 became the visible active session — a stale dot on the session the
    // user is now LOOKING AT is the exact state D-T11 forbids.
    const terminal = useUIStore.getState().terminal;
    expect(terminal.activeSessionId).toBe(s1.id);
    expect(terminal.sessions.find((s) => s.id === s1.id)?.hasActivity).toBe(false);
  });

  it("removing a NON-active session leaves the active session untouched", () => {
    const s1 = create()!;
    const s2 = create()!; // active
    useUIStore.getState().terminalRemoveSession(s1.id);
    expect(useUIStore.getState().terminal.activeSessionId).toBe(s2.id);
  });
});
