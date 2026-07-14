/**
 * Browser UX surface policy — the decided R12 per-surface matrix (WI-1.7).
 *
 * ⚠️ **NOT WIRED. This module has no production importers.** It is a decision record, not
 * an enforcement point: the native delegates implement their dispositions independently,
 * and nothing reads this matrix at runtime. Treat it as the spec it is — a divergence
 * between it and the native code will not be caught by anything here.
 *
 * Purpose: the single source of truth for how the embedded browser handles every
 * UX surface a real browser must — JS dialogs, popups, downloads, uploads, auth,
 * TLS errors, permission prompts, history/find/zoom, context menu, print,
 * devtools. R12 requires a *decided* disposition for each (no "TBD"): this module
 * encodes that matrix, and the native `WKUIDelegate`/`WKNavigationDelegate`/
 * `WKDownloadDelegate` handlers (WI-1.7 Rust) implement each row against it.
 *
 * Security-load-bearing rules live here as functions so they cannot drift: the
 * AI may NEVER choose an upload file (exfiltration path), TLS/cert errors are a
 * hard block with no click-through in v1, and camera/mic/geolocation/notification
 * permissions are denied silently.
 *
 * @coordinates-with (future) src-tauri browser delegates — implement each row
 * @module lib/browser/uxPolicy
 */

/** The v1 disposition for a surface. There is deliberately no `"tbd"` member:
 *  R12 forbids deferring the decision, and the type — not a runtime check — is
 *  what makes a placeholder unrepresentable. */
export type UxDisposition =
  | "native-dialog"
  | "new-tab"
  | "confirm-destination"
  | "human-picker"
  | "native-prompt"
  | "deny-hard"
  | "deny-silent"
  | "implement"
  | "implement-minimal"
  | "unsupported"
  | "debug-only"
  | "engine-default";

/**
 * The decided R12 matrix — one disposition per surface, no gaps. This object is
 * the single canonical inventory: `UxSurface` and `UX_SURFACES` are DERIVED from
 * it, so a surface cannot exist in one list and be missing from another.
 */
export const UX_POLICY = {
  alert: "native-dialog",
  confirm: "native-dialog",
  prompt: "native-dialog",
  "window-open": "new-tab",
  download: "confirm-destination",
  "file-upload": "human-picker",
  "basic-auth": "native-prompt",
  "tls-error": "deny-hard",
  "permission-camera": "deny-silent",
  "permission-mic": "deny-silent",
  "permission-geolocation": "deny-silent",
  "permission-notifications": "deny-silent",
  back: "implement",
  forward: "implement",
  reload: "implement",
  stop: "implement",
  find: "implement",
  zoom: "implement",
  "context-menu": "implement-minimal",
  print: "unsupported",
  devtools: "debug-only",
  pdf: "engine-default",
  media: "engine-default",
  fullscreen: "engine-default",
} as const satisfies Readonly<Record<string, UxDisposition>>;

/** Every browser UX surface R12 decides — derived from the policy itself. */
export type UxSurface = keyof typeof UX_POLICY;

/** The surface inventory, derived from `UX_POLICY` (never hand-maintained). */
export const UX_SURFACES: readonly UxSurface[] = Object.keys(UX_POLICY) as UxSurface[];

/** Permission prompts are identified by WHAT THEY ARE, not by their current
 *  disposition — a future surface that also denies silently is not a permission. */
const PERMISSION_PREFIX = "permission-";

/** The v1 disposition for `surface`. */
export function dispositionFor(surface: UxSurface): UxDisposition {
  return UX_POLICY[surface];
}

/** Whether `surface` is a permission prompt (all denied silently in v1). */
export function isPermissionSurface(surface: UxSurface): boolean {
  return surface.startsWith(PERMISSION_PREFIX);
}

/** The AI may never choose an upload file (WI-1.7 / R12). Unconditional in v1: there
 *  is no "ai-upload" disposition, so the answer is always no. This must NOT be derived
 *  from the matrix with a negative check (`!== "human-picker"`) — that inverts the
 *  invariant: any future retint of `file-upload` to another disposition would silently
 *  flip this to `true` and open the exfiltration path. The security rule does not
 *  depend on the matrix, so neither does this function. */
export function aiMayChooseUploadFile(): boolean {
  return false;
}

/** TLS/cert errors are a hard block — no click-through in v1. Unconditional for the
 *  same reason: no "allow-click-through" disposition exists, and a matrix-derived
 *  negative check (`!== "deny-hard"`) would treat any other disposition as permission.
 *  Fail closed. */
export function isTlsClickThroughAllowed(): boolean {
  return false;
}

/** Devtools is available only in debug builds. */
export function isDevtoolsAllowed(isDebugBuild: boolean): boolean {
  return isDebugBuild && UX_POLICY.devtools === "debug-only";
}
