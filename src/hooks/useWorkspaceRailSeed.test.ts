import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import {
  selectActiveWorkspaceInstance,
  useWorkspaceInstancesStore,
} from "@/stores/workspaceInstancesStore";
import { createWorkspaceInstance, createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";

const mockUseWindowLabel = vi.fn(() => "main");
const mockUseIsDocumentWindow = vi.fn(() => true);

vi.mock("@/contexts/WindowContext", () => ({
  useWindowLabel: () => mockUseWindowLabel(),
  useIsDocumentWindow: () => mockUseIsDocumentWindow(),
}));

const { useWorkspaceRailSeed } = await import("./useWorkspaceRailSeed");

function setRailMode(enabled: boolean): void {
  useSettingsStore.setState({
    general: {
      ...useSettingsStore.getState().general,
      workspaceRailMode: enabled,
    },
  });
}

function addWorkspaceInstance(id: string, rootPath: string): void {
  const root = createWorkspaceRootIdentity(rootPath);
  if (!root.ok) throw new Error("fixture root failed");
  useWorkspaceInstancesStore.getState().addWorkspaceInstance(createWorkspaceInstance({
    workspaceInstanceId: id,
    root: root.root,
    ownerWindowLabel: "main",
    createdFrom: "open",
  }));
}

beforeEach(() => {
  mockUseWindowLabel.mockReturnValue("main");
  mockUseIsDocumentWindow.mockReturnValue(true);
  setRailMode(false);
  useWorkspaceStore.setState({
    rootPath: null,
    isWorkspaceMode: false,
    config: null,
  });
  useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
});

describe("useWorkspaceRailSeed", () => {
  it("does nothing while workspace rail mode is disabled", async () => {
    useWorkspaceStore.setState({
      rootPath: "/repo",
      isWorkspaceMode: true,
    });

    renderHook(() => useWorkspaceRailSeed());
    await Promise.resolve();

    expect(useWorkspaceInstancesStore.getState().windows.main).toBeUndefined();
  });

  it("seeds the current workspace when rail mode is enabled after startup", async () => {
    setRailMode(true);
    useWorkspaceStore.setState({
      rootPath: "/repo",
      isWorkspaceMode: true,
    });

    renderHook(() => useWorkspaceRailSeed());

    await waitFor(() => {
      expect(useWorkspaceInstancesStore.getState().windows.main?.workspaceInstanceIds)
        .toHaveLength(1);
    });
    const active = selectActiveWorkspaceInstance(useWorkspaceInstancesStore.getState(), "main");
    expect(active).toMatchObject({
      rootPath: "/repo",
      displayName: "repo",
      ownerWindowLabel: "main",
      createdFrom: "restore",
    });
  });

  it("creates a visible placeholder when rail mode is enabled without a workspace", async () => {
    setRailMode(true);

    renderHook(() => useWorkspaceRailSeed());

    await waitFor(() => {
      expect(useWorkspaceInstancesStore.getState().windows.main?.workspaceInstanceIds)
        .toHaveLength(1);
    });
    const active = selectActiveWorkspaceInstance(useWorkspaceInstancesStore.getState(), "main");
    expect(active).toMatchObject({
      rootPath: null,
      displayName: "Untitled",
      createdFrom: "placeholder",
    });
  });

  it("does not reactivate the startup workspace after another instance is selected", async () => {
    setRailMode(true);
    useWorkspaceStore.setState({
      rootPath: "/repo",
      isWorkspaceMode: true,
    });

    renderHook(() => useWorkspaceRailSeed());

    await waitFor(() => {
      expect(selectActiveWorkspaceInstance(useWorkspaceInstancesStore.getState(), "main"))
        .toMatchObject({ rootPath: "/repo" });
    });

    act(() => {
      addWorkspaceInstance("wsi-other", "/other");
      useWorkspaceInstancesStore.getState().activateWorkspaceInstance("main", "wsi-other");
    });
    await Promise.resolve();

    expect(selectActiveWorkspaceInstance(useWorkspaceInstancesStore.getState(), "main"))
      .toMatchObject({ rootPath: "/other" });
  });

  it("does not seed settings or export windows", async () => {
    setRailMode(true);
    mockUseWindowLabel.mockReturnValue("settings");
    mockUseIsDocumentWindow.mockReturnValue(false);
    useWorkspaceStore.setState({
      rootPath: "/repo",
      isWorkspaceMode: true,
    });

    renderHook(() => useWorkspaceRailSeed());
    await Promise.resolve();

    expect(useWorkspaceInstancesStore.getState().windows.settings).toBeUndefined();
  });
});
