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
 *
 * A failure AFTER the prompt appeared cleans up the shared app state it
 * touched: an open dialog is denied, and a grant minted by a successful
 * approve is REVOKED by consuming it through the approval store — reached via
 * the dev module graph (dev-docs/e2e-testing.md, the store-import trick).
 * That import can hand out a parallel store in an HMR-dirty session, so the
 * store is proven LIVE first: while the dialog is up, the live store holds the
 * pending prompt and a parallel one holds nothing. A store that cannot be
 * reached is reported as "grant still live", never as "nothing to revoke".
 */

import { realpathSync } from "node:fs";

import { evalJs } from "./bridge.mjs";
import { emitMenu, mcpFire, poll, getPersistedWorkspaceRoot } from "./vmark.mjs";
import { getRailInstances } from "./rail.mjs";

/**
 * The approval dialog's selectors, and the component they describe.
 *
 * These are CSS classes, not automation hooks, so they are coupled to a
 * styling decision that has already moved once underneath them:
 * `.workspace-approval-approve` existed nowhere in `src/`, so
 * `querySelector(...)?.click()` matched nothing, silently did nothing, and
 * returned true — the journey then waited out its budget for a dialog nobody
 * had told to close. The bespoke-button consolidation (rule 32) had moved the
 * pair onto the canonical `.vm-btn` / `.vm-btn--primary`, and nothing noticed
 * because nothing ran the suite.
 *
 * They are EXPORTED so `workspace.test.mjs` can check them against the real
 * component at gate time (audit R3 #8): the drift is now a failing test in
 * `check:static` rather than a live-app-only symptom. A stable
 * `data-approval-action` attribute on the dialog would remove the coupling
 * outright and is the better fix; until it exists, this is the half that can be
 * verified without a running app.
 */
