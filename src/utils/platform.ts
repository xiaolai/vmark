/**
 * Platform detection helpers.
 *
 * Purpose: centralize the `navigator.platform` sniffing that several UI
 *   surfaces use to gate OS-specific controls (e.g. macOS-only terminal
 *   options, Unix-only shell integration). Functions read `navigator`
 *   at call time so tests can override `navigator.platform`.
 *
 * @module utils/platform
 */

/** True on macOS. */
export function isMacPlatform(): boolean {
  return /mac/i.test(navigator.platform);
}

/**
 * True on Windows.
 *
 * Anchored, because `"Darwin"` CONTAINS "win": an unanchored `/win/i` reported
 * macOS as Windows, and `getRuntimePlatform()` would then have applied
 * case-insensitive path identity to it — two files differing only in case would
 * have counted as one. Every real value is a prefix match (`Win32`, `Win64`,
 * `WinCE`, `Windows`).
 */
export function isWindowsPlatform(): boolean {
  return /^win/i.test(navigator.platform);
}

/**
 * True where the app draws its own chrome OVER the native title bar.
 *
 * The window builder asks for that mode under `#[cfg(target_os = "macos")]`
 * only (`TitleBarStyle::Overlay` + `hidden_title`), so everywhere else the OS
 * draws a real, visible title bar above the webview. Two things follow, and
 * both were wrong before #1296: the app's own 40px chrome strip is a second,
 * redundant title bar off macOS, and the native title text — which macOS hides
 * — is the only place a filename can appear there.
 *
 * Named for the property rather than the OS because that is what every call
 * site actually depends on. Note a module mock of `isMacPlatform` does NOT
 * reach this function's internal call; tests that need to steer it must mock
 * this export directly.
 *
 * @coordinates-with src-tauri/src/window_manager/document_windows.rs — the cfg that must agree
 */
export function usesOverlayTitleBar(): boolean {
  return isMacPlatform();
}

/** Platform identifiers used for path identity / root normalization. */
export type RuntimePlatform = "macos" | "windows" | "linux";

/**
 * Resolve the runtime OS for path-identity normalization. Read at call time so
 * tests can override `navigator.platform`. Defaulting blindly to "macos" at
 * call boundaries silently mis-normalizes Windows/Linux paths (duplicate
 * detection, ownership identity) — derive it here instead.
 */
export function getRuntimePlatform(): RuntimePlatform {
  if (isMacPlatform()) return "macos";
  if (isWindowsPlatform()) return "windows";
  return "linux";
}

/**
 * The root class main.tsx puts on `<html>` at bootstrap (WI-UA15). CSS keys
 * platform-scoped policy off it — today only the D7 cursor split:
 * `index.css` maps `.platform-windows` / `.platform-linux` to
 * `--cursor-interactive: pointer`, so interactive chrome keeps the Apple HIG
 * arrow on macOS and gives the pointer feedback webview-app users expect
 * elsewhere. Derived, never authored: one source of platform truth.
 */
export function platformRootClass(): `platform-${RuntimePlatform}` {
  return `platform-${getRuntimePlatform()}`;
}
