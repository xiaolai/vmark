// @vitest-environment node
/**
 * Audit 20260804-F7 — the rule-chain pass cap must not fail silently.
 *
 * `applyRules` iterates the rule chain to a fixed point behind an 8-pass cap.
 * On exhaustion it used to `return prev` with nothing said, so a document that
 * needed a ninth pass came back not-quite-normalized — and since the whole
 * reason for the loop is `format(format(x)) === format(x)`, the NEXT "Format
 * CJK File" would edit the document again. That is a silent, repeating diff
 * on the user's file with no signal anywhere.
 *
 * The cap is reachable without a rule cycle: fullwidth parenthesis conversion
 * matches the INNERMOST pair only (its content class excludes ASCII parens),
 * so nesting depth N needs N passes. That gives a real input for the boundary
 * instead of an injected fake.
 *
 * Mock boundary: the CJK warn logger only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ cjkFmtWarn: vi.fn() }));

vi.mock("@/utils/debug", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  cjkFmtWarn: (...args: unknown[]) => mocks.cjkFmtWarn(...args),
}));

import { MAX_RULE_PASSES, applyRules } from "./applyRules";
import { DEFAULT_CJK_FORMATTING } from "../types";

/** `(中(中(…中…)))` — one convertible parenthesis level per nesting depth. */
function nested(depth: number): string {
  return `${"(中".repeat(depth)}文${")".repeat(depth)}`;
}

beforeEach(() => {
  mocks.cjkFmtWarn.mockReset();
});

describe("applyRules pass cap", () => {
  it("stays silent on text that converges", () => {
    const out = applyRules("中文,测试", DEFAULT_CJK_FORMATTING);
    expect(out).toContain("，");
    expect(mocks.cjkFmtWarn).not.toHaveBeenCalled();
  });

  it("stays silent at a nesting depth the cap can absorb", () => {
    applyRules(nested(2), DEFAULT_CJK_FORMATTING);
    expect(mocks.cjkFmtWarn).not.toHaveBeenCalled();
  });

  it("warns when the chain has not converged within the cap", () => {
    applyRules(nested(MAX_RULE_PASSES + 4), DEFAULT_CJK_FORMATTING);

    expect(mocks.cjkFmtWarn).toHaveBeenCalledTimes(1);
    const [message, detail] = mocks.cjkFmtWarn.mock.calls[0];
    expect(String(message)).toMatch(/did not converge/i);
    expect(detail).toMatchObject({ passes: MAX_RULE_PASSES });
  });

  it("returns the LAST pass rather than the input or an empty string", () => {
    const input = nested(MAX_RULE_PASSES + 4);
    const out = applyRules(input, DEFAULT_CJK_FORMATTING);

    expect(mocks.cjkFmtWarn).toHaveBeenCalled();
    expect(out).not.toBe("");
    expect(out).not.toBe(input);
    // Progress was made and kept: the innermost levels did convert.
    expect(out).toContain("（");
    expect(out).toContain("文");
  });

  it("does not leak document text into the log", () => {
    // The log file is something users attach to bug reports.
    const secret = "机密内容";
    applyRules(`${"(中".repeat(20)}${secret}${")".repeat(20)}`, DEFAULT_CJK_FORMATTING);

    const logged = JSON.stringify(mocks.cjkFmtWarn.mock.calls);
    expect(logged).not.toContain(secret);
    expect(logged).toContain("inputLength");
  });

  it("reports once per call, not once per pass", () => {
    applyRules(nested(MAX_RULE_PASSES + 4), DEFAULT_CJK_FORMATTING);
    expect(mocks.cjkFmtWarn).toHaveBeenCalledTimes(1);
  });
});