export const APPROVAL_SOURCE = "src/components/Workspace/WorkspaceApprovalDialog.tsx";
export const APPROVAL_OVERLAY = ".workspace-approval-overlay";
/** The approve button is the primary action inside the dialog's action row. */
export const APPROVAL_APPROVE = ".workspace-approval-actions .vm-btn--primary";
export const APPROVAL_PATH = ".workspace-approval-path";
// The dialog's other button is Deny (Escape denies too — the dialog is
// fail-closed, WorkspaceApprovalDialog.tsx).
export const APPROVAL_DENY = ".workspace-approval-actions .vm-btn:not(.vm-btn--primary)";

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
 * Best-effort: deny every still-open approval prompt so a failure here does not
 * leave a dialog up for the next journey. Resolves `{ denied, remaining }`.
 *
 * The store holds a QUEUE (`pending` is an array) and the dialog renders its
 * head, so denying once can reveal the next prompt rather than closing the
 * overlay. Waiting for "no overlay" then timed out, the caller's `.catch()`
 * swallowed it, and the journey reported "no approval dialog was left open"
 * while leaving one up for the next journey to trip over (audit R2 #9). Each
 * round waits for THIS prompt to go — the overlay gone, or a different path
 * showing — and the loop is bounded so a dialog that refuses to close is
 * reported rather than spun on.
 */
async function dismissApprovalPrompt(client) {
  let denied = 0;
  for (let round = 0; round < 5; round++) {
    const before = await getApprovalPrompt(client);
    if (before === null) return { denied, remaining: false };
    const clicked = await evalJs(
      client,
      `(() => { const el = document.querySelector(${JSON.stringify(APPROVAL_DENY)}); if (!el) return false; el.click(); return true; })()`
    );
    if (!clicked) break;
    denied += 1;
    await poll(
      () => getApprovalPrompt(client),
      (p) => p === null || p.path !== before.path,
      "the denied approval prompt to be dismissed",
      { timeoutMs: 5000 }
    ).catch(() => {});
  }
  return { denied, remaining: (await getApprovalPrompt(client)) !== null };
}

/** Phase 1: fire the call; the handler must refuse it pending approval, surfacing the dialog for `folderPath`. */
async function requestApproval(client, folderPath) {
  await mcpFire(client, "vmark.workspace.open_workspace", { folderPath });
  const prompt = await poll(() => getApprovalPrompt(client), (p) => p !== null, `approval dialog for ${folderPath}`);
  if (prompt.path !== folderPath) {
    throw new Error(`approval dialog shows ${prompt.path}, expected ${folderPath}`);
  }
}

/**
 * Phase 2: approve through the real button — mints the one-shot grant — and
 * wait for the dialog to go. Reports whether the button was actually there:
 * `?.click()` returning a bare `true` is a fail-silent, a missed selector
 * indistinguishable from a successful click whose only symptom is an
 * unrelated-looking timeout later. A click that hit nothing says so, at the
 * point it happened.
 */
async function approvePrompt(client) {
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
  await poll(() => getApprovalPrompt(client), (p) => p === null, "approval dialog to dismiss after approve");
}

/** Phase 3: the SAME call again — consumes the grant and opens the folder; resolves once the root is persisted. */
async function retryOpen(client, folderPath, windowLabel) {
  await mcpFire(client, "vmark.workspace.open_workspace", { folderPath });
  await poll(
    () => getPersistedWorkspaceRoot(client, windowLabel),
    (root) => root === folderPath,
    `workspace root to become ${folderPath}`,
    { timeoutMs: 15000 }
  );
}

const APPROVAL_STORE_MODULE = "/src/stores/workspaceApprovalStore.ts";

/**
 * Evaluate `body` — the source of a `(store) => value` function — against the
 * app's approval store, imported through the dev module graph. The bridge
 * cannot await a page promise, so the import runs detached and parks its
 * outcome on a run-scoped window slot this polls (the pattern journey 38
 * uses for the same reason).
 */
async function withApprovalStore(client, body) {
  const slot = `__vmarkE2eApproval_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  await evalJs(
    client,
    `(() => {
       window[${JSON.stringify(slot)}] = { done: false };
       (async () => {
         try {
           const { useWorkspaceApprovalStore } = await import(${JSON.stringify(APPROVAL_STORE_MODULE)});
           window[${JSON.stringify(slot)}] = { done: true, ok: true, value: (${body})(useWorkspaceApprovalStore) };
         } catch (e) {
           window[${JSON.stringify(slot)}] = { done: true, ok: false, error: e && e.message ? e.message : String(e) };
         }
       })();
       return true;
     })()`
  );
  try {
    const outcome = await poll(
      async () => JSON.parse(await evalJs(client, `JSON.stringify(window[${JSON.stringify(slot)}] ?? null)`)),
      (v) => v?.done === true,
      "the approval store to answer"
    );
    if (!outcome.ok) throw new Error(`approval store: ${outcome.error}`);
    return outcome.value;
  } finally {
    await evalJs(client, `(delete window[${JSON.stringify(slot)}], true)`).catch(() => {});
  }
}

/**
 * The store's one-shot grants, plus whether the imported store is the LIVE
 * singleton: taken while THIS prompt is up, the live store holds it in
 * `pending`.
 *
 * The liveness proof matches the prompt's own `canonicalPath`, not merely
 * `pending.length > 0`: a non-empty queue is evidence that SOME store holds a
 * prompt, and in an HMR-dirty session that can be a parallel instance holding
 * an unrelated one — so the check would pass on a store whose `oneShots` are
 * not the ones a revoke has to reach (audit R2 #11). Matching the path makes
 * it a positive identification of the store the dialog is rendering.
 */
const grantLedger = (client, canonicalPath) =>
  withApprovalStore(
    client,
    `(store) => {
       const s = store.getState();
       const want = ${JSON.stringify(canonicalPath)};
       return {
         live: s.pending.some((p) => p.canonicalPath === want),
         oneShots: s.oneShots.map((o) => ({ ...o })),
       };
     }`
  );

/**
 * Revoke every grant minted since `before` by CONSUMING it — the store's only
 * removal path short of expiry, and exactly what a successful retry would have
 * done. Resolves a sentence for the error message; never throws over the
 * failure it is cleaning up after.
 */
async function revokeMintedGrants(client, before) {
  if (!before.live) {
    return "the approve grant could not be revoked (the approval store reachable here does not hold this prompt — an HMR-parallel instance) and stays live for up to 5 minutes";
  }
  // Identity is a JSON TUPLE, not a `|`-joined string: a workspace path or a
  // client id containing `|` made two different grants compare equal, so a
  // newly minted one could be mistaken for a pre-existing one and left live
  // (audit R2 #12). JSON.stringify of an array is unambiguous for any content.
  const known = before.oneShots.map((o) => JSON.stringify([o.canonicalPath, o.windowLabel, o.clientId, o.createdAt]));
  const revoked = await withApprovalStore(
    client,
    `(store) => {
       const s = store.getState();
       const known = new Set(${JSON.stringify(known)});
       const fresh = s.oneShots.filter((o) => !known.has(JSON.stringify([o.canonicalPath, o.windowLabel, o.clientId, o.createdAt])));
       return fresh.map((o) => ({ path: o.canonicalPath, consumed: s.consumeOneShot(o.canonicalPath, o.windowLabel, o.clientId) }));
     }`
  ).catch((e) => e);
  if (revoked instanceof Error) return `the approve grant could not be revoked (${revoked.message}) and may stay live for up to 5 minutes`;
  if (revoked.length === 0) return "no live approve grant remained (the retry had consumed it)";
  const stuck = revoked.filter((r) => !r.consumed).map((r) => r.path);
  return stuck.length === 0
    ? `the approve grant for ${revoked.map((r) => r.path).join(", ")} was revoked`
    : `the approve grant for ${stuck.join(", ")} could NOT be revoked and stays live for up to 5 minutes`;
}

/**
 * Open `folderPath` as the active workspace through the REAL approval flow.
 * Resolves once the workspace root is persisted, and RETURNS the canonical
 * path the product opened.
 *
 * The path is CANONICALIZED once, up front, and used for every comparison
 * afterwards. The product canonicalizes too — Rust's `validate_workspace_dir`
 * resolves symlinks, the dialog renders `pending.canonicalPath`, and the
 * one-shot binds to it — so a caller's uncanonical spelling (a symlinked
 * parent, a `.` segment, a trailing separator) made a CORRECT open fail on
 * `approval dialog shows X, expected Y` or time out waiting for a root that
 * had already landed under its real name (audit R2 #10). `realpathSync` is the
 * harness's side of the same operation; it runs on the machine the app runs on.
 *
 * A failure AFTER the prompt appeared cleans up after itself: the dialog is
 * denied if it is still up (shared app state — the next journey would find it
 * blocking its own prompt), and a grant minted by a successful approve is
 * revoked (`revokeMintedGrants`); the error says which happened. The request
 * phase runs INSIDE that cleanup too: a dialog that came up for the wrong
 * path is a failure with the dialog still open, and it used to be thrown
 * past the catch that denies it (audit 20260907 #8).
 */
export async function openWorkspaceViaMcp(client, folderPath, { windowLabel = "main" } = {}) {
  let canonicalPath;
  try {
    canonicalPath = realpathSync(folderPath);
  } catch (error) {
    throw new Error(
      `cannot open ${folderPath} as a workspace: it does not resolve on disk ` +
        `(${error instanceof Error ? error.message : String(error)})`,
      { cause: error },
    );
  }
  let grantsBefore = null;
  try {
    await requestApproval(client, canonicalPath);
    grantsBefore = await grantLedger(client, canonicalPath);
    await approvePrompt(client);
    await retryOpen(client, canonicalPath, windowLabel);
    return canonicalPath;
  } catch (error) {
    const dismissed = await dismissApprovalPrompt(client).catch(() => ({ denied: 0, remaining: true }));
    const cleanup = [
      dismissed.remaining
        ? `an approval dialog is STILL OPEN after ${dismissed.denied} deny click(s) — the next journey will find it`
        : dismissed.denied > 0
          ? `${dismissed.denied} approval dialog(s) were denied on the way out`
          : "no approval dialog was left open",
      grantsBefore ? await revokeMintedGrants(client, grantsBefore) : "no grant was minted",
    ].join("; ");
    throw new Error(`${error instanceof Error ? error.message : String(error)} (${cleanup})`, { cause: error });
  }
}

/**
 * Close the active workspace via the File menu; resolves once the workspace
 * that was open is GONE — with the rail on, the instance that was ACTIVE has
 * left the rail; with the rail off, the persisted root changed (to null, or to
 * a promoted successor's root).
 *
 * With the rail on this is the product's rail-aware close since 2026-09-07:
 * `workspace.close` removes the ACTIVE railed instance through
 * `closeWorkspaceInstance` and promotes a successor (it used to only null the
 * workspace store, leaving a rootless instance active — see
 * `closeRailInstance` in rail.mjs for what that did to every later journey).
 * The successor is HYDRATED, so with two real workspaces on the rail the
 * persisted root becomes the survivor's — "wait for the root to clear" would
 * time out on exactly the promotion the contract describes. Journeys call
 * this FIRST in teardown, so a full run exercises that fix, and `restoreRail`
 * after it for anything the menu path does not reach.
 *
 * A no-op when nothing is open: firing `menu:close-workspace` then would only
 * persist a session for nothing.
 */
export async function closeWorkspace(client, { windowLabel = "main" } = {}) {
  const railIds = async () => (await getRailInstances(client)).map((i) => i.instanceId);
  const activeRail = async () => (await getRailInstances(client)).find((i) => i.active)?.instanceId ?? null;
  const before = { root: await getPersistedWorkspaceRoot(client, windowLabel), active: await activeRail() };
  if (!before.root) return;
  await emitMenu(client, "close-workspace", windowLabel);
  // With the rail on, the CONTRACT is that the active instance is REMOVED and a
  // successor promoted (`closeWorkspaceInstance`). "The root changed" is
  // satisfied by the very regression this helper exists to exercise — the old
  // `workspace.close` nulled the root and left the same rootless instance
  // ACTIVE — so when a rail instance was active, that exact id must be gone
  // (audit R2 #15). With the rail off there is no instance to watch and the
  // persisted root is the only observable.
  await poll(
    async () => ({ root: await getPersistedWorkspaceRoot(client, windowLabel), ids: await railIds() }),
    (now) => (before.active === null ? now.root !== before.root : !now.ids.includes(before.active)),
    before.active === null
      ? `the closed workspace ${before.root} to be replaced (persisted root to change)`
      : `rail instance ${before.active} (workspace ${before.root}) to be removed from the rail`,
    { timeoutMs: 15000 }
  );
}
