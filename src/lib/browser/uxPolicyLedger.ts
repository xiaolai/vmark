/**
 * Shipped-dispositions ledger (WI-NB8.2) — the CONFORMANCE record that makes
 * `uxPolicy.ts` an enforced contract rather than a decision document nothing
 * reads at runtime.
 *
 * `UX_POLICY` records the R12 DECISION for each browser UX surface. The native
 * delegates implement those dispositions independently, and nothing checked the
 * two agreed (the module's own "NOT WIRED / a divergence will not be caught by
 * anything" banner). This ledger states, per surface, whether the shipped native
 * behaviour `conforms` to the decision or is `pending` (with a reason and a
 * limitation reference). `uxPolicyLedger.test.ts` fails when a surface is in
 * `UX_POLICY` but not here, or here but not in `UX_POLICY` — so a new surface, a
 * removed one, or a retint cannot land without a conformance decision. The
 * pending list is identity-ratcheted (shrink-only) by the test.
 *
 * @coordinates-with lib/browser/uxPolicy.ts — the decision matrix
 * @module lib/browser/uxPolicyLedger
 */

import type { UxSurface } from "./uxPolicy";

/** Whether the shipped native behaviour matches the decided disposition. */
export type Conformance = { state: "conforms" } | { state: "pending"; reason: string };

/**
 * The shipped state of each R12 surface. `conforms` = the native delegate does
 * what `UX_POLICY` decided; `pending` = a known, stated gap.
 *
 * Shrink-only: a `pending` entry is a promise to close it, and the test refuses
 * to let the list grow silently.
 */
export const UX_LEDGER: Readonly<Record<UxSurface, Conformance>> = {
  alert: { state: "conforms" },
  // confirm() IS surfaced: nav_delegate_macos.rs parks the completion block and
  // BrowserSurface renders Cancel/OK, answered through browser_dialog_respond.
  // The ledger said "suppressed" for weeks after it shipped (audit 2026-09-03).
  confirm: { state: "conforms" },
  prompt: { state: "pending", reason: "prompt() is suppressed — no runJavaScriptTextInputPanel delegate, the page receives null (browser.md Current limitations)" },
  "window-open": { state: "pending", reason: "window.open is blocked; the blocked address is recorded and offered as a new tab, but the page is not given a window (browser.md Current limitations)" },
  download: { state: "pending", reason: "downloads are not implemented (browser.md Current limitations)" },
  "file-upload": { state: "conforms" },
  // No `didReceiveAuthenticationChallenge` delegate exists, so WebKit's default
  // handling fails a basic-auth page with no prompt — the decided disposition
  // (native-prompt) is not shipped. Recorded as `conforms` until the 2026-09-03
  // audit, which is exactly the false record this ledger exists to prevent.
  "basic-auth": { state: "pending", reason: "no authentication-challenge delegate; a basic-auth page fails to load with no prompt" },
  "tls-error": { state: "conforms" },
  // No WKUIDelegate permission method is implemented, so the engine default
  // decides; whether that default is a silent denial has not been verified.
  "permission-camera": { state: "pending", reason: "engine default, unverified — no delegate method decides camera access" },
  "permission-mic": { state: "pending", reason: "engine default, unverified — no delegate method decides microphone access" },
  "permission-geolocation": { state: "pending", reason: "engine default, unverified — no delegate method decides geolocation" },
  "permission-notifications": { state: "pending", reason: "engine default, unverified — no delegate method decides notifications" },
  back: { state: "conforms" },
  forward: { state: "conforms" },
  reload: { state: "conforms" },
  stop: { state: "conforms" },
  find: { state: "pending", reason: "find-in-page is not implemented (no findString / find bar for browser tabs)" },
  zoom: { state: "pending", reason: "page zoom is not implemented (no pageZoom / magnification control)" },
  "context-menu": { state: "conforms" },
  print: { state: "conforms" },
  devtools: { state: "conforms" },
  pdf: { state: "conforms" },
  media: { state: "conforms" },
  fullscreen: { state: "conforms" },
};

/** Surfaces whose shipped behaviour is a known, stated gap. Shrink-only. */
export const PENDING_SURFACES: readonly UxSurface[] = (Object.keys(UX_LEDGER) as UxSurface[]).filter(
  (s) => UX_LEDGER[s].state === "pending",
);
