// @vitest-environment node
// WI-4.1 — session-name normalization, tested directly.
//
// The rename flow is covered end-to-end in TerminalTabBar.test.tsx, but the
// normalization rules are the security-and-hygiene part (a pasted name can
// carry invisible control characters, and naive truncation can cut a surrogate
// pair in half), so they get their own table rather than being reachable only
// through a rendered component.
import { describe, it, expect } from "vitest";
import {
  normalizeSessionName,
  MAX_SESSION_NAME_LENGTH,
} from "./TerminalTabRename";

describe("normalizeSessionName (WI-4.1)", () => {
  it.each([
    ["build", "build"],
    ["  build  ", "build"],
    ["api server", "api server"],
  ])("keeps an ordinary name %j → %j", (input, expected) => {
    expect(normalizeSessionName(input)).toBe(expected);
  });

  it.each([
    ["", "empty"],
    ["   ", "spaces"],
    ["\t\n", "tab/newline"],
    ["", "C0 controls"],
    ["", "DEL"],
    ["", "C1 controls"],
  ])("rejects %j (%s) as having no name in it", (input) => {
    expect(normalizeSessionName(input)).toBeNull();
  });

  it("strips control characters from inside a real name", () => {
    // C1 in particular is invisible and some terminals treat it as an escape
    // introducer, so it must not survive into a tab label.
    expect(normalizeSessionName("build")).toBe("build");
    expect(normalizeSessionName("ab")).toBe("ab");
  });

  it("collapses internal whitespace runs", () => {
    expect(normalizeSessionName("api    server")).toBe("api server");
    expect(normalizeSessionName("a\t\tb")).toBe("a b");
  });

  it("turns a pasted multi-line name into one spaced line, not one welded word", () => {
    // Tab/LF/CR are whitespace, not hidden control junk — filtering them out
    // as "controls" would produce "ab" from "a\n\nb".
    expect(normalizeSessionName("a\n\nb")).toBe("a b");
    expect(normalizeSessionName("build\r\nserver")).toBe("build server");
  });

  it("truncates by CODE POINT, never splitting a surrogate pair", () => {
    // `.slice()` on a string counts UTF-16 code units, so an emoji straddling
    // the boundary would be stored as a lone surrogate.
    const emoji = "🚀";
    const name = emoji.repeat(MAX_SESSION_NAME_LENGTH + 10);
    const out = normalizeSessionName(name)!;
    expect(Array.from(out)).toHaveLength(MAX_SESSION_NAME_LENGTH);
    // Every retained unit is a whole emoji — no lone surrogates.
    expect(Array.from(out).every((ch) => ch === emoji)).toBe(true);
  });

  it("leaves a name at exactly the cap untouched", () => {
    const name = "z".repeat(MAX_SESSION_NAME_LENGTH);
    expect(normalizeSessionName(name)).toBe(name);
  });

  it("caps an over-long ASCII name", () => {
    const out = normalizeSessionName("z".repeat(MAX_SESSION_NAME_LENGTH * 2))!;
    expect(out).toHaveLength(MAX_SESSION_NAME_LENGTH);
  });

  it("preserves CJK and emoji that fit", () => {
    expect(normalizeSessionName("编译 🚀")).toBe("编译 🚀");
  });
});
