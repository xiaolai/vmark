// @vitest-environment node
// WI-CJKF6.2 — `cjk-format` must not report a REFUSAL as success.
//
// `formatMarkdownChecked` returns the original text both when nothing needed
// changing and when the integrity check rejected the result. The MCP caller
// sees only the returned content, so without this branch a corrupt-output
// refusal is indistinguishable from a clean no-op — and the AI would record
// "the document is already formatted".
//
// The refusal branch is unreachable through the real formatter (it fires only
// on a formatter bug), so the formatter is mocked here. That is a boundary
// mock, not a mock of the subject: the subject is `applyTransform`'s handling
// of the flag.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/cjkFormatter", () => ({
  formatMarkdownChecked: vi.fn(() => ({ text: "ORIGINAL", refused: true })),
}));
import { applyTransform } from "./documentTransform";
import { DEFAULT_CJK_FORMATTING } from "@/lib/cjkFormatter/types";

const SETTINGS = { cjkFormatting: DEFAULT_CJK_FORMATTING, preserveTwoSpaceHardBreaks: true };

describe("cjk-format under a refusing formatter", () => {
  it("throws instead of returning the unchanged content", () => {
    expect(() => applyTransform("cjk-format", "ORIGINAL", SETTINGS)).toThrow(/refused/i);
  });

  it("does not swallow the reason", () => {
    expect(() => applyTransform("cjk-format", "ORIGINAL", SETTINGS)).toThrow(
      /did not match the input/i
    );
  });

  it("leaves the narrow transforms unaffected — they have no integrity check", () => {
    expect(applyTransform("cjk-spacing", "中文English", SETTINGS)).toBe("中文 English");
  });
});
