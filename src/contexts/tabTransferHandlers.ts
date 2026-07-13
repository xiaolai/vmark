/**
 * tabTransferHandlers
 *
 * Purpose: Receiving-side logic for cross-window tab transfers — applying a tab
 * handed over by another window, and answering that window's removal handshake
 * when the user undoes the move.
 *
 * Pipeline (undo of a move, this window is the destination):
 *   source Undo → Rust emits `tab:remove-by-id` {phase: "prepare"} →
 *   handleTabRemovalRequest reports this window's LIVE tab state via
 *   `tab:remove-ack` (removing nothing) → source restores from that state →
 *   Rust emits {phase: "commit"} → handleTabRemovalRequest removes the tab.
 *
 * Key decisions:
 *   - `prepare` is side-effect free. The source's pre-transfer snapshot is stale
 *     the moment the user edits here, so undo must restore what this window
 *     actually holds — and it can only do that if nothing is destroyed first.
 *   - Every request is acknowledged, including refusals (`accepted: false`), so
 *     the source can fail the undo and leave this window's tab intact instead of
 *     hanging or guessing.
 *   - `commit` acks BEFORE the emptied window closes itself; the source is
 *     blocked on that ack.
 *   - `commit` is idempotent — removing an already-absent tab still acks.
 *
 * @coordinates-with tab_transfer.rs — owns the handshake, routes the acks
 * @coordinates-with tabTransferActions.ts — the source side of the handshake
 * @coordinates-with WindowContext.tsx — registers the listeners that call in here
 * @module contexts/tabTransferHandlers
 */
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { openWorkspaceWithConfig } from "@/hooks/openWorkspaceWithConfig";
import { cleanupTabState } from "@/hooks/tabCleanup";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useRecentFilesStore, useWorkspaceStore } from "@/stores/workspaceStore";
import type {
  TabRemovalAck,
  TabRemovalRequestEvent,
  TabTransferPayload,
} from "@/types/tabTransfer";
import { windowCloseWarn } from "@/utils/debug";
import { errorMessage } from "@/utils/errorMessage";
import { resolveWorkspaceRootForExternalFile } from "@/utils/openPolicy";

const REMOVE_ACK_EVENT = "tab:remove-ack";

/** Materialize a tab handed over by another window. */
export async function applyTabTransferData(
  label: string,
  data: TabTransferPayload,
): Promise<void> {
  // Set up workspace: prefer transferred root, fall back to file's parent
  const workspaceRoot =
    data.workspaceRoot ??
    (data.filePath ? resolveWorkspaceRootForExternalFile(data.filePath) : null);
  if (workspaceRoot) {
    try {
      await openWorkspaceWithConfig(workspaceRoot, { windowLabel: label });
    } catch {
      // Non-fatal — proceed without workspace
    }
  }

  const tabId = useTabStore.getState().createTransferredTab(label, {
    id: data.tabId,
    filePath: data.filePath,
    title: data.title,
    isPinned: false,
  });
  useTabStore.getState().updateTabTitle(tabId, data.title);
  useDocumentStore.getState().initDocument(tabId, data.content, data.filePath, data.savedContent);
  if (data.filePath) {
    useRecentFilesStore.getState().addFile(data.filePath);
  }
}

/**
 * Claim transfer data from Rust and create the tab + document.
 * Returns true if a transfer was handled (caller should skip normal init).
 */
export async function handleTabTransfer(label: string): Promise<boolean> {
  const urlParams = new URLSearchParams(globalThis.location?.search || "");
  if (!urlParams.has("transfer")) return false;

  const data = await invoke<TabTransferPayload | null>("claim_tab_transfer", {
    windowLabel: label,
  });
  if (!data) return false;
  await applyTabTransferData(label, data);

  return true;
}

/** This window's live state for `tabId`, or null if it cannot honor the request. */
function collectLiveTabState(
  label: string,
  tabId: string,
): { data: TabTransferPayload } | { reason: string } {
  const tab = useTabStore
    .getState()
    .getTabsByWindow(label)
    .find((entry) => entry.id === tabId);
  if (!tab || tab.kind !== "document") return { reason: "tabNotFound" };

  const doc = useDocumentStore.getState().getDocument(tabId);
  if (!doc) return { reason: "documentNotFound" };

  return {
    data: {
      tabId: tab.id,
      title: tab.title,
      filePath: tab.filePath ?? null,
      content: doc.content,
      savedContent: doc.savedContent,
      isDirty: doc.isDirty,
      workspaceRoot: useWorkspaceStore.getState().rootPath ?? null,
    },
  };
}

async function sendAck(ack: TabRemovalAck): Promise<void> {
  await getCurrentWebviewWindow().emit(REMOVE_ACK_EVENT, ack);
}

/** Close this window once its last tab is gone (never the main window). */
async function closeWindowIfEmpty(label: string): Promise<void> {
  const remaining = useTabStore.getState().getTabsByWindow(label);
  if (remaining.length > 0 || label === "main") return;

  const win = getCurrentWebviewWindow();
  await invoke("close_window", { label: win.label }).catch((error: unknown) => {
    /* v8 ignore next -- @preserve String(error) fallback: invoke errors are always Error instances */
    windowCloseWarn("Failed to close window:", errorMessage(error));
  });
}

/**
 * Answer one phase of the source window's removal handshake.
 *
 * `prepare` reports state and destroys nothing; `commit` removes the tab. Both
 * always ack — a source left without an answer would either hang or, worse,
 * assume the tab is gone.
 */
export async function handleTabRemovalRequest(
  label: string,
  request: TabRemovalRequestEvent,
): Promise<void> {
  const { requestId, tabId, phase } = request;

  if (phase === "prepare") {
    const result = collectLiveTabState(label, tabId);
    await sendAck(
      "data" in result
        ? { requestId, tabId, phase, accepted: true, data: result.data }
        : { requestId, tabId, phase, accepted: false, reason: result.reason },
    );
    return;
  }

  // Anything that isn't a phase we know is refused, never guessed at: the only
  // other action here is destroying a tab.
  if (phase !== "commit") {
    await sendAck({ requestId, tabId, phase, accepted: false, reason: "unknownPhase" });
    return;
  }

  // commit — the source now holds the restored tab; drop this window's copy.
  useTabStore.getState().detachTab(label, tabId);
  cleanupTabState(tabId);
  await sendAck({ requestId, tabId, phase, accepted: true });
  await closeWindowIfEmpty(label);
}
