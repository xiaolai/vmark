/**
 * workspaceTabCollection — gather the tabs that belong to a workspace instance
 * into a transfer payload.
 *
 * Split out of workspaceWindowActions so the high-branching collection path
 * (ownership filtering, duplicate eligibility, tab serialization, active-tab
 * resolution) lives in focused, directly testable helpers.
 *
 * @module services/workspaces/workspaceTabCollection
 */

import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore, type Tab } from "@/stores/tabStore";
import {
  useWorkspaceInstancesStore,
  type WorkspaceInstanceRecord,
} from "@/stores/workspaceInstancesStore";
import type {
  WorkspaceTransferTabPayload,
  WorkspaceWindowOperation,
} from "@/types/workspaceTransfer";
import {
  classifyWorkspaceContextForTab,
  orderedWindowInstances,
} from "./workspaceContextOwnership";

export interface CollectedWorkspaceTabs {
  tabs: WorkspaceTransferTabPayload[];
  activeTabId: string | null;
  skippedDirtyCount: number;
  skippedUntitledCount: number;
  skippedMissingCount: number;
}

/** Per-tab document, used by serialization/eligibility helpers. */
type TabDocument = NonNullable<ReturnType<ReturnType<typeof useDocumentStore.getState>["getDocument"]>>;

/** Why a tab was skipped during a duplicate, or null if it is eligible. */
export type DuplicateSkipReason = "untitled" | "missing" | "dirty" | null;

/**
 * Decide whether a tab is eligible to be duplicated. Move always copies; only
 * duplicate filters out untitled / missing / dirty tabs.
 */
export function classifyDuplicateEligibility(
  tab: Tab,
  doc: TabDocument,
  operation: WorkspaceWindowOperation,
): DuplicateSkipReason {
  if (operation !== "duplicate") return null;
  if (!tab.filePath) return "untitled";
  if (doc.isMissing) return "missing";
  if (doc.isDirty) return "dirty";
  return null;
}

/** Serialize a tab + its document into the transfer payload shape. */
export function serializeTransferTab(tab: Tab, doc: TabDocument): WorkspaceTransferTabPayload {
  return {
    tabId: tab.id,
    title: tab.title,
    filePath: tab.filePath,
    content: doc.content,
    savedContent: doc.savedContent,
    isDirty: doc.isDirty,
    readOnly: doc.readOnly,
    isPinned: tab.isPinned,
    formatId: tab.formatId,
    editingEnabled: tab.editingEnabled,
    activeSchemaId: tab.activeSchemaId,
  };
}

/** Pick the transferred active tab: keep the window's active tab if it moved, else the first. */
export function resolveTransferActiveTab(
  collected: WorkspaceTransferTabPayload[],
  windowActiveTabId: string | null,
): string | null {
  if (collected.some((tab) => tab.tabId === windowActiveTabId)) return windowActiveTabId;
  return collected[0]?.tabId ?? null;
}

/** True when `tab` belongs to `instance` — by explicit membership or root classification. */
function tabBelongsToWorkspace(
  tab: Tab,
  instance: WorkspaceInstanceRecord,
  activeInstanceId: string | null,
): boolean {
  if (instance.tabIds.includes(tab.id)) return true;
  const owner = classifyWorkspaceContextForTab({
    filePath: tab.filePath,
    instances: orderedWindowInstances(instance.ownerWindowLabel),
    activeWorkspaceInstanceId: activeInstanceId,
  });
  return owner?.workspaceInstanceId === instance.workspaceInstanceId;
}

/** Collect every tab owned by `instance` in `windowLabel` into a transfer payload. */
export function collectWorkspaceTabs(
  windowLabel: string,
  instance: WorkspaceInstanceRecord,
  operation: WorkspaceWindowOperation,
): CollectedWorkspaceTabs {
  const tabs = useTabStore.getState().getTabsByWindow(windowLabel);
  const windowActiveTabId = useTabStore.getState().activeTabId[windowLabel] ?? null;
  const activeInstanceId =
    useWorkspaceInstancesStore.getState().windows[windowLabel]?.activeWorkspaceInstanceId ?? null;
  const documents = useDocumentStore.getState();
  const collected: WorkspaceTransferTabPayload[] = [];
  const skipped: Record<NonNullable<DuplicateSkipReason>, number> = {
    untitled: 0,
    missing: 0,
    dirty: 0,
  };

  for (const tab of tabs) {
    if (!tabBelongsToWorkspace(tab, instance, activeInstanceId)) continue;
    const doc = documents.getDocument(tab.id);
    if (!doc) continue;

    const skipReason = classifyDuplicateEligibility(tab, doc, operation);
    if (skipReason) {
      skipped[skipReason] += 1;
      continue;
    }

    collected.push(serializeTransferTab(tab, doc));
  }

  return {
    tabs: collected,
    activeTabId: resolveTransferActiveTab(collected, windowActiveTabId),
    skippedDirtyCount: skipped.dirty,
    skippedUntitledCount: skipped.untitled,
    skippedMissingCount: skipped.missing,
  };
}
