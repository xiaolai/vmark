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
// The approve button is the primary action inside the dialog's action row.
// It was `.workspace-approval-approve` — a class that exists nowhere in src/,
// so `querySelector(...)?.click()` matched nothing, silently did nothing, and
// returned true. The journey then waited out its budget for a dialog that had
// never been told to close. The bespoke button consolidation (rule 32) moved
// these onto the canonical `.vm-btn` / `.vm-btn--primary` pair and the harness
// was never updated; nothing noticed, because nothing ran the suite.
const APPROVAL_APPROVE = ".workspace-approval-actions .vm-btn--primary";
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
  // Report whether the button was actually there. `?.click()` returning a bare
  // `true` is a fail-silent: a missed selector is indistinguishable from a
  // successful click, and the only symptom is the unrelated-looking timeout
  // below. A click that hit nothing must say so, at the point it happened.
  const clicked = await evalJs(
    client,
    `(() => {
       const el = document.querySelector(${JSON.stringify(APPROVAL_APPROVE)});
       if (!el) return false;
       el.click();
       return true;
     })()`
  );
  if (!clicked) {
    throw new Error(
      `approve button not found (${APPROVAL_APPROVE}) — the dialog is up but the ` +
        `harness cannot reach its approve action; the selector has gone stale.`
    );
  }
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
