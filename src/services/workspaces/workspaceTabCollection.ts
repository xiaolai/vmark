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
import { useTabStore, type DocumentTab } from "@/stores/tabStore";
import { collectTransferLineMetadata } from "@/utils/transferLineMetadata";
import {
  useWorkspaceInstancesStore,
  type WorkspaceInstanceRecord,
} from "@/stores/workspaceInstancesStore";
import type {
  WorkspaceTransferTabPayload,
  WorkspaceWindowOperation,
} from "@/types/workspaceTransfer";
import { orderedWindowInstances } from "./workspaceContextOwnership";
import { partitionWindowTabs } from "./workspaceOwnershipKernel";

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
  tab: DocumentTab,
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
export function serializeTransferTab(tab: DocumentTab, doc: TabDocument): WorkspaceTransferTabPayload {
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
    // Omitted when the tab states neither, matching the wire contract the line
    // metadata below already follows: on the wire, absent and "unknown" mean
    // the same thing, and omitting keeps payloads from older and newer builds
    // indistinguishable when there is nothing to say.
    ...(tab.editingEnabled !== undefined ? { editingEnabled: tab.editingEnabled } : {}),
    ...(tab.activeSchemaId !== undefined ? { activeSchemaId: tab.activeSchemaId } : {}),
    ...collectTransferLineMetadata(doc),
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

/**
 * True when `tab` belongs to `instance`.
 *
 * Explicit membership is resolved across ALL instances of the window first: a
 * tab another instance already claims belongs to that instance, even when path
 * classification would put it here (it can: a tab opened while workspace A was
 * active classifies into workspace B once B's root is opened in the same
 * window). Checking only `instance.tabIds` let two instances both collect the
 * same tab — the wrong workspace could then move or duplicate it, leaving the
 * real owner with a dangling tab id.
 *
 * Path classification decides only for tabs no instance has explicitly claimed.
 */
export function tabBelongsToWorkspace(
  tab: DocumentTab,
  instance: WorkspaceInstanceRecord,
  activeInstanceId: string | null,
): boolean {
  // Thin store-reading wrapper over the pure ownership kernel (WI-1R) — the
  // partition rule (explicit-claim-wins across all instances, then path
  // classification) lives in ONE place.
  const instances = orderedWindowInstances(instance.ownerWindowLabel);
  const { ownerOf } = partitionWindowTabs([tab], instances, activeInstanceId);
  return ownerOf.get(tab.id) === instance.workspaceInstanceId;
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
    // R1: browser tabs do not participate in workspace transfer — the payload
    // requires document content/dirty/saved state a browser tab has none of.
    if (tab.kind !== "document") continue;
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
