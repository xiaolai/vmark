/**
 * Per-instance sidebar width/view-mode sync (WI-9.1 wiring / plan D2).
 *
 * Purpose: `workspaceInstanceUiStore` stores `sidebarWidth` and
 * `sidebarViewMode` per workspace instance; the live sidebar reads the
 * window-global `uiStore`. This hook keeps the two in sync while the rail is
 * on:
 *   - active-instance CHANGE → apply the incoming instance's saved values to
 *     `uiStore` (missing values keep the current ones — continuity);
 *   - user CHANGE (resize, view-mode cycle) → record into the active
 *     instance's UI state.
 *
 * An `applying` flag prevents the apply→record echo. Rail off: inert —
 * byte-identical pre-rail behavior.
 *
 * @coordinates-with stores/workspaceInstanceUiStore.ts — per-instance state
 * @coordinates-with stores/uiStore.ts — the live sidebar state
 * @coordinates-with Sidebar.tsx — mounts this hook
 * @module components/Sidebar/useSidebarInstanceSync
 */
import { useEffect } from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUIStore } from "@/stores/uiStore";
import {
  selectActiveWorkspaceInstance,
  useWorkspaceInstancesStore,
} from "@/stores/workspaceInstancesStore";
import { useWorkspaceInstanceUiStore } from "@/stores/workspaceInstanceUiStore";

type SidebarViewMode = ReturnType<typeof useUIStore.getState>["sidebarViewMode"];

let applying = false;

/** Apply an instance's saved sidebar state to the live uiStore. */
export function applySidebarStateForInstance(instanceId: string): void {
  const saved = useWorkspaceInstanceUiStore.getState().getInstanceUiState(instanceId);
  applying = true;
  try {
    if (saved.sidebarWidth !== null) {
      useUIStore.getState().setSidebarWidth(saved.sidebarWidth);
    }
    if (saved.sidebarViewMode !== null) {
      useUIStore.getState().setSidebarViewMode(saved.sidebarViewMode as SidebarViewMode);
    }
  } finally {
    applying = false;
  }
}

/** Record the live sidebar state into the active instance (echo-guarded). */
export function recordSidebarStateToInstance(instanceId: string): void {
  if (applying) return;
  const ui = useUIStore.getState();
  useWorkspaceInstanceUiStore.getState().updateInstanceUiState(instanceId, {
    sidebarWidth: ui.sidebarWidth,
    sidebarViewMode: ui.sidebarViewMode,
  });
}

/** Mount once (Sidebar): bidirectional per-instance sidebar sync. */
export function useSidebarInstanceSync(windowLabel: string): void {
  const railEnabled = useSettingsStore((s) => s.general?.workspaceRailMode ?? false);
  const activeInstanceId = useWorkspaceInstancesStore(
    (s) => selectActiveWorkspaceInstance(s, windowLabel)?.workspaceInstanceId ?? null,
  );

  // Incoming switch: apply the instance's saved sidebar state.
  useEffect(() => {
    if (!railEnabled || !activeInstanceId) return;
    applySidebarStateForInstance(activeInstanceId);
  }, [railEnabled, activeInstanceId]);

  // User changes: record into the active instance.
  useEffect(() => {
    if (!railEnabled || !activeInstanceId) return;
    let prevWidth = useUIStore.getState().sidebarWidth;
    let prevMode = useUIStore.getState().sidebarViewMode;
    return useUIStore.subscribe((state) => {
      if (state.sidebarWidth === prevWidth && state.sidebarViewMode === prevMode) return;
      prevWidth = state.sidebarWidth;
      prevMode = state.sidebarViewMode;
      recordSidebarStateToInstance(activeInstanceId);
    });
  }, [railEnabled, activeInstanceId]);
}
