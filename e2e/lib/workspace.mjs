/**
 * Workspace open/close helpers for the E2E journey suite.
 *
 * `open_workspace` is the one bridge tool with a HUMAN APPROVAL gate, and the
 * transport cannot hold a call open for input — so the real shipping flow is
 * fail-now → approve → AI-retry (src/hooks/mcpBridge/v2/workspaceOpenFolder.ts):
 *
 *   1. fire `vmark.workspace.open_workspace` → handler queues a prompt and
 *      answers `{needsApproval:true}`;
 *   2. the user approves in `WorkspaceApprovalDialog` → a one-shot grant is
 *      minted (path + window + client, 5-min TTL);
 *   3. the SAME call is fired again → the retry consumes the grant and opens.
 *
 * `mcpFire` is fire-and-observe (the reply goes to Rust), so every step here is
 * asserted through the DOM: the dialog element for (1)/(2), and the persisted
 * workspace root for (3). Verified against the running debug build.
 */

import { evalJs } from "./bridge.mjs";
import { emitMenu, mcpFire, poll, getPersistedWorkspaceRoot } from "./vmark.mjs";

const APPROVAL_OVERLAY = ".workspace-approval-overlay";
const APPROVAL_APPROVE = ".workspace-approval-approve";
const APPROVAL_PATH = ".workspace-approval-path";

/** The pending approval prompt, or null when no dialog is up. */
export function getApprovalPrompt(client) {
  return evalJs(
    client,
    `(() => {
       const el = document.querySelector(${JSON.stringify(APPROVAL_OVERLAY)});
       if (!el) return null;
       return { path: el.querySelector(${JSON.stringify(APPROVAL_PATH)})?.textContent ?? null };
     })()`
  );
}

/**
 * Open `folderPath` as the active workspace through the REAL approval flow.
 * Resolves once the workspace root is persisted. Throws if the dialog never
 * appears (approval regression) or the retry never lands the root.
 */
export async function openWorkspaceViaMcp(client, folderPath, { windowLabel = "main" } = {}) {
  // 1. First call — must be refused pending approval, surfacing the dialog.
  await mcpFire(client, "vmark.workspace.open_workspace", { folderPath });
  const prompt = await poll(
    () => getApprovalPrompt(client),
    (p) => p !== null,
    `approval dialog for ${folderPath}`
  );
  if (prompt.path !== folderPath) {
    throw new Error(`approval dialog shows ${prompt.path}, expected ${folderPath}`);
  }

  // 2. Approve through the real button — mints the one-shot grant.
  await evalJs(
    client,
    `(() => { document.querySelector(${JSON.stringify(APPROVAL_APPROVE)})?.click(); return true; })()`
  );
  await poll(
    () => getApprovalPrompt(client),
    (p) => p === null,
    "approval dialog to dismiss after approve"
  );

  // 3. Retry the SAME call — consumes the grant and opens the folder.
  await mcpFire(client, "vmark.workspace.open_workspace", { folderPath });
  await poll(
    () => getPersistedWorkspaceRoot(client, windowLabel),
    (root) => root === folderPath,
    `workspace root to become ${folderPath}`,
    { timeoutMs: 15000 }
  );
  return folderPath;
}

/** Close the active workspace via the File menu; resolves when the root clears. */
export async function closeWorkspace(client, { windowLabel = "main" } = {}) {
  await emitMenu(client, "close-workspace", windowLabel);
  await poll(
    () => getPersistedWorkspaceRoot(client, windowLabel),
    (root) => !root,
    "workspace root to clear after close-workspace",
    { timeoutMs: 15000 }
  );
}
