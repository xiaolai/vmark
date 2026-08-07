// @vitest-environment node
/**
 * Tests for diagnosticToCM — verifies message translation and offset clamping.
 */
import { describe, it, expect } from "vitest";
import { diagnosticToCM } from "./sourceLint";
import type { LintDiagnostic } from "@/lib/lintEngine/types";

function makeDiagnostic(overrides: Partial<LintDiagnostic> = {}): LintDiagnostic {
  return {
    ruleId: "E01",
    severity: "error",
    messageKey: "lint.E01",
    messageParams: { ref: "foo" },
    line: 1,
    column: 1,
    offset: 0,
    uiHint: "exact",
    ...overrides,
  };
}

describe("diagnosticToCM", () => {
  it("sets severity to 'error' for error diagnostics", () => {
    const cm = diagnosticToCM(100, makeDiagnostic({ severity: "error" }));
    expect(cm.severity).toBe("error");
  });

  it("sets severity to 'warning' for warning diagnostics", () => {
    const cm = diagnosticToCM(100, makeDiagnostic({ severity: "warning" }));
    expect(cm.severity).toBe("warning");
  });

  it("clamps offset to docLength", () => {
    const cm = diagnosticToCM(5, makeDiagnostic({ offset: 10 }));
    expect(cm.from).toBeLessThanOrEqual(5);
  });

  it("ensures to >= from", () => {
    const cm = diagnosticToCM(100, makeDiagnostic({ offset: 5, endOffset: 3 }));
    expect(cm.to).toBeGreaterThanOrEqual(cm.from);
  });

  it("translates messageKey — message is not the raw key", () => {
    const cm = diagnosticToCM(100, makeDiagnostic({ messageKey: "lint.E01", messageParams: { ref: "foo" } }));
    // Should contain the translated text, not the raw key "lint.E01"
    expect(cm.message).not.toBe("lint.E01");
    expect(cm.message).toContain("foo");
  });

  it("translates lint.W03 key with ref param", () => {
    const cm = diagnosticToCM(100, makeDiagnostic({ severity: "warning", messageKey: "lint.W03", messageParams: { ref: "myref" } }));
    expect(cm.message).not.toBe("lint.W03");
    expect(cm.message).toContain("myref");
  });

  it("translates lint.E08 key (no params)", () => {
    const cm = diagnosticToCM(100, makeDiagnostic({ messageKey: "lint.E08", messageParams: {} }));
    expect(cm.message).not.toBe("lint.E08");
    // Should be a non-empty human-readable string
    expect(cm.message.length).toBeGreaterThan(0);
  });
});
