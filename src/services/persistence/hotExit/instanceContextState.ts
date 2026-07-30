/**
 * Hot-exit capture/restore of per-instance context state (WI-9.4).
 *
 * Three additive, OPTIONAL WindowState fields (Rust passes them through as
 * opaque JSON; old payloads simply lack them):
 *   - `ui_state_by_instance` — workspaceInstanceUiStore slice for this
 *     window's instances (sidebar, file-tree, outline state). Outline state
 *     is keyed by tab id, so restore REMAPS keys through the hot-exit
 *     tab-id map and drops entries whose tab did not recreate.
 *   - `closed_tab_scopes` — the scoped reopen history WITH metadata, restored
 *     verbatim (closed tabs never recreate, so their historical ids remain
 *     valid reopen identifiers).
 *   - `browser_session` — window-global human browser records (WI-8.2 schema,
 *     same validation gate), recreated in the background.
 *
 * Restore runs AFTER `reconcileRestoredWindowWorkspaceInstances` (tab ids
 * remapped) and BEFORE the final context hydrate (WI-13.2 ordering).
 *
 * @coordinates-with hooks/resilience/_hotExitCapture.ts — capture site
 * @coordinates-with services/persistence/resilience/_hotExitRestore.ts — restore site
 * @module services/persistence/hotExit/instanceContextState
 */
import { useWorkspaceInstanceUiStore, type InstanceUiState } from "@/stores/workspaceInstanceUiStore";
import { useClosedTabScopesStore } from "@/stores/tabStoreClosedScopes";
import { useTabStore } from "@/stores/tabStore";
import { isWorkspaceRailEnabled } from "@/services/featureFlags/workspaceRailFeatureFlag";
import {
  browserSessionRecordsOf,
  restoreBrowserRecords,
} from "@/services/persistence/windowBrowserSession";
import {
  migratePersistedTabs,
  type PersistedBrowserTab,
} from "@/services/persistence/sessionTabs";
import { orderedWindowInstances } from "@/services/workspaces/workspaceContextOwnership";
import type { WindowState } from "./types";

export interface InstanceContextCapture {
  ui_state_by_instance?: Record<string, unknown>;
  closed_tab_scopes?: Record<string, unknown>;
  browser_session?: unknown;
}

/** Capture the window's per-instance context for the hot-exit payload. */
export function captureInstanceContextState(windowLabel: string): InstanceContextCapture {
  const capture: InstanceContextCapture = {};

  const browserRecords = browserSessionRecordsOf(
    useTabStore.getState().getTabsByWindow(windowLabel),
  );
  if (browserRecords.length > 0) {
    capture.browser_session = { version: 1, tabs: browserRecords };
  }

  if (!isWorkspaceRailEnabled()) return capture;

  const instanceIds = orderedWindowInstances(windowLabel).map(
    (instance) => instance.workspaceInstanceId,
  );
  const uiStates = useWorkspaceInstanceUiStore.getState().instanceUiStates;
  const uiSlice: Record<string, unknown> = {};
  for (const id of instanceIds) {
    if (uiStates[id]) uiSlice[id] = uiStates[id];
  }
  if (Object.keys(uiSlice).length > 0) capture.ui_state_by_instance = uiSlice;

  const scopes = useClosedTabScopesStore.getState().scopesByWindow[windowLabel];
  if (scopes && Object.keys(scopes).length > 0) {
    capture.closed_tab_scopes = scopes as unknown as Record<string, unknown>;
  }

  return capture;
}

/** Remap an outline-by-tab map's keys through the hot-exit tab-id map. */
function remapOutlineTabIds(
  ui: InstanceUiState,
  tabIdMap: Map<string, string>,
): InstanceUiState {
  const remapped: InstanceUiState["outlineByTabId"] = {};
  for (const [oldId, outline] of Object.entries(ui.outlineByTabId)) {
    const newId = tabIdMap.get(oldId);
    if (newId) remapped[newId] = outline;
  }
  return { ...ui, outlineByTabId: remapped };
}

/** Restore the captured per-instance context after tab-id reconciliation. */
export function restoreInstanceContextState(
  windowLabel: string,
  windowState: WindowState,
  tabIdMap: Map<string, string>,
): void {
  if (windowState.ui_state_by_instance && isWorkspaceRailEnabled()) {
    // The UI store's hydrate guard drops malformed entries; remap outline
    // tab ids first so per-tab state follows the recreated tabs. Audit
    // R2-F16: only THIS window's instances may hydrate (payloads are
    // untrusted — junk or cross-window ids are dropped).
    const windowInstanceIds = new Set(
      orderedWindowInstances(windowLabel).map((i) => i.workspaceInstanceId),
    );
    const remapped: Record<string, InstanceUiState> = {};
    for (const [id, raw] of Object.entries(windowState.ui_state_by_instance)) {
      if (!windowInstanceIds.has(id)) continue;
      const ui = raw as InstanceUiState;
      remapped[id] =
        ui && typeof ui === "object" && ui.outlineByTabId
          ? remapOutlineTabIds(ui, tabIdMap)
          : (ui as InstanceUiState);
    }
    useWorkspaceInstanceUiStore.getState().hydrateInstanceUiStates(remapped);
  }

  if (windowState.closed_tab_scopes && isWorkspaceRailEnabled()) {
    useClosedTabScopesStore
      .getState()
      .hydrateWindowClosedScopes(windowLabel, windowState.closed_tab_scopes);
  }

  if (windowState.browser_session) {
    // Same validation gate as the normal window session (canonical http(s)
    // URLs only; AI records dropped).
    const records = migratePersistedTabs(windowState.browser_session, null, {
      browserSupported: true,
    }).filter((rec): rec is PersistedBrowserTab => rec.kind === "browser");
    restoreBrowserRecords(windowLabel, records);
  }
}
