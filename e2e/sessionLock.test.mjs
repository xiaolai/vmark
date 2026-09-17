// @vitest-environment node
/**
 * The lock preflight that was never once right.
 *
 * `run-ime.mjs` refuses to inject keys into a locked session because a locked
 * session swallows them after the HID layer with no error anywhere — every
 * check then fails for a reason that has nothing to do with what it tests, and
 * any check shaped "the document did not change" PASSES.
 *
 * The AppleScript probe it used reported "unlocked" unconditionally (see
 * `lib/sessionLock.mjs` for the two independent reasons). Both fixtures below
 * are REAL `plutil -extract IOConsoleUsers` output captured on 2026-09-17 —
 * one from a machine with its screen locked, one unlocked — because the whole
 * failure was a probe tested only against what its author imagined the data
 * looked like.
 */
import { describe, it, expect } from "vitest";
import { isSessionLocked, CONSOLE_SESSION_COMMAND } from "./lib/sessionLock.mjs";

/** Real output, screen LOCKED (macOS 26.6.2). Trimmed to the keys that matter. */
const LOCKED = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<array>
	<dict>
		<key>CGSSessionScreenIsLocked</key>
		<true/>
		<key>CGSSessionScreenLockedTime</key>
		<integer>1789671234</integer>
		<key>kCGSSessionLoginwindowSafeLogin</key>
		<false/>
		<key>kCGSSessionOnConsoleKey</key>
		<true/>
	</dict>
</array>
</plist>`;

/** Real output, screen UNLOCKED. Note the key is ABSENT, not false. */
const UNLOCKED = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<array>
	<dict>
		<key>CGSSessionUniqueSessionUUID</key>
		<string>0000</string>
		<key>kCGSSessionLoginwindowSafeLogin</key>
		<false/>
		<key>kCGSSessionOnConsoleKey</key>
		<true/>
		<key>kCGSessionLoginDoneKey</key>
		<true/>
	</dict>
</array>
</plist>`;

describe("isSessionLocked", () => {
  it("reports a locked screen — the case the old probe could never report", () => {
    expect(isSessionLocked(LOCKED)).toBe(true);
  });

  it("reports an unlocked screen, where the key is absent rather than false", () => {
    expect(isSessionLocked(UNLOCKED)).toBe(false);
  });

  /**
   * The old probe's SECOND bug, in predicate form: it asked whether the key
   * existed. A session that carries the key explicitly set false is unlocked.
   */
  it("treats an explicit false as unlocked, not as 'the key is present'", () => {
    expect(isSessionLocked(UNLOCKED.replace(
      "<key>CGSSessionUniqueSessionUUID</key>\n\t\t<string>0000</string>",
      "<key>CGSSessionScreenIsLocked</key>\n\t\t<false/>",
    ))).toBe(false);
  });

  /**
   * The plist carries several neighbouring booleans. A regex that scans for
   * `<true/>` anywhere after the key name — the obvious way to write this —
   * reads `kCGSSessionOnConsoleKey`'s value and calls every session locked.
   */
  it("does not read a NEIGHBOURING key's value", () => {
    const falseThenNeighbourTrue = LOCKED.replace(
      "<key>CGSSessionScreenIsLocked</key>\n\t\t<true/>",
      "<key>CGSSessionScreenIsLocked</key>\n\t\t<false/>",
    );
    expect(falseThenNeighbourTrue).toContain("<key>kCGSSessionOnConsoleKey</key>\n\t\t<true/>");
    expect(isSessionLocked(falseThenNeighbourTrue)).toBe(false);
  });

  /**
   * Unreadable input must be impossible to mistake for "unlocked" — returning
   * a negative there is precisely the defect this module replaces.
   */
  it.each([["", "empty"], ["Error: no such key", "an ioreg failure"], [null, "null"]])(
    "throws rather than answering unlocked for %s (%s)",
    (input) => {
      expect(() => isSessionLocked(input)).toThrow(/console-session plist/);
    },
  );

  it("reads the session without AppleEvents, which a locked session cannot answer", () => {
    expect(CONSOLE_SESSION_COMMAND).toContain("ioreg");
    expect(CONSOLE_SESSION_COMMAND).not.toMatch(/osascript|System Events/);
  });
});
