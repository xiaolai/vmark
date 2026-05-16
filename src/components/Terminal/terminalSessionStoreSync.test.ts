/**
 * Tests for buildCdCommand — the shell-quoting helper that wires workspace
 * root changes into live PTYs. Security-adjacent: the output is fed
 * directly into a running shell, so a single missed escape would inject
 * arbitrary commands into the user's session.
 *
 * The hook portion of terminalSessionStoreSync (the three subscribe()
 * effects) is out of scope; see #918.
 */
import { describe, it, expect } from "vitest";
import { buildCdCommand } from "./terminalSessionStoreSync";

describe("buildCdCommand", () => {
  it("wraps plain ASCII path in single quotes after Ctrl+U and trailing newline", () => {
    expect(buildCdCommand("/Users/alice/projects")).toBe(
      "\x15cd '/Users/alice/projects'\n",
    );
  });

  it("always prefixes Ctrl+U (\\x15) to clear partial input", () => {
    const out = buildCdCommand("/x");
    expect(out.startsWith("\x15")).toBe(true);
  });

  it("always terminates with exactly one \\n (not \\r\\n)", () => {
    const out = buildCdCommand("/x");
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\r\n")).toBe(false);
  });

  it("strips embedded \\n from the path", () => {
    expect(buildCdCommand("/a/\nb")).toBe("\x15cd '/a/b'\n");
  });

  it("strips embedded \\r from the path", () => {
    expect(buildCdCommand("/a/\rb")).toBe("\x15cd '/a/b'\n");
  });

  it("strips embedded \\r\\n from the path", () => {
    expect(buildCdCommand("/a/\r\nb")).toBe("\x15cd '/a/b'\n");
  });

  it("escapes a single-quote with POSIX close-escape-open idiom", () => {
    expect(buildCdCommand("/a/it's/b")).toBe("\x15cd '/a/it'\\''s/b'\n");
  });

  it("escapes multiple single-quotes in one path", () => {
    expect(buildCdCommand("/a/'/b/'/c")).toBe(
      "\x15cd '/a/'\\''/b/'\\''/c'\n",
    );
  });

  it("escapes a single-quote at the very start", () => {
    expect(buildCdCommand("'/a")).toBe("\x15cd ''\\''/a'\n");
  });

  it("escapes a single-quote at the very end", () => {
    expect(buildCdCommand("/a'")).toBe("\x15cd '/a'\\'''\n");
  });

  it("documents empty-path output (regression-pin)", () => {
    expect(buildCdCommand("")).toBe("\x15cd ''\n");
  });

  it("leaves spaces untouched (single-quote wrapping is sufficient)", () => {
    expect(buildCdCommand("/a b/c")).toBe("\x15cd '/a b/c'\n");
  });

  it("leaves double-quotes untouched (inside single-quoted string)", () => {
    expect(buildCdCommand('/a"b')).toBe(`\x15cd '/a"b'\n`);
  });
});
