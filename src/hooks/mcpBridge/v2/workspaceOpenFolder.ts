/**
 * open_workspace MCP handler — open a FOLDER as the active workspace, gated by a
 * one-shot approval (plan WI-1.5 / ADR-2/3/4).
 *
 * Flow (fail-now → approve → AI-retry, since the transport can't hold a call for
 * human input — Codex F-04):
 *   1. Validate folderPath is a non-empty existing directory.
 *   2. If no matching one-shot exists, queue an approval prompt and respond
 *      `{ needsApproval: true }` — the AI asks the user and retries.
 *   3. On retry, a matching one-shot (path + window + client) is consumed and
 *      the folder is opened via the shared openWorkspaceByPath, under the
 *      per-window transition guard.
 *
 * Security seams still owed to Rust (scoped in the plan, marked below):
 *   - WI-1.1a: canonicalize + is-dir via a Rust IPC. The JS `stat` check here is
 *     interim; it does not resolve symlinks, so the prompt/binding path is not
 *     yet guaranteed canonical (Codex F-06).
 *   - Codex F-10: the authenticated client id must come from the bridge event.
 *     Until it does, `clientIdFor` falls back to a single session id, so the
 *     one-shot is bound per-session rather than per-authenticated-client.
 *
 * @coordinates-with stores/workspaceApprovalStore.ts — the one-shot store
 * @coordinates-with hooks/openWorkspaceByPath.ts — the shared open sequence
 * @module hooks/mcpBridge/v2/workspaceOpenFolder
 */
import { stat } from "@tauri-apps/plugin-fs";
import {
  openWorkspaceByPath,
  WORKSPACE_TRANSITION_GUARD,
} from "@/hooks/openWorkspaceByPath";
import { useWorkspaceApprovalStore } from "@/stores/workspaceApprovalStore";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { withReentryGuard } from "@/utils/reentryGuard";
import { respond } from "../utils";
import { wrapHandler } from "./wrapHandler";
import { v2ErrorString } from "./types";
import type { V2Error } from "./types";
import { errorMessage } from "@/utils/errorMessage";

function structuredError(id: string, err: V2Error): Promise<void> {
  return respond({ id, success: false, error: v2ErrorString(err) });
}

/** Authenticated client id for one-shot binding. Interim: single session id
 *  until the Rust bridge event carries a real principal (Codex F-10). */
function clientIdFor(args: Record<string, unknown>): string {
  return typeof args.clientId === "string" && args.clientId.length > 0
    ? args.clientId
    : "mcp-session";
}

/** Validate the target is an existing directory. Interim (Codex F-06): a Rust
 *  canonicalize+is-dir IPC should replace this and return the canonical path. */
async function validateWorkspaceDir(
  folderPath: string,
): Promise<{ ok: true; canonicalPath: string } | { ok: false; message: string }> {
  try {
    const info = await stat(folderPath);
    if (!info.isDirectory) {
      return { ok: false, message: `${folderPath} is not a directory` };
    }
    return { ok: true, canonicalPath: folderPath };
  } catch (e) {
    return { ok: false, message: `Cannot access ${folderPath}: ${errorMessage(e)}` };
  }
}

/**
 * Handle `vmark.workspace.open_workspace`. See module header for the flow.
 */
export async function handleWorkspaceOpenWorkspace(
  id: string,
  args: Record<string, unknown>,
): Promise<void> {
  return wrapHandler(id, async () => {
    const folderPath = args.folderPath;
    if (typeof folderPath !== "string" || folderPath.length === 0) {
      await structuredError(id, {
        error: "INVALID_PATH",
        message: "folderPath must be a non-empty string",
      });
      return;
    }

    const validation = await validateWorkspaceDir(folderPath);
    if (!validation.ok) {
      await structuredError(id, { error: "INVALID_PATH", message: validation.message });
      return;
    }
    const { canonicalPath } = validation;

    const windowLabel =
      typeof args.windowLabel === "string" && args.windowLabel.length > 0
        ? args.windowLabel
        : getCurrentWindowLabel();
    const clientId = clientIdFor(args);
    const approvals = useWorkspaceApprovalStore.getState();

    // Retry path: a matching one-shot authorizes exactly this open.
    if (approvals.consumeOneShot(canonicalPath, windowLabel, clientId)) {
      await withReentryGuard(windowLabel, WORKSPACE_TRANSITION_GUARD, () =>
        openWorkspaceByPath(canonicalPath, { windowLabel }),
      );
      await respond({ id, success: true, data: { opened: true, folderPath: canonicalPath } });
      return;
    }

    // First call: queue the prompt and fail now — the AI asks the user, retries.
    approvals.requestApproval(id, canonicalPath, windowLabel, clientId);
    await respond({
      id,
      success: false,
      data: { needsApproval: true, folderPath: canonicalPath, windowLabel },
      error: v2ErrorString({
        error: "APPROVAL_REQUIRED",
        message: `Opening ${canonicalPath} as a workspace needs user approval. Ask the user, then retry.`,
      }),
    });
  });
}
