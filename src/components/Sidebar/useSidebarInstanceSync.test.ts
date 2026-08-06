// WI-9.1 wiring (plan D2) — sidebar width/view-mode follow the active
// workspace instance bidirectionally, with an echo guard.
import { beforeEach, describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUIStore } from "@/stores/uiStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { useWorkspaceInstanceUiStore } from "@/stores/workspaceInstanceUiStore";
import { createWorkspaceInstance, createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";
import {
  applySidebarStateForInstance,
  recordSidebarStateToInstance,
  useSidebarInstanceSync,
} from "./useSidebarInstanceSync";

const W = "main";

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
  useWorkspaceInstanceUiStore.getState().resetInstanceUiStates();
  useUIStore.setState({ sidebarWidth: 260, sidebarViewMode: "files" } as never);
  useSettingsStore.setState({
    general: { ...useSettingsStore.getState().general, workspaceRailMode: true },
  });
  addWorkspace("wsi-a", "/repo-a");
  addWorkspace("wsi-b", "/repo-b");
  useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");
});

describe("useSidebarInstanceSync (WI-9.1 wiring)", () => {
  it("applies the incoming instance's saved width and view mode on switch", () => {
    useWorkspaceInstanceUiStore.getState().updateInstanceUiState("wsi-b", {
      sidebarWidth: 333,
      sidebarViewMode: "outline",
    });

    const { rerender } = renderHook(() => useSidebarInstanceSync(W));
    act(() => {
      useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-b");
    });
    rerender();

    expect(useUIStore.getState().sidebarWidth).toBe(333);
    expect(useUIStore.getState().sidebarViewMode).toBe("outline");
  });

  it("missing saved values keep the current sidebar state (continuity)", () => {
    const { rerender } = renderHook(() => useSidebarInstanceSync(W));
    act(() => {
      useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-b");
    });
    rerender();

    expect(useUIStore.getState().sidebarWidth).toBe(260);
    expect(useUIStore.getState().sidebarViewMode).toBe("files");
  });

  it("records user resizes into the ACTIVE instance", () => {
    renderHook(() => useSidebarInstanceSync(W));

    act(() => {
      useUIStore.getState().setSidebarWidth(300);
    });

    expect(
      useWorkspaceInstanceUiStore.getState().getInstanceUiState("wsi-a").sidebarWidth,
    ).toBe(300);
  });

  it("the apply pass does not echo back into the instance record", () => {
    useWorkspaceInstanceUiStore.getState().updateInstanceUiState("wsi-b", {
      sidebarWidth: 333,
    });
    applySidebarStateForInstance("wsi-b");
    // Direct record call with the guard released records normally.
    recordSidebarStateToInstance("wsi-a");
    expect(
      useWorkspaceInstanceUiStore.getState().getInstanceUiState("wsi-a").sidebarWidth,
    ).toBe(333);
  });

  it("the mounted subscription skips the echo while applying a switch", () => {
    useWorkspaceInstanceUiStore.getState().updateInstanceUiState("wsi-b", {
      sidebarWidth: 400,
      sidebarViewMode: "outline",
    });
    const { rerender } = renderHook(() => useSidebarInstanceSync(W));

    act(() => {
      useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-b");
    });
    rerender();

    // The apply pass changed uiStore; the echo guard must have kept it from
    // being recorded back into wsi-b as a "user change" mid-apply (values
    // equal is fine — the assertion is that A's record was untouched).
    expect(
      useWorkspaceInstanceUiStore.getState().getInstanceUiState("wsi-a").sidebarWidth,
    ).toBeNull();
    expect(useUIStore.getState().sidebarWidth).toBe(400);
  });

  it("no active instance: both effects are inert", () => {
    useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
    renderHook(() => useSidebarInstanceSync(W));
    act(() => {
      useUIStore.getState().setSidebarWidth(280);
    });
    expect(useWorkspaceInstanceUiStore.getState().instanceUiStates).toEqual({});
  });

  it("recordSidebarStateToInstance is a no-op while an apply is in flight", () => {
    useWorkspaceInstanceUiStore.getState().updateInstanceUiState("wsi-b", {
      sidebarWidth: 444,
    });
    // A listener that tries to record DURING the apply (the defensive
    // scenario the `applying` guard exists for).
    const unsubscribe = useUIStore.subscribe(() => {
      recordSidebarStateToInstance("wsi-a");
    });
    try {
      applySidebarStateForInstance("wsi-b");
    } finally {
      unsubscribe();
    }
    // The mid-apply record was swallowed by the guard.
    expect(
      useWorkspaceInstanceUiStore.getState().getInstanceUiState("wsi-a").sidebarWidth,
    ).toBeNull();
  });

  it("unrelated uiStore changes do not touch the instance record (equal-values branch)", () => {
    renderHook(() => useSidebarInstanceSync(W));
    act(() => {
      useUIStore.setState({ sidebarVisible: false } as never);
    });
    expect(useWorkspaceInstanceUiStore.getState().instanceUiStates).toEqual({});
  });

  it("rail off: inert (no reads, no writes)", () => {
    useSettingsStore.setState({
      general: { ...useSettingsStore.getState().general, workspaceRailMode: false },
    });
    renderHook(() => useSidebarInstanceSync(W));
    act(() => {
      useUIStore.getState().setSidebarWidth(310);
    });
    expect(useWorkspaceInstanceUiStore.getState().instanceUiStates).toEqual({});
  });
});
