/**
 * Console-session lock state, read from ioreg.
 *
 * WHY THIS IS NOT ASKED IN APPLESCRIPT. `run-ime.mjs` used to probe it with
 * `CGSessionCopyCurrentDictionary()` via `use framework "Foundation"` — a
 * CoreGraphics C function Foundation does not export. The call raised, a bare
 * `try` swallowed it, and the probe returned "unlocked" UNCONDITIONALLY.
 * Measured 2026-09-17 against a genuinely locked Mac: ground truth `<true/>`,
 * probe "unlocked".
 *
 * The same three lines carried a second, opposite bug: the test was
 * `CGSSessionScreenIsLocked ... is not missing value`, which asks whether the
 * KEY EXISTS rather than what it says. Had the call ever worked it would have
 * reported "locked" on an unlocked session too. Two errors pointing opposite
 * ways is why neither was ever noticed — the probe was never once right, and
 * never once looked wrong.
 *
 * ioreg needs no framework bridge and no AppleEvents, and that is the property
 * that matters: a locked session is exactly when an AppleEvent to a GUI app
 * hangs instead of answering, so the old approach was least able to work
 * precisely when its answer mattered.
 *
 * @module e2e/lib/sessionLock
 */

/** The shell pipeline that yields the console-session plist. */
export const CONSOLE_SESSION_COMMAND =
  "ioreg -n Root -d1 -a | plutil -extract IOConsoleUsers xml1 -o - -";

/**
 * Whether the console session's screen is locked.
 *
 * Measured key shapes (macOS 26.6): when UNLOCKED the key is absent from the
 * plist entirely; when LOCKED it is present as `<true/>` (alongside
 * `CGSSessionScreenLockedTime`). Only an explicit `<true/>` on THIS key counts
 * — the plist carries several neighbouring booleans, so the value must be
 * matched adjacent to its own key and never scanned for loosely.
 *
 * THROWS on input that is not a console-session plist. Answering "unlocked"
 * for unreadable input is the exact defect this module replaces, so the
 * unreadable case must be impossible to mistake for a negative.
 */
export function isSessionLocked(consoleUsersXml) {
  if (typeof consoleUsersXml !== "string" || !consoleUsersXml.includes("<plist")) {
    throw new Error("not a console-session plist — cannot determine lock state");
  }
  return /<key>CGSSessionScreenIsLocked<\/key>\s*<true\/>/.test(consoleUsersXml);
}
