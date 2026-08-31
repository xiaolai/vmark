// @vitest-environment node
// WI-TS1.2 — scope-transition actions: adopt / switchScope / hydrateScope /
// removeScopeSessions / rekeyScope (plan 20260831, D-T2/D-T3/D-T5/D-T6/D-T11).
import { beforeEach, describe, expect, it } from "vitest";
import { resetTerminalSessionStore, useUIStore } from "@/stores/uiStore";
import type { TerminalSession } from "@/stores/uiStore/types";

const create = (ownerInstanceId?: string) =>
  useUIStore
    .getState()
    .terminalCreateSession(ownerInstanceId ? { ownerInstanceId } : undefined)!;

const sessions = () => useUIStore.getState().terminal.sessions;
const activeId = () => useUIStore.getState().terminal.activeSessionId;
const memory = () => useUIStore.getState().terminal.lastActiveByScope;

beforeEach(() => {
  resetTerminalSessionStore();
});

describe("terminalAdoptUnscopedSessions", () => {
  it("stamps every window-scoped session; scoped sessions untouched (monotone owners)", () => {
    const su1 = create();
    const sb = create("wsi-b");
    const su2 = create();

    useUIStore.getState().terminalAdoptUnscopedSessions("wsi-a");

    const byId = new Map(sessions().map((s) => [s.id, s]));
    expect(byId.get(su1.id)?.workspaceInstanceId).toBe("wsi-a");
    expect(byId.get(su2.id)?.workspaceInstanceId).toBe("wsi-a");
    expect(byId.get(sb.id)?.workspaceInstanceId).toBe("wsi-b");
  });

  it("is idempotent — a second call does not wake the store", () => {
    create();
    useUIStore.getState().terminalAdoptUnscopedSessions("wsi-a");
    const before = useUIStore.getState().terminal;
    useUIStore.getState().terminalAdoptUnscopedSessions("wsi-a");
    expect(useUIStore.getState().terminal).toBe(before);
  });

  it("renumbers on in-scope ordinal collision, labels untouched", () => {
    // Colliding ordinals cannot arise from creation alone (the union rule
    // prevents it), so construct the population directly: an adopted session
    // whose ordinal collides with a pre-existing scoped one.
    const mk = (
      id: string,
      ordinal: number,
      workspaceInstanceId?: string,
    ): TerminalSession => ({
      id,
      label: `Terminal ${ordinal}`,
      ordinal,
      isAlive: true,
      ...(workspaceInstanceId ? { workspaceInstanceId } : {}),
    });
    useUIStore.setState((s) => ({
      terminal: {
        ...s.terminal,
        sessions: [mk("t-a", 1, "wsi-a"), mk("t-u", 1)],
        activeSessionId: "t-u",
      },
    }));

    useUIStore.getState().terminalAdoptUnscopedSessions("wsi-a");

    const byId = new Map(sessions().map((s) => [s.id, s]));
    expect(byId.get("t-a")?.ordinal).toBe(1); // pre-existing keeps its ordinal
    expect(byId.get("t-u")?.ordinal).toBe(2); // adopted takes smallest unused
    expect(byId.get("t-u")?.label).toBe("Terminal 1"); // label untouched
  });

  it("never removes a session (D-T3: adoption is not a removal path)", () => {
    create();
    create("wsi-b");
    useUIStore.getState().terminalAdoptUnscopedSessions("wsi-a");
    expect(sessions()).toHaveLength(2);
  });
});

