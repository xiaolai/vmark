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
import { instanceUiStateSchema, opaqueRecordSchema, schemaReason } from "./sessionSchema";
import { quarantineSessionEntries } from "./sessionQuarantine";
import type { QuarantinedEntry } from "./sessionSalvage";
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

/**
 * Restore the captured per-instance context after tab-id reconciliation.
 *
 * Returns whether every rejected fragment was PRESERVED. The caller must not
 * let the session file be cleared on `false` (audit 20260804-F12): this used
 * to fire the quarantine write and forget it, so a restore could report
 * success — and the session file be deleted — while the artifact write was
 * still in flight or had already failed. The rejected payloads then existed
 * nowhere, which is the one outcome quarantine exists to prevent.
 */
export async function restoreInstanceContextState(
  windowLabel: string,
  windowState: WindowState,
  tabIdMap: Map<string, string>,
): Promise<boolean> {
  const quarantined: QuarantinedEntry[] = [];

  if (windowState.ui_state_by_instance && isWorkspaceRailEnabled()) {
    // WI-3: Zod-validate each entry BEFORE the cast; a corrupt entry is
    // quarantined (preserved), never hydrated. Remap outline tab ids so
    // per-tab state follows the recreated tabs. Audit R2-F16: only THIS
    // window's instances may hydrate (payloads are untrusted — junk or
    // cross-window ids are dropped).
    const windowInstanceIds = new Set(
      orderedWindowInstances(windowLabel).map((i) => i.workspaceInstanceId),
    );
    const remapped: Record<string, InstanceUiState> = {};
    for (const [id, raw] of Object.entries(windowState.ui_state_by_instance)) {
      if (!windowInstanceIds.has(id)) continue;
      const parsed = instanceUiStateSchema.safeParse(raw);
      if (!parsed.success) {
        quarantined.push({
          path: `ui_state_by_instance.${id}`,
          raw,
          reason: schemaReason(parsed.error),
        });
        continue;
      }
      remapped[id] = remapOutlineTabIds(raw as InstanceUiState, tabIdMap);
    }
    useWorkspaceInstanceUiStore.getState().hydrateInstanceUiStates(remapped);
  }

  if (windowState.closed_tab_scopes && isWorkspaceRailEnabled()) {
    // WI-3: a wrong-typed payload is quarantined instead of hydrated.
    const scopes = opaqueRecordSchema.safeParse(windowState.closed_tab_scopes);
    if (scopes.success) {
      useClosedTabScopesStore
        .getState()
        .hydrateWindowClosedScopes(windowLabel, windowState.closed_tab_scopes);
    } else {
      quarantined.push({
        path: "closed_tab_scopes",
        raw: windowState.closed_tab_scopes,
        reason: schemaReason(scopes.error),
      });
    }
  }

  // AWAIT the artifact write, and report the outcome. Restore does block on it
  // — a few milliseconds of disk against the alternative of clearing the
  // session file while the only copy of the corrupt bytes is a pending
  // promise. The browser records below are unrelated and still restore either
  // way; only the CLEAR is withheld.
  const preserved =
    quarantined.length === 0 ? true : await quarantineSessionEntries(quarantined);

  if (windowState.browser_session) {
    // Same validation gate as the normal window session (canonical http(s)
    // URLs only; AI records dropped).
    const records = migratePersistedTabs(windowState.browser_session, null, {
      browserSupported: true,
    }).filter((rec): rec is PersistedBrowserTab => rec.kind === "browser");
    restoreBrowserRecords(windowLabel, records);
  }

  return preserved;
}
