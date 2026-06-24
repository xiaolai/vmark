import { invoke } from "@tauri-apps/api/core";
import { isWorkspaceRailEnabled } from "@/services/featureFlags/workspaceRailFeatureFlag";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import type {
  WorkspaceActionOptions,
  WorkspaceOpener,
  WorkspaceTransferPayload,
  WorkspaceWindowActionResult,
  WorkspaceWindowOperation,
} from "@/types/workspaceTransfer";
import { generateUUID } from "@/utils/workspaceIdentity";
import { workspaceError } from "@/utils/debug";
import { collectWorkspaceTabs, type CollectedWorkspaceTabs } from "./workspaceTabCollection";
import { waitForWorkspaceAck } from "./workspaceTransferAck";

const DEFAULT_ACK_TIMEOUT_MS = 8_000;

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
    // Don't drop the rejection — a failed close should surface in logs rather
    // than become an unhandled promise rejection.
    void invoke("close_window", { label: windowLabel }).catch((error) => {
      workspaceError("Failed to close emptied source window:", error);
    });
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

  // The target's state is now applied (irreversible). The source still holds its
  // tabs until this ack reaches it, so a dropped ack would leave both windows
  // populated — a duplicate. Retry the ack so a transient emit/IPC failure can't
  // strand the move. The Rust command is idempotent (unknown/removed route is a
  // no-op), so retries are safe.
  await ackWorkspaceTransferWithRetry({
    requestId: payload.requestId,
    targetWindowLabel: windowLabel,
    workspaceInstanceId: payload.workspaceInstanceId,
  });
}

const ACK_RETRY_ATTEMPTS = 3;
const ACK_RETRY_DELAY_MS = 100;

/**
 * Send the transfer ack, retrying on transient failure so a dropped ack can't
 * strand a move (target populated, source uncleaned). The Rust command is
 * idempotent, so retrying after a partial success is harmless.
 */
async function ackWorkspaceTransferWithRetry(data: {
  requestId: string;
  targetWindowLabel: string;
  workspaceInstanceId: string;
}): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= ACK_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await invoke("ack_workspace_transfer", { data });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < ACK_RETRY_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, ACK_RETRY_DELAY_MS));
      }
    }
  }
  // Exhausted retries — surface for diagnosis. The source's ack timeout will
  // then drive its own recovery (cancel + keep tabs) instead of silently
  // duplicating.
  workspaceError("Failed to ack workspace transfer after retries:", lastError);
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

async function createWindowAndWaitForAck(
  payload: WorkspaceTransferPayload,
  timeoutMs = DEFAULT_ACK_TIMEOUT_MS,
): Promise<WorkspaceWindowActionResult> {
  let targetWindowLabel: string | undefined;
  try {
    const ack = waitForWorkspaceAck(payload.requestId, timeoutMs);
    targetWindowLabel = await invoke<string>("detach_workspace_to_new_window", { data: payload });
    const received = await ack;
    if (!received) {
      // Ack timed out — explicitly abandon the Rust-side transfer claim so a
      // late target `claim_workspace_transfer` can't still apply the payload
      // while the source keeps its tabs (which would duplicate the workspace).
      await cancelWorkspaceTransfer(targetWindowLabel);
      return { ok: false, reason: "timeout", targetWindowLabel };
    }
    return { ok: true, targetWindowLabel: received.targetWindowLabel };
  } catch {
    return { ok: false, reason: "invokeFailed", targetWindowLabel };
  }
}

/** Best-effort cancel of a pending transfer; failures are logged, not thrown. */
async function cancelWorkspaceTransfer(targetWindowLabel: string | undefined): Promise<void> {
  if (!targetWindowLabel) return;
  try {
    await invoke("cancel_workspace_transfer", { targetWindowLabel });
  } catch (error) {
    workspaceError("Failed to cancel timed-out workspace transfer:", error);
  }
}
