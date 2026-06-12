// Diagnostic message translation (audit 20260612 H18).
//
// The diagnostics.GHA-* locale keys existed in every locale but were never
// consumed — DiagnosticsBanner rendered the parser's hardcoded English
// message. diagnosticMessage() resolves via the stable code with the
// diagnostic's context interpolated, never leaking unfilled {{placeholders}}.

import { describe, it, expect } from "vitest";
import type { Diagnostic } from "@/lib/ghaWorkflow/types";
import { diagnosticMessage } from "./diagnosticI18n";

function makeDiag(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return {
    severity: "error",
    code: "GHA-JOB-001",
    message: "Duplicate job id `build`",
    ...overrides,
  } as Diagnostic;
}

describe("diagnosticMessage", () => {
  it("translates via the code key, interpolating context", () => {
    const t = (key: string, opts?: Record<string, unknown>) => {
      expect(key).toBe("diagnostics.GHA-JOB-001");
      return `Doppelte Job-ID \`${opts?.jobId as string}\``;
    };
    const msg = diagnosticMessage(t, makeDiag({ context: { jobId: "build" } }));
    expect(msg).toBe("Doppelte Job-ID `build`");
  });

  it("passes the English message as defaultValue", () => {
    const t = (_key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue ?? "";
    expect(diagnosticMessage(t, makeDiag())).toBe("Duplicate job id `build`");
  });

  it("falls back to the English message when placeholders stay unfilled", () => {
    // Diagnostic without context, but the locale template needs {{jobId}} —
    // showing a literal placeholder would be worse than English.
    const t = () => "Doppelte Job-ID `{{jobId}}`";
    expect(diagnosticMessage(t, makeDiag({ context: undefined }))).toBe(
      "Duplicate job id `build`"
    );
  });

  it("accepts fully-resolved translations without placeholders", () => {
    const t = () => "YAML 格式错误";
    expect(
      diagnosticMessage(t, makeDiag({ code: "GHA-PARSE-001", message: "Malformed YAML" }))
    ).toBe("YAML 格式错误");
  });
});