describe("terminalSwitchScope", () => {
  it("remembers the outgoing scope's shown session and restores it on return", () => {
    const sa = create("wsi-a");
    const sb = create("wsi-b");
    useUIStore.getState().terminalSetActiveSession(sa.id);

    useUIStore.getState().terminalSwitchScope("wsi-a", "wsi-b");
    expect(memory()["wsi-a"]).toBe(sa.id);
    expect(activeId()).toBe(sb.id);

    useUIStore.getState().terminalSwitchScope("wsi-b", "wsi-a");
    expect(memory()["wsi-b"]).toBe(sb.id);
    expect(activeId()).toBe(sa.id);
  });

  it("activates null for an empty incoming scope", () => {
    const sa = create("wsi-a");
    useUIStore.getState().terminalSetActiveSession(sa.id);
    useUIStore.getState().terminalSwitchScope("wsi-a", "wsi-empty");
    expect(activeId()).toBeNull();
  });

  it("falls back to first-visible when the remembered session was closed", () => {
    const sa1 = create("wsi-a");
    const sa2 = create("wsi-a");
    useUIStore.getState().terminalSetActiveSession(sa2.id);
    useUIStore.getState().terminalSwitchScope("wsi-a", "wsi-b");
    useUIStore.getState().terminalRemoveSession(sa2.id);

    useUIStore.getState().terminalSwitchScope("wsi-b", "wsi-a");
    expect(activeId()).toBe(sa1.id);
  });

  it("clears hasActivity on the session it activates (D-T11: B→A with a bell on A's remembered)", () => {
    const sa = create("wsi-a");
    const sb = create("wsi-b");
    useUIStore.getState().terminalSetActiveSession(sa.id);
    useUIStore.getState().terminalSwitchScope("wsi-a", "wsi-b");
    expect(activeId()).toBe(sb.id);

    // A bell rings on A's remembered (now background) session.
    useUIStore.getState().terminalMarkActivity(sa.id);
    expect(sessions().find((s) => s.id === sa.id)?.hasActivity).toBe(true);

    useUIStore.getState().terminalSwitchScope("wsi-b", "wsi-a");
    expect(activeId()).toBe(sa.id);
    expect(sessions().find((s) => s.id === sa.id)?.hasActivity).toBe(false);
  });

  it("records null when the outgoing scope was showing nothing", () => {
    create("wsi-b");
    useUIStore.setState((s) => ({
      terminal: { ...s.terminal, activeSessionId: null },
    }));
    useUIStore.getState().terminalSwitchScope("wsi-a", "wsi-b");
    expect(memory()["wsi-a"]).toBeNull();
  });
});

describe("terminalHydrateScope", () => {
  it("activates like switchScope but writes NO outgoing memory", () => {
    const sa = create("wsi-a");
    const sb = create("wsi-b");
    useUIStore.getState().terminalSetActiveSession(sa.id);

    useUIStore.getState().terminalHydrateScope("wsi-b");

    expect(activeId()).toBe(sb.id);
    expect(memory()).toEqual({});
  });

  it("is idempotent/convergent (D-T12): a second hydrate re-derives the same state", () => {
    create("wsi-a");
    useUIStore.getState().terminalHydrateScope("wsi-a");
    const first = useUIStore.getState().terminal;
    useUIStore.getState().terminalHydrateScope("wsi-a");
    expect(useUIStore.getState().terminal.activeSessionId).toBe(first.activeSessionId);
    expect(useUIStore.getState().terminal.sessions).toEqual(first.sessions);
  });
});

describe("terminalRemoveScopeSessions", () => {
  it("removes exactly the scope's sessions and drops its memory slot", () => {
    const sa = create("wsi-a");
    const sb = create("wsi-b");
    const su = create();
    useUIStore.getState().terminalSetActiveSession(sa.id);
    useUIStore.getState().terminalSwitchScope("wsi-a", "wsi-b");

    useUIStore.getState().terminalRemoveScopeSessions("wsi-a");

    expect(sessions().map((s) => s.id).sort()).toEqual([sb.id, su.id].sort());
    expect("wsi-a" in memory()).toBe(false);
  });

  it("nulls the active session when it was in the removed scope", () => {
    const sa = create("wsi-a");
    create("wsi-b");
    useUIStore.getState().terminalSetActiveSession(sa.id);
    useUIStore.getState().terminalRemoveScopeSessions("wsi-a");
    expect(activeId()).toBeNull();
  });
});

