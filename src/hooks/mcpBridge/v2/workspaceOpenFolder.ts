/**
 * open_workspace MCP handler — open a FOLDER as the active workspace, gated by a
 * one-shot approval (plan WI-1.5 / ADR-2/3/4).
 *
 * Flow (fail-now → approve → AI-retry, since the transport can't hold a call for
 * human input — Codex F-04):
 *   1. Validate folderPath is a non-empty existing directory.
 *   2. If no matching one-shot exists, queue an approval prompt and respond
 *      `{ needsApproval: true }` — the AI asks the user and retries. A full
 *      queue responds RESOURCE_EXHAUSTED instead of silently dropping.
 *   3. On retry, a matching one-shot (path + window + client) authorizes the
 *      open. The per-window transition guard is acquired FIRST, then the grant
 *      is consumed and the folder opened INSIDE the guard — so a concurrent
 *      menu transition cannot make us spend the grant and skip the open. A busy
 *      guard responds BUSY without consuming; an internal open failure fails
 *      closed (never a false success). The window is the one this request runs
 *      in (getCurrentWindowLabel), not a client-supplied label.
 *
 * Validation goes through the Rust `validate_workspace_dir` command, NOT a
 * webview `stat` — this is a boundary-EXPANDING operation that can't use the
 * bridge path guard (Codex F-11), and Rust canonicalizes (resolving symlinks)
 * so the granted tree and the one-shot binding are the REAL target (Codex F-06).
 * Keeping raw fs out of the bridge surface also satisfies the fs-guard invariant.
 *
 * Security seam still owed (scoped in the plan): Codex F-10 — the authenticated
 * client id must come from the bridge event; until it does, `clientIdFor` falls
 * back to a single session id, so the one-shot binds per-session.
 *
 * @coordinates-with stores/workspaceApprovalStore.ts — the one-shot store
 * @coordinates-with services/workspaces/openWorkspaceByPath.ts — the shared open sequence
 * @coordinates-with src-tauri/src/workspace.rs — validate_workspace_dir command
 * @module hooks/mcpBridge/v2/workspaceOpenFolder
 */
import { invoke } from "@tauri-apps/api/core";
import {
  openWorkspaceByPath,
  WORKSPACE_TRANSITION_GUARD,
} from "@/services/workspaces/openWorkspaceByPath";
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

/** Canonicalize + is-dir validate via Rust (resolves symlinks, returns the
 *  canonical path). Never touches the webview fs surface. */
async function validateWorkspaceDir(
  folderPath: string,
): Promise<{ ok: true; canonicalPath: string } | { ok: false; message: string }> {
  try {
    const canonicalPath = await invoke<string>("validate_workspace_dir", { path: folderPath });
    return { ok: true, canonicalPath };
  } catch (e) {
    return { ok: false, message: `Invalid workspace folder: ${errorMessage(e)}` };
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

    // Bind to the window this request is ACTUALLY running in — never a
    // client-supplied label. Rust does not route by windowLabel, so a forged
    // label could deliver the prompt to one window and mutate another; using
    // the delivering window keeps the prompt, one-shot, and open consistent.
    // Multi-window targeting (windowId routing) is deferred (Codex F-10/H3).
    const windowLabel = getCurrentWindowLabel();
    const clientId = clientIdFor(args);
    const approvals = useWorkspaceApprovalStore.getState();

    // Retry path: a matching one-shot authorizes this open. Acquire the
    // transition guard FIRST, then consume + open INSIDE it — otherwise a
    // concurrent menu "Open Folder" holding the guard makes withReentryGuard
    // skip the open while we have already spent the grant, reporting a success
    // that never happened (Codex M4).
    if (approvals.hasOneShot(canonicalPath, windowLabel, clientId)) {
      const outcome = await withReentryGuard(
        windowLabel,
        WORKSPACE_TRANSITION_GUARD,
        async (): Promise<"opened" | "failed" | "gone"> => {
          if (!approvals.consumeOneShot(canonicalPath, windowLabel, clientId)) {
            return "gone"; // spent by a concurrent retry between peek and here
          }
          return (await openWorkspaceByPath(canonicalPath, { windowLabel }))
            ? "opened"
            : "failed";
        },
      );

      if (outcome === undefined) {
        // Guard busy — the grant was NOT consumed; the AI can retry shortly.
        await structuredError(id, {
          error: "BUSY",
          message: `A workspace transition is already in progress in this window; retry shortly.`,
        });
        return;
      }
      if (outcome === "opened") {
        await respond({ id, success: true, data: { opened: true, folderPath: canonicalPath } });
        return;
      }
      // "failed" (open threw internally) / "gone" (grant already spent): fail
      // closed so the AI never believes a workspace opened that did not.
      await structuredError(
        id,
        outcome === "failed"
          ? { error: "INTERNAL", message: `Failed to open ${canonicalPath} as a workspace.` }
          : {
              error: "APPROVAL_REQUIRED",
              message: `Opening ${canonicalPath} as a workspace needs user approval. Ask the user, then retry.`,
            },
      );
      return;
    }

    // First call: queue the prompt and fail now — the AI asks the user, retries.
    const queued = approvals.requestApproval(id, canonicalPath, windowLabel, clientId);
    if (queued === "overloaded") {
      await structuredError(id, {
        error: "RESOURCE_EXHAUSTED",
        message: `Too many workspace-open approvals are pending; wait for the user to resolve them, then retry.`,
      });
      return;
    }
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
