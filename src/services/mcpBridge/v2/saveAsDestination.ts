/**
 * Save As destination — the policy that admits or refuses the path an AI
 * client asked `vmark.workspace.save_as` to write, before any buffer is read.
 *
 * Key decisions:
 *   - Fixed order, first refusal wins: the path guard, then approval, then
 *     the overwrite probe. A refusal names the toast it owes the user, so the
 *     handler cannot pair a reply with the wrong warning.
 *   - `autoApproveEdits` authorises saving to a NEW location, never
 *     destroying an existing one: the allowed roots include the parent of
 *     every open document, so without the probe an auto-approved Save As
 *     could overwrite any sibling of any open file.
 *   - The tab's own path, compared by file identity on the running platform,
 *     is a save, not a clobber: it needs no approval and is never probed.
 *   - The probe is the fast path only; the caller writes with `noReplace`
 *     unless `sameOpenPath`, which is the guarantee.
 *   - The settings and the filesystem arrive as `SaveAsProbes`, read in
 *     order, so `autoApprove` is read after the path guard has awaited.
 *
 * @coordinates-with workspaceSaveAs.ts — the handler that wires the probes and answers the refusal
 * @coordinates-with bridgeSave.ts — overwriteRefusal, the reply a no-replace write gives too
 * @module services/mcpBridge/v2/saveAsDestination
 */

import { getFileName } from "@/utils/paths";
import { isSameFile } from "@/utils/paths/fileIdentity";
import type { RuntimePlatform } from "@/utils/platform";
import type { BridgePathDecision } from "@/utils/mcpBridgePathPolicy";
import { overwriteRefusal } from "./bridgeSave";
import type { V2Error } from "./types";

/** What the policy reads from outside: the path guard, the filesystem, the setting and the platform. */
export interface SaveAsProbes {
  checkPath(filePath: string): Promise<BridgePathDecision>;
  exists(filePath: string): Promise<boolean>;
  autoApprove(): boolean;
  platform: RuntimePlatform;
}

/** An admitted destination, or the first refusal and the toast it owes. */
export type SaveAsDestination =
  | { ok: true; name: string; sameOpenPath: boolean }
  | { ok: false; name: string; error: V2Error; toast: "approval" | "overwrite" | null };

/** Judge `filePath` for a tab whose own path is `tabPath` (null when untitled). */
export async function resolveSaveAsDestination(
  filePath: string,
  tabPath: string | null,
  probes: SaveAsProbes,
): Promise<SaveAsDestination> {
  const name = getFileName(filePath) || filePath;
  const decision = await probes.checkPath(filePath);
  if (!decision.allowed) {
    return { ok: false, name, error: { error: "INVALID_PATH", message: decision.reason }, toast: null };
  }
  const sameOpenPath = tabPath != null && isSameFile(tabPath, filePath, probes.platform);
  if (sameOpenPath) return { ok: true, name, sameOpenPath };
  if (!probes.autoApprove()) {
    const message = "Saving to a new location requires user approval (autoApproveEdits is off)";
    return { ok: false, name, error: { error: "APPROVAL_REQUIRED", message }, toast: "approval" };
  }
  if (await probes.exists(filePath)) {
    return { ok: false, name, error: { error: "APPROVAL_REQUIRED", message: overwriteRefusal(name) }, toast: "overwrite" };
  }
  return { ok: true, name, sameOpenPath };
}