describe("terminalRekeyScope (D-T6 merge)", () => {
  it("merges with BOTH scopes populated: stamps moved, renumbers collisions, memory target-wins", () => {
    const sNew = create("wsi-new"); // ordinal 1 in wsi-new
    const sOld = create("wsi-old"); // ordinal 1 in wsi-old — collides after merge
    useUIStore.getState().terminalSetActiveSession(sNew.id);
    useUIStore.getState().terminalSwitchScope("wsi-new", "wsi-old");
    useUIStore.getState().terminalSwitchScope("wsi-old", "wsi-new");
    // memory: { "wsi-new": sNew, "wsi-old": sOld } — target must win.

    useUIStore.getState().terminalRekeyScope("wsi-old", "wsi-new");

    const byId = new Map(sessions().map((s) => [s.id, s]));
    expect(byId.get(sOld.id)?.workspaceInstanceId).toBe("wsi-new");
    expect(byId.get(sNew.id)?.ordinal).toBe(1);
    expect(byId.get(sOld.id)?.ordinal).toBe(2); // renumbered on collision
    expect(memory()).toEqual({ "wsi-new": sNew.id });
  });

  it("moves the old slot when the target has none", () => {
    const sOld = create("wsi-old");
    useUIStore.getState().terminalSetActiveSession(sOld.id);
    useUIStore.getState().terminalSwitchScope("wsi-old", "wsi-elsewhere");

    useUIStore.getState().terminalRekeyScope("wsi-old", "wsi-new");

    expect(memory()).toEqual({ "wsi-new": sOld.id });
  });

  it("cap is unaffected: the merged scope can exceed it (creation gate only)", () => {
    for (let i = 0; i < 3; i++) create("wsi-new");
    for (let i = 0; i < 3; i++) create("wsi-old");
    useUIStore.getState().terminalRekeyScope("wsi-old", "wsi-new");
    expect(sessions()).toHaveLength(6);
    const ordinals = sessions().map((s) => s.ordinal);
    expect(new Set(ordinals).size).toBe(6); // in-scope uniqueness restored
  });
});

describe("terminalRealignActive (audit round 2, R2-15)", () => {
  it("keeps a still-visible active session untouched (idempotent)", () => {
    const a = create("wsi-a");
    useUIStore.getState().terminalSetActiveSession(a.id);
    const before = useUIStore.getState().terminal;

    useUIStore.getState().terminalRealignActive([a.id]);

    // No store wake for the no-op case.
    expect(useUIStore.getState().terminal).toBe(before);
    expect(activeId()).toBe(a.id);
  });

  it("moves a newly-HIDDEN active onto the first visible session, clearing its activity dot", () => {
    const a = create("wsi-a");
    const b = create("wsi-b");
    useUIStore.getState().terminalSetActiveSession(b.id);
    // Give the realign target a pending activity dot (D-T11: activation clears it).
    useUIStore.getState().terminalMarkActivity(a.id);

    useUIStore.getState().terminalRealignActive([a.id]);

    expect(activeId()).toBe(a.id);
    expect(sessions().find((s) => s.id === a.id)?.hasActivity).toBe(false);
    // The hidden session is untouched — hidden, not removed (D-T3).
    expect(sessions().some((s) => s.id === b.id)).toBe(true);
  });

  it("clears active to null when nothing is visible", () => {
    const a = create("wsi-a");
    useUIStore.getState().terminalSetActiveSession(a.id);

    useUIStore.getState().terminalRealignActive([]);

    expect(activeId()).toBeNull();
    expect(sessions().some((s) => s.id === a.id)).toBe(true);
  });

  it("a null active over an empty visible population stays a no-op", () => {
    create("wsi-a");
    useUIStore.getState().terminalRealignActive([]);
    const before = useUIStore.getState().terminal;
    expect(activeId()).toBeNull();

    useUIStore.getState().terminalRealignActive([]);

    expect(useUIStore.getState().terminal).toBe(before);
  });
});
