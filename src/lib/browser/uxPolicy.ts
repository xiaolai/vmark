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

/** Every browser UX surface R12 decides. */
export type UxSurface =
  | "alert"
  | "confirm"
  | "prompt"
  | "window-open"
  | "download"
  | "file-upload"
  | "basic-auth"
  | "tls-error"
  | "permission-camera"
  | "permission-mic"
  | "permission-geolocation"
  | "permission-notifications"
  | "back"
  | "forward"
  | "reload"
  | "stop"
  | "find"
  | "zoom"
  | "context-menu"
  | "print"
  | "devtools"
  | "pdf"
  | "media"
  | "fullscreen";

/** The v1 disposition for a surface. `"tbd"` is intentionally impossible to
 *  assign here — R12 forbids deferring the decision. */
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
  | "engine-default"
  | "tbd";

export const UX_SURFACES: readonly UxSurface[] = [
  "alert",
  "confirm",
  "prompt",
  "window-open",
  "download",
  "file-upload",
  "basic-auth",
  "tls-error",
  "permission-camera",
  "permission-mic",
  "permission-geolocation",
  "permission-notifications",
  "back",
  "forward",
  "reload",
  "stop",
  "find",
  "zoom",
  "context-menu",
  "print",
  "devtools",
  "pdf",
  "media",
  "fullscreen",
];

/** The decided R12 matrix — one disposition per surface, no gaps. */
export const UX_POLICY: Record<UxSurface, UxDisposition> = {
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
};

/** The v1 disposition for `surface`. */
export function dispositionFor(surface: UxSurface): UxDisposition {
  return UX_POLICY[surface];
}

/** Whether `surface` is a permission prompt (all denied silently in v1). */
export function isPermissionSurface(surface: UxSurface): boolean {
  return UX_POLICY[surface] === "deny-silent";
}

/** The AI may never choose an upload file — always false (WI-1.7 / R12). */
export function aiMayChooseUploadFile(): boolean {
  return false;
}

/** TLS/cert errors are a hard block — no click-through in v1. */
export function isTlsClickThroughAllowed(): boolean {
  return false;
}

/** Devtools is available only in debug builds. */
export function isDevtoolsAllowed(isDebugBuild: boolean): boolean {
  return isDebugBuild && UX_POLICY.devtools === "debug-only";
}
