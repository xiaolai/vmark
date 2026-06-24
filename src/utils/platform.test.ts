import { describe, it, expect, afterEach } from "vitest";
import { isMacPlatform, isWindowsPlatform, getRuntimePlatform } from "./platform";

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
    ["Windows", true],
    ["MacIntel", false],
    ["Linux x86_64", false],
    ["", false],
  ])("platform=%s → %s", (value, expected) => {
    setPlatform(value);
    expect(isWindowsPlatform()).toBe(expected);
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
  ])("platform=%s → %s", (value, expected) => {
    setPlatform(value);
    expect(getRuntimePlatform()).toBe(expected);
  });
});
