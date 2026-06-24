import { invoke } from "@tauri-apps/api/core";
import { isWorkspaceRailEnabled } from "@/services/featureFlags/workspaceRailFeatureFlag";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore, type Tab } from "@/stores/tabStore";
import {
  useWorkspaceInstancesStore,
  type WorkspaceInstanceRecord,
} from "@/stores/workspaceInstancesStore";
import type {
  WorkspaceActionOptions,
  WorkspaceOpener,
  WorkspaceTransferPayload,
  WorkspaceTransferTabPayload,
  WorkspaceWindowActionResult,
  WorkspaceWindowOperation,
} from "@/types/workspaceTransfer";
import { generateUUID } from "@/utils/workspaceIdentity";
import {
  classifyWorkspaceContextForTab,
  orderedWindowInstances,
} from "./workspaceContextOwnership";
import { waitForWorkspaceAck } from "./workspaceTransferAck";

const DEFAULT_ACK_TIMEOUT_MS = 8_000;

interface CollectedWorkspaceTabs {
  tabs: WorkspaceTransferTabPayload[];
  activeTabId: string | null;
  skippedDirtyCount: number;
  skippedUntitledCount: number;
  skippedMissingCount: number;
}

export async function moveWorkspaceInstanceToNewWindow(
  windowLabel: string,
  workspaceInstanceId: string,
  options: WorkspaceActionOptions = {},
): Promise<WorkspaceWindowActionResult> {
  const payload = buildWorkspacePayload(windowLabel, workspaceInstanceId, "move");
  if (!payload) return disabledOrMissingResult(workspaceInstanceId);

  const result = await createWindowAndWaitForAck(payload, options.timeoutMs);
  if (!result.ok) return result;

  for (const tab of payload.tabs) {
    useTabStore.getState().detachTab(windowLabel, tab.tabId);
    cleanupMovedTab(tab.tabId, options.cleanupTab);
  }
  const store = useWorkspaceInstancesStore.getState();
  store.removeWorkspaceInstance(windowLabel, workspaceInstanceId);
  if (windowLabel === "main") {
    store.ensurePlaceholderInstance("main", `wsi-placeholder-${generateUUID()}`);
  } else if (useWorkspaceInstancesStore.getState().windows[windowLabel]?.workspaceInstanceIds.length === 0) {
    void invoke("close_window", { label: windowLabel });
  }

  return result;
}

export async function duplicateWorkspaceInstanceToNewWindow(
  windowLabel: string,
  workspaceInstanceId: string,
  options: WorkspaceActionOptions = {},
): Promise<WorkspaceWindowActionResult> {
  const payload = buildWorkspacePayload(windowLabel, workspaceInstanceId, "duplicate");
  if (!payload) return disabledOrMissingResult(workspaceInstanceId);

  const result = await createWindowAndWaitForAck(payload, options.timeoutMs);
  if (!result.ok) return result;
  return {
    ...result,
    skippedDirtyCount: payload.skippedDirtyCount,
    skippedUntitledCount: payload.skippedUntitledCount,
    skippedMissingCount: payload.skippedMissingCount,
  };
}

export async function claimWorkspaceTransferForWindow(
  windowLabel: string,
  openWorkspace: WorkspaceOpener,
): Promise<boolean> {
  const urlParams = new URLSearchParams(globalThis.location?.search || "");
  if (!urlParams.has("workspaceTransfer")) return false;

  const payload = await invoke<WorkspaceTransferPayload | null>("claim_workspace_transfer", {
    windowLabel,
  });
  if (!payload) return false;

  await applyClaimedWorkspaceTransfer(windowLabel, payload, openWorkspace);
  return true;
}

export async function applyClaimedWorkspaceTransfer(
  windowLabel: string,
  payload: WorkspaceTransferPayload,
  openWorkspace: WorkspaceOpener,
): Promise<void> {
  if (payload.rootPath) {
    await openWorkspace(payload.rootPath, {
      windowLabel,
      workspaceInstanceId: payload.workspaceInstanceId,
      createdFrom: payload.operation === "duplicate" ? "duplicate" : "dragOut",
    });
  } else if (payload.kind === "loose") {
    useWorkspaceInstancesStore.getState().ensureLooseInstance(windowLabel, payload.workspaceInstanceId);
  } else {
    useWorkspaceInstancesStore.getState().ensurePlaceholderInstance(windowLabel, payload.workspaceInstanceId);
  }

  for (const tab of payload.tabs) {
    const tabId = useTabStore.getState().createTransferredTab(windowLabel, {
      id: tab.tabId,
      filePath: tab.filePath,
      title: tab.title,
      isPinned: tab.isPinned,
      formatId: tab.formatId,
      editingEnabled: tab.editingEnabled,
      activeSchemaId: tab.activeSchemaId,
    });
    useDocumentStore.getState().initDocument(
      tabId,
      tab.content,
      tab.filePath,
      tab.savedContent,
    );
    useDocumentStore.getState().setReadOnly(tabId, tab.readOnly);
  }

  if (payload.activeTabId) {
    useTabStore.getState().setActiveTab(windowLabel, payload.activeTabId);
  }

  await invoke("ack_workspace_transfer", {
    data: {
      requestId: payload.requestId,
      targetWindowLabel: windowLabel,
      workspaceInstanceId: payload.workspaceInstanceId,
    },
  });
}

