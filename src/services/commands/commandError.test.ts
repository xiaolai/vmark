// @vitest-environment node
/**
 * WI-14 — the TypeScript twin of Rust's `CommandError`.
 *
 * Every wire value here comes from `src/test/fixtures/commandErrorWire.json`,
 * which the Rust test `frontend_wire_fixture_stays_in_sync` GENERATES from the
 * real types (and, for the save path, by invoking the real command core). That
 * is the anti-drift bond: a hand-written `{ code: "not-found" }` literal in this
 * file would keep passing after Rust renamed the code, which is exactly the
 * failure mode the string-sniffing it replaces already had.
 *
 * No module is mocked here — the unit under test is pure.
 *
 * @module services/commands/commandError.test
 */
import { describe, it, expect } from "vitest";
import wire from "@/test/fixtures/commandErrorWire.json";
import {
  parseCommandError,
  isCommandErrorCode,
  classifyCommandError,
  commandErrorMessage,
  COMMAND_ERROR_CODES,
  type CommandErrorClass,
  type CommandErrorCode,
} from "./commandError";

const byCode = wire.byCode as Record<string, unknown>;

describe("parseCommandError", () => {
  it("parses every code Rust can emit", () => {
    for (const [code, value] of Object.entries(byCode)) {
      const parsed = parseCommandError(value);
      expect(parsed, `code ${code} must parse`).not.toBeNull();
      expect(parsed?.code).toBe(code);
      expect(parsed?.message).toBe("boom");
    }
  });

  it("covers exactly the codes Rust ships — no more, no fewer", () => {
    // Two-way: a Rust-side addition fails here until the classification table
    // decides what the UI should do about it, and a stale frontend code fails
    // once Rust drops it.
    expect([...COMMAND_ERROR_CODES].sort()).toEqual(Object.keys(byCode).sort());
  });

  it("keeps i18nKey and detail when present", () => {
    const parsed = parseCommandError(wire.saveParentMissing);
    expect(parsed?.i18nKey).toBe("errors.save.parentMissing");
    expect(parsed?.detail).toEqual({ dir: "/vmark-fixture-no-such-dir/notes" });
  });

  it("leaves i18nKey and detail undefined when the wire omits them", () => {
    const parsed = parseCommandError(byCode["io"]);
    expect(parsed?.i18nKey).toBeUndefined();
    expect(parsed?.detail).toBeUndefined();
  });

  it("accepts an unrecognised code so a newer backend is still readable", () => {
    // Rejecting it would make every future Rust code look like a legacy string
    // and lose the message the user should see.
    const parsed = parseCommandError({ code: "teapot", message: "short and stout" });
    expect(parsed?.code).toBe("teapot");
    expect(parsed?.message).toBe("short and stout");
  });

  it.each([
    ["a legacy plain string", "PARENT_MISSING:/Users/x/gone"],
    ["an Error instance", new Error("boom")],
    ["null", null],
    ["undefined", undefined],
    ["a number", 42],
    ["an array", ["code", "message"]],
    ["an object with no code", { message: "boom" }],
    ["an object with no message", { code: "io" }],
    ["an object with a non-string code", { code: 7, message: "boom" }],
    ["an object with a non-string message", { code: "io", message: 7 }],
  ])("returns null for %s", (_label, value) => {
    expect(parseCommandError(value)).toBeNull();
  });

  it("ignores a non-object detail rather than pretending it is a record", () => {
    const parsed = parseCommandError({ code: "io", message: "boom", detail: "not-an-object" });
    expect(parsed?.detail).toBeUndefined();
  });

  it("round-trips CJK message and detail byte-faithfully", () => {
    const parsed = parseCommandError(wire.cjk);
    expect(parsed?.message).toBe("文件被占用");
    expect(parsed?.detail).toEqual({ path: "/用户/笔记/日记.md" });
  });
});

describe("isCommandErrorCode", () => {
  it("matches the exact code and nothing else", () => {
    expect(isCommandErrorCode(wire.saveParentMissing, "not-found")).toBe(true);
    expect(isCommandErrorCode(wire.saveParentMissing, "io")).toBe(false);
  });

  it("does not match a legacy string that merely contains the code", () => {
    // The whole point: `String(error).includes("APPROVAL_REQUIRED")` matched a
    // substring anywhere in the text, including inside a URL the caller passed.
    expect(isCommandErrorCode("approval-required somewhere in prose", "approval-required")).toBe(
      false,
    );
  });

  it("matches the browser approval refusal the MCP bridge branches on", () => {
    expect(isCommandErrorCode(wire.browserApprovalRequired, "approval-required")).toBe(true);
    // …and NOT the refusal no approval can lift.
    expect(isCommandErrorCode(wire.browserApprovalRequired, "permission-denied")).toBe(false);
  });
});

