// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  selectWindowWorkspaceState,
  useWorkspaceInstancesStore,
} from "@/stores/workspaceInstancesStore";
import {
  openOrActivateWorkspaceInstance,
  resolveStableRootPath,
} from "./workspaceInstanceActions";
import { createWorkspaceInstance, createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";

function setRailMode(enabled: boolean): void {
  useSettingsStore.setState({
    general: { ...useSettingsStore.getState().general, workspaceRailMode: enabled },
  });
}

beforeEach(() => {
  setRailMode(false);
  useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
});

describe("openOrActivateWorkspaceInstance", () => {
  it("does nothing while workspace rail mode is disabled", () => {
    expect(
      openOrActivateWorkspaceInstance("/Users/xiaolai/project", {
        windowLabel: "main",
        workspaceInstanceId: "wsi-project",
      }),
    ).toBeNull();
    expect(selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "main")).toBeNull();
  });

  it("creates and activates an instance in the target window", () => {
    setRailMode(true);

    const instance = openOrActivateWorkspaceInstance("/Users/xiaolai/project", {
      windowLabel: "main",
      workspaceInstanceId: "wsi-project",
    });

    expect(instance).toMatchObject({
      workspaceInstanceId: "wsi-project",
      rootPath: "/Users/xiaolai/project",
      ownerWindowLabel: "main",
      createdFrom: "open",
    });
    expect(selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "main")).toMatchObject({
      workspaceInstanceIds: ["wsi-project"],
      activeWorkspaceInstanceId: "wsi-project",
    });
  });

  it("activates an existing same-root instance in the same window", () => {
    setRailMode(true);
    openOrActivateWorkspaceInstance("/Users/xiaolai/project", {
      windowLabel: "main",
      workspaceInstanceId: "wsi-first",
    });
    const second = openOrActivateWorkspaceInstance("/Users/xiaolai/project", {
      windowLabel: "main",
      workspaceInstanceId: "wsi-second",
    });

    expect(second?.workspaceInstanceId).toBe("wsi-first");
    expect(
      selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "main")
        ?.workspaceInstanceIds,
    ).toEqual(["wsi-first"]);
  });

  it("creates a local instance when the same root is open in another window", () => {
    setRailMode(true);
    openOrActivateWorkspaceInstance("/Users/xiaolai/project", {
      windowLabel: "main",
      workspaceInstanceId: "wsi-main",
    });
    openOrActivateWorkspaceInstance("/Users/xiaolai/project", {
      windowLabel: "doc-1",
      workspaceInstanceId: "wsi-doc",
      createdFrom: "duplicate",
    });

    expect(
      selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "main")
        ?.workspaceInstanceIds,
    ).toEqual(["wsi-main"]);
    expect(
      selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "doc-1")
        ?.workspaceInstanceIds,
    ).toEqual(["wsi-doc"]);
  });

  it("ignores empty root paths", () => {
    setRailMode(true);

    expect(openOrActivateWorkspaceInstance("", { windowLabel: "main" })).toBeNull();
    expect(selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "main")).toBeNull();
  });
});

// WI-17.2 — per-instance config I/O must address the instance's STORED root
// spelling, never a user-supplied variant (workspace.rs hashes the exact
// string, so c:\repo and C:\Repo would address different config files).
describe("resolveStableRootPath", () => {
  function addInstance(rootPath: string, platform: "macos" | "windows" | "linux"): void {
    const root = createWorkspaceRootIdentity(rootPath, { platform });
    if (!root.ok) throw new Error("test root should be valid");
    useWorkspaceInstancesStore.getState().addWorkspaceInstance(
      createWorkspaceInstance({
        workspaceInstanceId: `wsi-${rootPath}`,
        root: root.root,
        ownerWindowLabel: "main",
        createdFrom: "open",
      }),
    );
  }

  it("windows: returns the stored spelling for a same-identity variant", () => {
    setRailMode(true);
    addInstance("C:\\Repo", "windows");

    expect(resolveStableRootPath("main", "c:/repo", "windows")).toBe("C:\\Repo");
  });

  it("returns the input unchanged when no window instance matches", () => {
    setRailMode(true);
    addInstance("C:\\Repo", "windows");

    expect(resolveStableRootPath("main", "D:\\Other", "windows")).toBe("D:\\Other");
  });

  it("macos: alternate casing is a different identity — input unchanged", () => {
    setRailMode(true);
    addInstance("/Users/me/Repo", "macos");

    expect(resolveStableRootPath("main", "/users/me/repo", "macos")).toBe("/users/me/repo");
  });

  it("returns the input unchanged for an unknown window", () => {
    setRailMode(true);
    addInstance("C:\\Repo", "windows");

    expect(resolveStableRootPath("ghost", "c:/repo", "windows")).toBe("c:/repo");
  });
});
