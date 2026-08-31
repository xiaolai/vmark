// @vitest-environment node
// WI-TS1.1 — the ONE owner-stamping rule and its three carve-outs (D-T1):
// placeholder, mid-restore, rail-off. Real stores; nothing terminal-side mocked.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import {
  createWorkspaceInstance,
  createWorkspaceRootIdentity,
} from "@/utils/workspaceIdentity";
import {
  beginWindowContextRestore,
  endWindowContextRestore,
} from "@/services/workspaces/switchWorkspaceInstance";
import { resolveTerminalOwnerInstanceId } from "./resolveTerminalOwnerInstanceId";

const W = "main";

function setRail(enabled: boolean): void {
  useSettingsStore.setState({
    general: { ...useSettingsStore.getState().general, workspaceRailMode: enabled },
  });
}

function addWorkspace(id: string, rootPath: string): void {
  const root = createWorkspaceRootIdentity(rootPath, { platform: "macos" });
  if (!root.ok) throw new Error("bad test root");
  useWorkspaceInstancesStore.getState().addWorkspaceInstance(
    createWorkspaceInstance({
      workspaceInstanceId: id,
      root: root.root,
      ownerWindowLabel: W,
      createdFrom: "open",
    }),
  );
}

beforeEach(() => {
  useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
  useWorkspaceStore.getState().closeWorkspace();
  setRail(true);
});

afterEach(() => {
  endWindowContextRestore(W);
  setRail(false);
});

describe("resolveTerminalOwnerInstanceId (D-T1)", () => {
  it("returns the active workspace instance's id in the ordinary case", () => {
    addWorkspace("wsi-a", "/repo-a");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");
    expect(resolveTerminalOwnerInstanceId(W)).toBe("wsi-a");
  });

  it("returns a LOOSE instance's id — loose is a real owner (D-T6 rekey merges follow it)", () => {
    const loose = useWorkspaceInstancesStore.getState().ensureLooseInstance(W);
    expect(resolveTerminalOwnerInstanceId(W)).toBe(loose.workspaceInstanceId);
  });

  it("carve-out 1: never stamps a placeholder instance's id", () => {
    useWorkspaceInstancesStore
      .getState()
      .ensurePlaceholderInstance(W, "wsi-placeholder-1");
    expect(resolveTerminalOwnerInstanceId(W)).toBeUndefined();
  });

  it("carve-out 2: never stamps while the window's restore is in flight", () => {
    addWorkspace("wsi-a", "/repo-a");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");

    beginWindowContextRestore(W);
    expect(resolveTerminalOwnerInstanceId(W)).toBeUndefined();

    endWindowContextRestore(W);
    expect(resolveTerminalOwnerInstanceId(W)).toBe("wsi-a");
  });

  it("carve-out 3: never stamps while the rail is off", () => {
    addWorkspace("wsi-a", "/repo-a");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");
    setRail(false);
    expect(resolveTerminalOwnerInstanceId(W)).toBeUndefined();
  });

  it("returns undefined on the legacy fallback (rail on, no active instance)", () => {
    expect(resolveTerminalOwnerInstanceId(W)).toBeUndefined();
  });
});
