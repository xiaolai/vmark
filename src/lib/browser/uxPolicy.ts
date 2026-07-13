/**
 * Browser UX surface policy — the decided R12 per-surface matrix (WI-1.7).
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

/** The AI may never choose an upload file (WI-1.7 / R12) — derived from the
 *  policy so it cannot contradict the matrix: only a human picker is allowed. */
export function aiMayChooseUploadFile(): boolean {
  return dispositionFor("file-upload") !== "human-picker";
}

/** TLS/cert errors are a hard block — no click-through in v1. Derived from the
 *  matrix for the same reason. */
export function isTlsClickThroughAllowed(): boolean {
  return dispositionFor("tls-error") !== "deny-hard";
}

/** Devtools is available only in debug builds. */
export function isDevtoolsAllowed(isDebugBuild: boolean): boolean {
  return isDebugBuild && UX_POLICY.devtools === "debug-only";
}
