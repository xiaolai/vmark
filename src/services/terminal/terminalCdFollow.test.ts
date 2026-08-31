// @vitest-environment node
// WI-TS2.1 / audit 20260831 R2-3 — THE cd-follow predicate. The unknown-id
// branch is the load-bearing one: a pendingRoot can flush AFTER its session
// was removed, and writing a cd into a dying shell is wrong in EITHER rail
// mode (#16 — the rail-off early return used to say yes). Real stores.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";
import { resetTerminalSessionStore, useUIStore } from "@/stores/uiStore";
import { shouldFollowWorkspaceCd } from "./terminalCdFollow";

function setRail(enabled: boolean): void {
  useSettingsStore.setState({
    general: { ...useSettingsStore.getState().general, workspaceRailMode: enabled },
  });
}

function createSession(owner?: string): string {
  const created = useUIStore
    .getState()
    .terminalCreateSession(owner ? { ownerInstanceId: owner } : undefined);
  if (!created) throw new Error("cap hit in test setup");
  return created.id;
}

beforeEach(() => {
  resetTerminalSessionStore();
});

afterEach(() => {
  setRail(false);
});

describe("shouldFollowWorkspaceCd", () => {
  it.each([true, false])(
    "unknown session id never follows (rail %s) — mid-teardown guard",
    (rail) => {
      setRail(rail);
      expect(shouldFollowWorkspaceCd("term-gone")).toBe(false);
    },
  );

  it("rail on: a window-scoped session follows", () => {
    setRail(true);
    expect(shouldFollowWorkspaceCd(createSession())).toBe(true);
  });

  it("rail on: an owner-stamped session keeps its own cwd", () => {
    setRail(true);
    expect(shouldFollowWorkspaceCd(createSession("wsi-a"))).toBe(false);
  });

  it("rail off: every EXISTING session follows — stamps are inert (D-T15)", () => {
    setRail(false);
    expect(shouldFollowWorkspaceCd(createSession())).toBe(true);
    expect(shouldFollowWorkspaceCd(createSession("wsi-a"))).toBe(true);
  });

  it("resolves the owner at CHECK time, not capture time", () => {
    setRail(true);
    const id = createSession();
    expect(shouldFollowWorkspaceCd(id)).toBe(true);
    // Adoption stamps the session after the pendingRoot was recorded —
    // the flush must now refuse.
    useUIStore.getState().terminalAdoptUnscopedSessions("wsi-a");
    expect(shouldFollowWorkspaceCd(id)).toBe(false);
  });
});
