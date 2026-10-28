/**
 * Purpose: `vmark.workspace.save_as` handler.
 *
 * Kept separate from `workspace.ts` because save-as carries the bridge's
 * approval, path-boundary and overwrite policy.
 *
 * Key decision: the destination is judged by `saveAsDestination.ts` — path
 * guard, approval, overwrite probe, in that order — and the handler only
 * sequences admission, that policy, the live recapture and the answer.
 *
 * Key decision: overwrite protection does not rest on the `exists` probe
 * alone. A save to a destination other than the tab's own path is written
 * with `noReplace`, so a file created after the probe is kept and the request
 * is refused with the same APPROVAL_REQUIRED reply. Its toast states the
 * overwrite rule, not the auto-approve setting: no setting permits it.
 *
 * Key decision: the write itself is the app's own save (`bridgeSave.ts`). The
 * save pipeline re-points the document and its tab at the new path, and only
 * when this save is still the newest one requested for the document — so an
 * autosave to the old path that lands later cannot pull the tab back, and of
 * two Save As requests the one ASKED for last wins: the request reserves its
 * place in the document's save order when admitted, before the path guard,
 * approval and overwrite checks await, so a request delayed there cannot rank
 * last; the save pipeline activates that place only once the write has
 * succeeded, so a request refused here, by the queued path guard or by the
 * no-replace publication, or whose write fails, never supersedes an earlier
 * Save As still in flight. It also keeps the
 * document's line endings and byte-order mark, records history, and captures
 * provenance under the capture-on-save setting like every other MCP write.
 * The reply's `journaled` says whether the agent edit journal recorded the
 * saved text ("yes" | "pending" | "no"); "no" is still a saved file.
 *
 * @coordinates-with tabGuard.ts — tab resolution, the flush, INVALID_TAB
 * @coordinates-with saveAsDestination.ts — the destination policy and the toast each refusal owes
 * @coordinates-with bridgeSave.ts — the path guard and the save pipeline
 * @coordinates-with services/persistence/saveTargetClaim.ts — the place reserved at admission, activated once written
 * @coordinates-with liveEditor.ts — flushes pending keystrokes into the buffer first
 * @coordinates-with services/persistence/applyPostSaveState.ts — re-points the document and tab
 * @module services/mcpBridge/v2/workspaceSaveAs
 */

import { exists } from "@tauri-apps/plugin-fs";
import { useDocumentStore, useRevisionStore } from "@/stores/documentStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { getRuntimePlatform } from "@/utils/platform";
import { checkBridgePath } from "@/services/mcpBridge/bridgePathGuard";
import {
  isSameDocument,
  reserveSaveTarget,
  type SaveTargetReservation,
} from "@/services/persistence/saveTargetClaim";
import type { McpWriteContext } from "@/services/mcpBridge/writeContext";
import { imeToast } from "@/services/ime/imeToast";
import i18n from "@/i18n";
import { respond } from "@/services/mcpBridge/utils";
import { wrapHandler } from "./wrapHandler";
import { respondSaveFailed, saveTabForBridge, type BridgeSaveResult } from "./bridgeSave";
import { flushLiveEditors } from "./liveEditor";
import { readOperationArgs } from "./readOperationArgs";
import { requireTab, structuredError } from "./tabGuard";
import { resolveSaveAsDestination, type SaveAsDestination, type SaveAsProbes } from "./saveAsDestination";

/** Tell the user an AI client's Save As to `name` needs their approval. */
function warnApprovalRequired(name: string): void {
  imeToast.warning(i18n.t("dialog:toast.mcpApprovalRequired", { filename: name }));
}

/** Tell the user an AI client's Save As over the existing `name` was refused:
 *  no setting allows it, so the toast names the remedies that do. */
function warnOverwriteRefused(name: string): void {
  imeToast.warning(i18n.t("dialog:toast.mcpOverwriteRefused", { filename: name }));
}

/** The app's own path guard, filesystem, setting and platform. */
function liveProbes(): SaveAsProbes {
  return {
    checkPath: checkBridgePath,
    exists,
    autoApprove: () => useSettingsStore.getState().advanced.mcpServer.autoApproveEdits,
    platform: getRuntimePlatform(),
  };
}

/** Warn the user with the toast a refused destination owes, if any. */
function warnRefused(refused: Extract<SaveAsDestination, { ok: false }>): void {
  if (refused.toast === "approval") warnApprovalRequired(refused.name);
  else if (refused.toast === "overwrite") warnOverwriteRefused(refused.name);
}

/**
 * The buffer to write, read NOW after flushing pending keystrokes into it:
 * the destination checks awaited, and the user may have kept typing — or
 * closed the tab, in which case there is nothing left to save (`null`) and a
 * copy resolved earlier must not be written out in its place.
 * @edge-case A tab closed and its id reopened meanwhile holds ANOTHER
 * document: the reservation's incarnation tells them apart, the id cannot.
 */
function recaptureLiveContent(tabId: string, reservation: SaveTargetReservation): string | null {
  flushLiveEditors(tabId);
  const live = useDocumentStore.getState().documents[tabId];
  return live && isSameDocument(reservation.reserved) ? live.content : null;
}

/** Answer the client with the save's outcome; a refused no-replace write owes the overwrite toast. */
async function answerSaveAs(id: string, tabId: string, name: string, outcome: BridgeSaveResult): Promise<void> {
  if (!outcome.saved) {
    if (outcome.reason === "target-exists") warnOverwriteRefused(name);
    await respondSaveFailed(id, outcome);
    return;
  }
  const revision = useRevisionStore.getState().getRevision(tabId);
  await respond({ id, success: true, data: { revision, journaled: outcome.journaled } });
}

/**
 * Handle `vmark.workspace.save_as`. Args: `{tabId?, filePath}`.
 *
 * `context` names the client asking; the save's provenance records it as the
 * writer, with the documents it read on its connection as inputs.
 */
export async function handleWorkspaceSaveAs(
  id: string,
  args: Record<string, unknown>,
  context: McpWriteContext,
): Promise<void> {
  return wrapHandler(id, async () => {
    const wire = readOperationArgs("vmark.workspace.save_as", args);
    const filePath = wire.filePath;
    // A value of the wrong type reads as absent; an empty path names nothing.
    if (!filePath) {
      await structuredError(id, {
        error: "INVALID_PATH",
        message: "filePath must be a non-empty string",
      });
      return;
    }

    // Admission: the request's place in the document's save order is
    // reserved before the guard, approval and overwrite checks await
    // (resolving the tab yields only a microtask), so a request delayed in
    // them cannot rank after — and override — a Save As the client sent
    // later. It is activated only once every refusal check has passed.
    const tab = await requireTab(id, wire.tabId);
    if (!tab) return;
    const { tabId } = tab;
    const reservation = reserveSaveTarget(tabId);

    const destination = await resolveSaveAsDestination(filePath, tab.filePath, liveProbes());
    if (!destination.ok) {
      warnRefused(destination);
      await structuredError(id, destination.error);
      return;
    }

    const content = recaptureLiveContent(tabId, reservation);
    if (content === null) {
      await structuredError(id, { error: "INVALID_TAB", message: "No document for tab" });
      return;
    }
    const outcome = await saveTabForBridge(tabId, filePath, content, "workspace.save_as", context, {
      reservation,
      noReplace: !destination.sameOpenPath,
    });
    await answerSaveAs(id, tabId, destination.name, outcome);
  });
}
