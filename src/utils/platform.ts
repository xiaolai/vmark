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

/** True on Windows. */
export function isWindowsPlatform(): boolean {
  return /win/i.test(navigator.platform);
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
