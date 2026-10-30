/**
 * open_workspace MCP handler — open a FOLDER as the active workspace, gated by a
 * one-shot approval (ADR-2/3/4).
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
 *   4. Before consuming, Rust is asked for access (WI-LX1.1). The approval
 *      dialog is webview UI, so it cannot make Rust grant a folder: one nobody
 *      chose and the static scope cannot read is confirmed in the folder
 *      picker Rust shows, opened AT it. That cannot be waited for here, so the
 *      retry fails now, the one-shot SURVIVES, and the retry after the pick
 *      opens. Rust answers once the dialog is SHOWN, so the reply says what
 *      actually happened: a dialog is waiting (APPROVAL_REQUIRED), another
 *      dialog is in the way (BUSY), or none could be shown (INTERNAL). An
 *      access check that cannot run fails closed.
 *
 * The callback reads as the flow above; each decision is a helper
 * (`validateWorkspaceDir`, `accessRefusal`, `openApproved`, `outcomeRefusal`).
 *
 * Validation goes through the Rust `validate_workspace_dir` command, NOT a
 * webview `stat` — this is a boundary-EXPANDING operation that can't use the
 * bridge path guard (Codex F-11), and Rust canonicalizes (resolving symlinks)
 * so the granted tree and the one-shot binding are the REAL target (Codex F-06).
 * Keeping raw fs out of the bridge surface also satisfies the fs-guard invariant.
 *
 * The one-shot binds to the requesting CONNECTION (Codex F-10): the client key
 * is the request's validated `attribution.connectionId` (writeContext.ts),
 * minted by Rust per authenticated connection — never a field the client
 * sends. A grant one connection asked for cannot be spent by another; a
 * client that reconnects gets a new id and must be approved again (fail
 * closed). The prompt, the one-shot and the open all target the window the
 * request runs in; choosing another window is not offered.
 *
 * @coordinates-with stores/workspaceApprovalStore.ts — the one-shot store
 * @coordinates-with services/mcpBridge/writeContext.ts — the request's connection id
 * @coordinates-with services/workspaces/openWorkspaceByPath.ts — the shared open sequence
 * @coordinates-with services/workspaces/workspaceAccess.ts — Rust access check + picker
 * @coordinates-with src-tauri/src/workspace/validation.rs — validate_workspace_dir command
 * @coordinates-with tabGuard.ts — structuredError
 * @coordinates-with readOperationArgs.ts — the one payload parse
 * @module services/mcpBridge/v2/workspaceOpenFolder
 */
import { invoke } from "@tauri-apps/api/core";
import {
  openWorkspaceByPath,
  WORKSPACE_TRANSITION_GUARD,
} from "@/services/workspaces/openWorkspaceByPath";
import {
  requestWorkspaceConfirmation,
  resolveWorkspaceAccess,
  type ConfirmationRequest,
} from "@/services/workspaces/workspaceAccess";
import { useWorkspaceApprovalStore } from "@/stores/workspaceApprovalStore";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { withReentryGuard } from "@/utils/reentryGuard";
import { respond } from "@/services/mcpBridge/utils";
import { wrapHandler } from "./wrapHandler";
import { readOperationArgs } from "./readOperationArgs";
import { structuredError } from "./tabGuard";
import { v2ErrorString } from "./types";
import type { V2Error } from "./types";
import { commandErrorMessage } from "@/services/commands/commandError";
import type { McpWriteContext } from "@/services/mcpBridge/writeContext";

/** Canonicalize + is-dir validate via Rust (resolves symlinks, returns the
 *  canonical path). Never touches the webview fs surface.
 *
 *  `commandErrorMessage`, not `errorMessage`: `validate_workspace_dir` returns
 *  a typed `CommandError` (audit 20260907 #560), which is a plain OBJECT on the
 *  wire — `String(e)` renders it as `"[object Object]"`, the class rule 50 §10
 *  records as having shipped to users four times. */
async function validateWorkspaceDir(
  folderPath: string,
): Promise<{ ok: true; canonicalPath: string } | { ok: false; message: string }> {
  try {
    const canonicalPath = await invoke<string>("validate_workspace_dir", { path: folderPath });
    return { ok: true, canonicalPath };
  } catch (e) {
    return { ok: false, message: `Invalid workspace folder: ${commandErrorMessage(e)}` };
  }
}

/**
 * Why an approved open cannot go ahead yet, or `null` when it can (flow step
 * 4). Asked BEFORE the one-shot is spent, so every refusal keeps it.
 */
