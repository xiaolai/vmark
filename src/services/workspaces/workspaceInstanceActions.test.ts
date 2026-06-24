import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  selectWindowWorkspaceState,
  useWorkspaceInstancesStore,
} from "@/stores/workspaceInstancesStore";
import { openOrActivateWorkspaceInstance } from "./workspaceInstanceActions";

function setRailMode(enabled: boolean): void {
  useSettingsStore.setState({
    advanced: { ...useSettingsStore.getState().advanced, workspaceRailMode: enabled },
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