describe("classifyCommandError", () => {
  const table: Array<[CommandErrorCode, CommandErrorClass]> = [
    ["invalid-input", "fatal"],
    ["not-found", "fatal"],
    ["permission-denied", "denied"],
    ["approval-required", "needs-approval"],
    ["conflict", "retryable"],
    ["io", "retryable"],
    ["network", "retryable"],
    ["timeout", "retryable"],
    ["cancelled", "cancelled"],
    ["feature-disabled", "unavailable"],
    ["unsupported", "unavailable"],
    ["internal", "fatal"],
  ];

  it("classifies every shipped code", () => {
    expect(table.length).toBe(COMMAND_ERROR_CODES.length);
    for (const [code, expected] of table) {
      expect(classifyCommandError(byCode[code]), code).toBe(expected);
    }
  });

  it.each([
    ["an unknown code", { code: "teapot", message: "?" }],
    ["a legacy plain string", "PARENT_MISSING:/x"],
    ["an Error instance", new Error("disk full")],
    ["undefined", undefined],
  ])("falls back to fatal for %s", (_label, value) => {
    // "fatal" is the safe default: it surfaces the failure instead of silently
    // retrying or swallowing it.
    expect(classifyCommandError(value)).toBe("fatal");
  });

  describe("indeterminate execution (audit 20260903 round 3, #18)", () => {
    // The wire shape `eval_outcome::eval_failure(EvalFailure::Timeout)` produces —
    // `eval_outcome.test.rs` pins `detail.indeterminate === true` on the serialized
    // value and the token; the code itself comes from the generated fixture.
    const withDetail = (code: string, detail: Record<string, unknown>) => ({
      ...(byCode[code] as Record<string, unknown>),
      detail,
    });
    const evalTimeout = withDetail("timeout", { kind: "timeout", mcpCode: "EVAL_TIMEOUT", indeterminate: true });

    it("demotes a retryable class to indeterminate when the effect is unknown", () => {
      // Nothing cancels an enqueued script: a `timeout` here may still land, and
      // a blind retry can perform a mutating act twice.
      expect(classifyCommandError(evalTimeout)).toBe("indeterminate");
    });

    it("leaves a plain timeout retryable", () => {
      expect(classifyCommandError(byCode["timeout"])).toBe("retryable");
      expect(classifyCommandError(withDetail("timeout", { kind: "timeout" }))).toBe("retryable");
    });

    it.each(["io", "network", "conflict"] as const)("applies to every retryable class (%s)", (code) => {
      expect(classifyCommandError(withDetail(code, { indeterminate: true }))).toBe("indeterminate");
    });

    it("never lifts a non-retryable class — the flag only stops blind retries", () => {
      for (const [code, expected] of table) {
        if (expected === "retryable") continue;
        expect(classifyCommandError(withDetail(code, { indeterminate: true })), code).toBe(expected);
      }
    });

    it.each([
      ["a truthy non-boolean", "yes"],
      ["a number", 1],
      ["false", false],
      ["null", null],
    ])("ignores %s — the flag is exactly `true`", (_label, flag) => {
      expect(classifyCommandError(withDetail("timeout", { indeterminate: flag }))).toBe("retryable");
    });
  });
});

describe("commandErrorMessage", () => {
  it.each([
    ["a typed error", wire.browserApprovalRequired, "This page needs your approval before the AI can open it"],
    ["a legacy plain string", "PARENT_MISSING:/x", "PARENT_MISSING:/x"],
    ["an Error instance", new Error("disk full"), "disk full"],
    ["a CJK typed error", wire.cjk, "文件被占用"],
  ])("reads %s", (_label, value, expected) => {
    expect(commandErrorMessage(value)).toBe(expected);
  });

  it("never returns [object Object] for an unparseable object", () => {
    // The regression this function exists to prevent: the old
    // `errorMessage(e)` on a typed rejection produced "[object Object]".
    const text = commandErrorMessage({ unexpected: true });
    expect(text).not.toContain("[object Object]");
    expect(text.length).toBeGreaterThan(0);
  });

  it("returns a non-empty string for null and undefined", () => {
    expect(commandErrorMessage(null).length).toBeGreaterThan(0);
    expect(commandErrorMessage(undefined).length).toBeGreaterThan(0);
  });
});
