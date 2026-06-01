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