async function accessRefusal(canonicalPath: string): Promise<V2Error | null> {
  const access = await resolveWorkspaceAccess(canonicalPath);
  switch (access.kind) {
    case "granted":
    case "readable":
      return null;
    case "missing":
      return { error: "INVALID_PATH", message: `${canonicalPath} is no longer a folder.` };
    case "unverified":
      return {
        error: "INTERNAL",
        message: `Could not check access to ${canonicalPath}: ${commandErrorMessage(access.error)}`,
      };
    case "needs-confirmation":
      return confirmationRefusal(canonicalPath, await requestWorkspaceConfirmation(canonicalPath));
  }
}

/** What to tell the client about the folder dialog it needs the user to use. */
function confirmationRefusal(canonicalPath: string, request: ConfirmationRequest): V2Error {
  switch (request.kind) {
    case "opened":
      return {
        error: "APPROVAL_REQUIRED",
        message: `VMark opened a folder dialog at ${canonicalPath}. The user must choose that folder there before it can open as a workspace. Ask them to, then retry.`,
      };
    case "busy":
      return {
        error: "BUSY",
        message: `Another folder dialog is already open in VMark, so none was shown for ${canonicalPath}. Ask the user to finish with it, then retry.`,
      };
    case "failed":
      return {
        error: "INTERNAL",
        message: `Could not show a folder dialog at ${canonicalPath}: ${commandErrorMessage(request.error)}`,
      };
  }
}

type ApprovedOutcome = "opened" | "failed" | "gone" | undefined;

/**
 * Spend the one-shot and open, INSIDE the window's transition guard (flow step
 * 3). `undefined` means the guard was busy and the one-shot was NOT spent.
 */
function openApproved(
  canonicalPath: string,
  windowLabel: string,
  clientId: string,
): Promise<ApprovedOutcome> {
  return withReentryGuard(
    windowLabel,
    WORKSPACE_TRANSITION_GUARD,
    async (): Promise<"opened" | "failed" | "gone"> => {
      if (!useWorkspaceApprovalStore.getState().consumeOneShot(canonicalPath, windowLabel, clientId)) {
        return "gone"; // spent by a concurrent retry between peek and here
      }
      return (await openWorkspaceByPath(canonicalPath, { windowLabel })) ? "opened" : "failed";
    },
  );
}

/** Every outcome but "opened" fails closed: the AI never hears of an open that did not happen. */
function outcomeRefusal(canonicalPath: string, outcome: Exclude<ApprovedOutcome, "opened">): V2Error {
  switch (outcome) {
    case undefined:
      return {
        error: "BUSY",
        message: `A workspace transition is already in progress in this window; retry shortly.`,
      };
    case "failed":
      return { error: "INTERNAL", message: `Failed to open ${canonicalPath} as a workspace.` };
    case "gone":
      return {
        error: "APPROVAL_REQUIRED",
        message: `Opening ${canonicalPath} as a workspace needs user approval. Ask the user, then retry.`,
      };
  }
}

/**
 * Handle `vmark.workspace.open_workspace`. See module header for the flow.
 */
export async function handleWorkspaceOpenWorkspace(
  id: string,
  args: Record<string, unknown>,
  context: McpWriteContext,
): Promise<void> {
  return wrapHandler(id, async () => {
    // The contract declares `folderPath` and nothing else: a `windowLabel` a
    // client sends is not read, here or anywhere below.
    const { folderPath } = readOperationArgs("vmark.workspace.open_workspace", args);
    if (!folderPath) {
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
    const windowLabel = getCurrentWindowLabel();
    // The connection Rust authenticated for THIS request (Codex F-10).
    const clientId = context.attribution.connectionId;
    const approvals = useWorkspaceApprovalStore.getState();

    // Retry path: a matching one-shot authorizes this open — once access is
    // settled (step 4), spent and opened under the guard (step 3, Codex M4).
    if (approvals.hasOneShot(canonicalPath, windowLabel, clientId)) {
      const refusal = await accessRefusal(canonicalPath);
      if (refusal) {
        await structuredError(id, refusal);
        return;
      }
      const outcome = await openApproved(canonicalPath, windowLabel, clientId);
      if (outcome === "opened") {
        await respond({ id, success: true, data: { opened: true, folderPath: canonicalPath } });
        return;
      }
      await structuredError(id, outcomeRefusal(canonicalPath, outcome));
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
