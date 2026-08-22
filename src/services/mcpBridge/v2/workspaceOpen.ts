/**
 * Purpose: `vmark.workspace.open` — background file open (WI-14 / plan D10).
 *
 * Split from workspace.ts (file-size gate). MCP opens are BACKGROUND: the
 * user's visible tab and workspace do not change; only the explicit
 * `switch_tab` action may change the visible context. The response carries
 * `{tabId, workspaceInstanceId, activationChanged, workspaceSwitched}` so the
 * AI client can chain the tabId into document calls and disclose state.
 *
 * @coordinates-with workspace.ts — the rest of the vmark.workspace.* surface
 * @coordinates-with services/workspaces/workspaceContextOwnership.ts — claim
 * @module services/mcpBridge/v2/workspaceOpen
 */
import { readTextFile } from "@tauri-apps/plugin-fs";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { checkBridgePath } from "@/services/mcpBridge/bridgePathGuard";
import { claimTabForWorkspaceContext } from "@/services/workspaces/workspaceContextOwnership";
import { respond } from "@/services/mcpBridge/utils";
import { wrapHandler } from "./wrapHandler";
import { v2ErrorString } from "./types";
import type { V2Error } from "./types";
import { errorMessage } from "@/utils/errorMessage";
import { withActivationOrigin } from "@/stores/tabActivationBus";

function structuredError(id: string, err: V2Error): Promise<void> {
  return respond({ id, success: false, error: v2ErrorString(err) });
}

function getWindowLabel(args: Record<string, unknown>): string {
  const explicit = args.windowLabel;
  if (typeof explicit === "string" && explicit.length > 0) return explicit;
  return getCurrentWindowLabel();
}

/**
 * Handle `vmark.workspace.open`. Reads `filePath` from disk and opens
 * it in a new tab. Args: `{filePath: string, windowLabel?: string}`.
 */
export async function handleWorkspaceOpen(
  id: string,
  args: Record<string, unknown>,
): Promise<void> {
  return wrapHandler(id, async () => {
    const filePath = args.filePath;
    if (typeof filePath !== "string" || filePath.length === 0) {
      await structuredError(id, {
        error: "INVALID_PATH",
        message: "filePath must be a non-empty string",
      });
      return;
    }
    // Confine the read to the workspace + open-document tree. Without this,
    // a prompt-injected agent could read any file the fs capability reaches
    // ($HOME/**, incl. dotfiles like ~/.ssh/id_rsa).
    const openDecision = await checkBridgePath(filePath);
    if (!openDecision.allowed) {
      await structuredError(id, {
        error: "INVALID_PATH",
        message: openDecision.reason,
      });
      return;
    }
    let content: string;
    try {
      content = await readTextFile(filePath);
    } catch (e) {
      await structuredError(id, {
        error: "INVALID_PATH",
        message: `Failed to read ${filePath}: ${errorMessage(e)}`,
      });
      return;
    }
    const tabStore = useTabStore.getState();
    const docStore = useDocumentStore.getState();
    const windowLabel = getWindowLabel(args);
    // WI-14 (plan D10): MCP opens are BACKGROUND. Remember what the human had
    // focused; `createTab` activates, so we restore afterwards. Only the
    // explicit `switch_tab` action may change the visible context.
    const prevActiveTabId = tabStore.activeTabId[windowLabel] ?? null;
    // WI-TNAV0.2 — the activations below are NOT the user switching documents,
    // and labelling them says so. Without this the MRU records a file the human
    // never saw, so `Ctrl+Tab` jumps to it (D5/D12). The region is deliberately
    // synchronous: `withActivationOrigin` is a module-level scope and an await
    // inside would leak the label onto a real activation.
    const { tabId, existing, owner } = withActivationOrigin("background", () => {
      const openedTabId = tabStore.createTab(windowLabel, filePath);
      // `createTab` dedupes by path, so this may be a tab that is ALREADY open.
      const openedExisting = docStore.documents[openedTabId];
      const openedOwner = claimTabForWorkspaceContext(windowLabel, openedTabId, filePath);
      restoreBackgroundActivation(windowLabel, prevActiveTabId, openedTabId);
      return { tabId: openedTabId, existing: openedExisting, owner: openedOwner };
    });
    const background = {
      workspaceInstanceId: owner?.workspaceInstanceId ?? null,
      workspaceSwitched: false,
      activationChanged:
        (useTabStore.getState().activeTabId[windowLabel] ?? null) !== prevActiveTabId,
    };

    // WI-3: re-initialising an already-open tab replaces the whole document
    // entry (savedContent, isDirty, documentId), so an open file with local
    // content would be silently reset to disk content with no checkpoint.
    // Focus it instead and tell the caller why nothing was reloaded.
    //
    // `isDivergent` counts as unsaved just as much as `isDirty` does: it marks
    // a document where the user answered "Keep my changes" to an external
    // modification, so the buffer is deliberately-retained local content even
    // though the dirty flag is clear.
    if (existing && (existing.isDirty || existing.isDivergent)) {
      const why = existing.isDirty
        ? "unsaved changes"
        : "local content deliberately kept after an external modification";
      await respond({
        id,
        success: true,
        data: {
          tabId,
          alreadyOpen: true,
          reloaded: false,
          ...background,
          reason: `Tab is already open with ${why}; it was not reloaded from disk, which would have discarded them. Use switch_tab to focus it.`,
        },
      });
      return;
    }

    // ONE door for both branches. This used to be `loadContent` for an
    // existing tab and `initDocument` for a new one, with a comment explaining
    // why they could not be swapped: `initDocument` builds a FRESH entry,
    // resetting `readOnly` (silently disabling write protection), the per-doc
    // editor mode, and `documentId` — and a first-open document sits at
    // `documentId === 0`, so rebuilding it there leaves the counter unchanged
    // and the editor may never remount on the new content.
    //
    // The `disk-open` ingest satisfies both: it mutates in place (touching
    // neither `readOnly` nor `mode`), increments `documentId`, bumps the
    // revision when the content actually moved, and CREATES the document when
    // the tab has none — so the branch that existed to pick a door is gone.
    // `loadContent` itself is gone: it duplicated this door's baseline branch
    // and had drifted, retaining stale line metadata.
    //
    // WI-2.6 — registry handles YAML routing; the force-source bandaid is
    // retired. .yaml/.yml route to the YAML adapter (kind: split-pane).
    docStore.ingestExternalContent(tabId, content, "disk-open", { filePath });
    if (existing) {
      // The ingest deliberately does NOT clear `isMissing` — hot-exit restore
      // replays saved content for a file that may genuinely be gone. Here the
      // read above just succeeded, so the file demonstrably exists: pair the
      // two exactly as `services/persistence/reloadFromDisk.ts` does, or a
      // deleted-then-recreated file stays flagged missing forever.
      docStore.clearMissing(tabId);
    }
    await respond({
      id,
      success: true,
      data: { tabId, alreadyOpen: existing !== undefined, reloaded: true, ...background },
    });
  });
}

/**
 * D10: undo `createTab`'s focus steal so an MCP open stays in the background.
 * Pane-aware through `setActiveTab` itself (WI-2 seam, ADR-1): under a split
 * the previous document returns to the focused pane.
 */
function restoreBackgroundActivation(
  windowLabel: string,
  prevActiveTabId: string | null,
  openedTabId: string,
): void {
  if (!prevActiveTabId || prevActiveTabId === openedTabId) return;
  const current = useTabStore.getState().activeTabId[windowLabel] ?? null;
  if (current !== openedTabId) return; // nothing was stolen
  useTabStore.getState().setActiveTab(windowLabel, prevActiveTabId);
}
