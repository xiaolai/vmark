/**
 * Drive the real `BrowserApprovalDialog` from an E2E journey (WI-3.3).
 *
 * ADR-BR2: the approval flow is SEQUENTIAL, not a held-open request. `browserAct.ts`
 * responds immediately with a refusal and queues a prompt; the user's decision mints
 * a one-shot (`grantSync.ts` → `browser_add_one_shot`); the RETRY consumes it. So a
 * journey is four ordinary steps with no concurrency:
 *
 *   1. callTool(browser, act)      → refusal mentioning approval
 *   2. approve(...) — this file    → clicks the actual dialog
 *   3. (authority minted in Rust)
 *   4. callTool(browser, act)      → succeeds
 *
 * WHY THIS CLICKS THE DOM. It would be far easier to reach into the approval store
 * and call `resolveApproval` through `execute_js`. That would also pass while the
 * dialog was wired to nothing at all — the button could be inert, mislabelled, or
 * absent, and every approval journey would still go green. The dialog is the entire
 * human half of this security model; the test has to press it.
 *
 * WHAT COUNTS AS PROOF. Not "the store says a one-shot exists" — `grantSync.ts:106`
 * fires `void invoke(...)` and swallows failure into a warning, so the frontend
 * believing it minted authority is not evidence that Rust received any. The only
 * proof is that the retried action SUCCEEDS.
 *
 * @coordinates-with src/components/Browser/BrowserApprovalDialog.tsx — the surface
 * @coordinates-with src/services/browser/grantSync.ts — the mint it triggers
 */

import { evalJs } from "./bridge.mjs";
import { poll } from "./vmark.mjs";

/** The dialog root, as it is ACTUALLY rendered (BrowserApprovalDialog.tsx:117). */
const ROOT = ".browser-approval";

/** Snapshot of the visible approval dialog, or null when none is shown. */
export async function readApprovalDialog(client) {
  const raw = await evalJs(
    client,
    `(() => {
       const root = document.querySelector(${JSON.stringify(ROOT)});
       if (!root) return "null";
       const buttons = Array.from(root.querySelectorAll('button')).map((b) => ({
         text: (b.textContent || '').trim(),
         disabled: b.disabled === true,
         focused: b === document.activeElement,
       }));
       const originEl = root.querySelector('.browser-approval-origin');
       return JSON.stringify({
         text: (root.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 400),
         origin: originEl ? (originEl.textContent || '').trim() : null,
         buttons,
       });
     })()`
  );
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Wait for an approval prompt to appear. */
export async function waitForApprovalDialog(client, timeoutMs = 8000) {
  return poll(
    () => readApprovalDialog(client),
    (d) => d !== null && Array.isArray(d.buttons) && d.buttons.length > 0,
    "browser approval dialog visible",
    { timeoutMs }
  );
}

/**
 * Click a decision button by its visible label.
 *
 * Matched on the button's own accessible text, so a renamed or removed control
 * fails the journey instead of silently doing nothing.
 *
 * @param {"allow-once"|"allow-site"|"deny"} decision
 */
export async function resolveApprovalViaUi(client, decision) {
  // Label patterns, not test-ids: these are what the user actually reads, and a
  // change to them is a change to the security UX that should break a test.
  // Exact labels from src/locales/en/common.json:146-149. Matching on what the
  // user reads means a change to the security wording breaks a test, which is
  // the correct place for that to surface.
  const patterns = {
    "allow-once": /^Allow once$/i,
    "allow-site": /^Allow on this site$|^Allow until navigation$/i,
    deny: /^Deny$/i,
  };
  const pattern = patterns[decision];
  if (!pattern) throw new Error(`unknown decision: ${decision}`);

  const result = await evalJs(
    client,
    `(() => {
       const root = document.querySelector(".browser-approval");
       if (!root) return "NO_DIALOG";
       const re = ${pattern.toString()};
       const btn = Array.from(root.querySelectorAll('button'))
         .find((b) => re.test((b.textContent || '').trim()));
       if (!btn) {
         return "NO_BUTTON:" + Array.from(root.querySelectorAll('button'))
           .map((b) => (b.textContent || '').trim()).join('|');
       }
       if (btn.disabled) return "DISABLED";
       btn.click();
       return "CLICKED";
     })()`
  );
  if (result !== "CLICKED") {
    throw new Error(`could not click '${decision}' in the approval dialog: ${result}`);
  }
  // The dialog should dismiss; if it does not, the click was not wired.
  await poll(
    () => readApprovalDialog(client),
    (d) => d === null,
    `approval dialog dismissed after '${decision}'`,
    { timeoutMs: 5000 }
  );
}

/** Press Escape on the dialog — must be equivalent to denying. */
export async function dismissApprovalWithEscape(client) {
  await evalJs(
    client,
    `(() => {
       const root = document.querySelector(".browser-approval");
       if (!root) return false;
       root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
       document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
       return true;
     })()`
  );
  await poll(
    () => readApprovalDialog(client),
    (d) => d === null,
    "approval dialog dismissed by Escape",
    { timeoutMs: 5000 }
  );
}