function cleanupMovedTab(tabId: string, cleanupTab?: (tabId: string) => void): void {
  if (cleanupTab) {
    cleanupTab(tabId);
  } else {
    useDocumentStore.getState().removeDocument(tabId);
  }
}

function disabledOrMissingResult(workspaceInstanceId: string): WorkspaceWindowActionResult {
  if (!isWorkspaceRailEnabled()) return { ok: false, reason: "disabled" };
  return workspaceInstanceId
    ? { ok: false, reason: "missingInstance" }
    : { ok: false, reason: "disabled" };
}

function buildWorkspacePayload(
  windowLabel: string,
  workspaceInstanceId: string,
  operation: WorkspaceWindowOperation,
): (WorkspaceTransferPayload & Omit<CollectedWorkspaceTabs, "tabs" | "activeTabId">) | null {
  if (!isWorkspaceRailEnabled()) return null;
  const store = useWorkspaceInstancesStore.getState();
  const instance = store.instances[workspaceInstanceId];
  const windowState = store.windows[windowLabel];
  if (!instance || !windowState?.workspaceInstanceIds.includes(workspaceInstanceId)) return null;

  const collection = collectWorkspaceTabs(windowLabel, instance, operation);
  return {
    requestId: `wst-${generateUUID()}`,
    operation,
    sourceWindowLabel: windowLabel,
    workspaceInstanceId: operation === "duplicate" ? `wsi-${generateUUID()}` : workspaceInstanceId,
    kind: instance.kind,
    rootId: instance.rootId,
    rootPath: instance.rootPath,
    displayName: instance.displayName,
    activeTabId: collection.activeTabId,
    tabs: collection.tabs,
    skippedDirtyCount: collection.skippedDirtyCount,
    skippedUntitledCount: collection.skippedUntitledCount,
    skippedMissingCount: collection.skippedMissingCount,
  };
}

function collectWorkspaceTabs(
  windowLabel: string,
  instance: WorkspaceInstanceRecord,
  operation: WorkspaceWindowOperation,
): CollectedWorkspaceTabs {
  const tabs = useTabStore.getState().getTabsByWindow(windowLabel);
  const activeTabId = useTabStore.getState().activeTabId[windowLabel] ?? null;
  const activeInstanceId =
    useWorkspaceInstancesStore.getState().windows[windowLabel]?.activeWorkspaceInstanceId ?? null;
  const documents = useDocumentStore.getState();
  const collected: WorkspaceTransferTabPayload[] = [];
  let skippedDirtyCount = 0;
  let skippedUntitledCount = 0;
  let skippedMissingCount = 0;

  for (const tab of tabs) {
    if (!tabBelongsToWorkspace(tab, instance, activeInstanceId)) continue;
    const doc = documents.getDocument(tab.id);
    if (!doc) continue;

    if (operation === "duplicate") {
      if (!tab.filePath) {
        skippedUntitledCount += 1;
        continue;
      }
      if (doc.isMissing) {
        skippedMissingCount += 1;
        continue;
      }
      if (doc.isDirty) {
        skippedDirtyCount += 1;
        continue;
      }
    }

    collected.push({
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
    });
  }

  return {
    tabs: collected,
    activeTabId: collected.some((tab) => tab.tabId === activeTabId) ? activeTabId : collected[0]?.tabId ?? null,
    skippedDirtyCount,
    skippedUntitledCount,
    skippedMissingCount,
  };
}

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

async function createWindowAndWaitForAck(
  payload: WorkspaceTransferPayload,
  timeoutMs = DEFAULT_ACK_TIMEOUT_MS,
): Promise<WorkspaceWindowActionResult> {
  let targetWindowLabel: string | undefined;
  try {
    const ack = waitForWorkspaceAck(payload.requestId, timeoutMs);
    targetWindowLabel = await invoke<string>("detach_workspace_to_new_window", { data: payload });
    const received = await ack;
    if (!received) return { ok: false, reason: "timeout", targetWindowLabel };
    return { ok: true, targetWindowLabel: received.targetWindowLabel };
  } catch {
    return { ok: false, reason: "invokeFailed", targetWindowLabel };
  }
}
