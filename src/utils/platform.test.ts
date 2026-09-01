// @vitest-environment node
// WI-UA15 — cursor policy D7 scopes per platform via a root class
//           (audit 20260901): platformRootClass() names the class main.tsx
//           puts on <html>, which index.css maps to --cursor-interactive.
import { describe, it, expect, afterEach } from "vitest";
import {
  isMacPlatform,
  isWindowsPlatform,
  getRuntimePlatform,
  platformRootClass,
  usesOverlayTitleBar,
} from "./platform";

/** Override navigator.platform for the duration of a test. */
function setPlatform(value: string) {
  Object.defineProperty(navigator, "platform", { value, configurable: true });
}

const original = navigator.platform;

afterEach(() => {
  setPlatform(original);
});

describe("isMacPlatform", () => {
  it.each([
    ["MacIntel", true],
    ["macOS", true],
    ["Win32", false],
    ["Linux x86_64", false],
    ["", false],
  ])("platform=%s → %s", (value, expected) => {
    setPlatform(value);
    expect(isMacPlatform()).toBe(expected);
  });
});

describe("isWindowsPlatform", () => {
  it.each([
    ["Win32", true],
    ["Win64", true],
    ["Windows", true],
    ["WinCE", true],
    ["MacIntel", false],
    ["Linux x86_64", false],
    ["", false],
  ])("platform=%s → %s", (value, expected) => {
    setPlatform(value);
    expect(isWindowsPlatform()).toBe(expected);
  });

  // "Darwin" CONTAINS "win". An unanchored /win/i therefore called macOS
  // Windows, and getRuntimePlatform() would have case-folded paths for it —
  // silently merging two files whose names differ only in case. The match must
  // be a prefix, not a substring.
  it.each([["Darwin"], ["darwin"], ["Darwin Kernel Version 25.6.0"]])(
    "does not mistake %s for Windows",
    (value) => {
      setPlatform(value);
      expect(isWindowsPlatform()).toBe(false);
    }
  );
});

// #1296 — the app draws its own 40px chrome strip over the native title bar,
// but only where the Rust builder asks for it (TitleBarStyle::Overlay, which is
// `#[cfg(target_os = "macos")]`). Everywhere else the OS draws a real title bar
// above the app, and a second one inside it is a redundant empty strip.
describe("usesOverlayTitleBar", () => {
  it.each([
    ["MacIntel", true],
    ["macOS", true],
    ["Win32", false],
    ["Windows", false],
    ["Linux x86_64", false],
    ["", false],
  ])("platform=%s → %s", (value, expected) => {
    setPlatform(value);
    expect(usesOverlayTitleBar()).toBe(expected);
  });

  it("agrees with isMacPlatform on every platform string", () => {
    for (const value of ["MacIntel", "Win32", "Linux x86_64", "FreeBSD", ""]) {
      setPlatform(value);
      expect(usesOverlayTitleBar()).toBe(isMacPlatform());
    }
  });
});

describe("getRuntimePlatform", () => {
  it.each([
    ["MacIntel", "macos"],
    ["macOS", "macos"],
    ["Win32", "windows"],
    ["Windows", "windows"],
    ["Linux x86_64", "linux"],
    ["", "linux"],
    // Path identity is case-insensitive on Windows only, so a misread here
    // silently changes which two paths count as the same file.
    ["Darwin", "linux"],
  ])("platform=%s → %s", (value, expected) => {
    setPlatform(value);
    expect(getRuntimePlatform()).toBe(expected);
  });
});

describe("platformRootClass (WI-UA15)", () => {
  it.each([
    ["MacIntel", "platform-macos"],
    ["Win32", "platform-windows"],
    ["Linux x86_64", "platform-linux"],
    // jsdom / unknown platforms fall through to linux, like getRuntimePlatform.
    ["", "platform-linux"],
  ])("platform=%s → %s", (value, expected) => {
    setPlatform(value);
    expect(platformRootClass()).toBe(expected);
  });

  it("always agrees with getRuntimePlatform", () => {
    for (const value of ["MacIntel", "Win32", "Linux x86_64", "Darwin", ""]) {
      setPlatform(value);
      expect(platformRootClass()).toBe(`platform-${getRuntimePlatform()}`);
    }
  });
});
