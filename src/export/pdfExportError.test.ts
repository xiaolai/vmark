// @vitest-environment node
// WI-PDF1.2 — a typed CommandError from export_pdf must reach the user as its
// MESSAGE, never as "[object Object]".
//
// This is not hypothetical: a serialized CommandError is a plain object, and
// `String(object)` renders that literal. It shipped to users at four
// boundaries before the ratchet learned to see it (rule 50 §10).
import { describe, it, expect } from "vitest";
import { commandErrorMessage } from "@/services/commands/commandError";
import { errorMessage } from "@/utils/errorMessage";

/** Exactly the shape Rust serializes a CommandError as. */
const TIMEOUT = { code: "timeout", message: "PDF export timed out after 120 seconds" };
const NOT_FOUND = {
  code: "not-found",
  message: "Output directory does not exist",
  i18nKey: "errors.pdf.dirNotFound",
};

describe("export_pdf error rendering", () => {
  it("renders a typed rejection as its message", () => {
    expect(commandErrorMessage(TIMEOUT)).toBe("PDF export timed out after 120 seconds");
    expect(commandErrorMessage(NOT_FOUND)).toBe("Output directory does not exist");
  });

  it("never renders [object Object]", () => {
    for (const e of [TIMEOUT, NOT_FOUND]) {
      expect(commandErrorMessage(e)).not.toContain("[object Object]");
    }
  });

  // The regression this WI exists to prevent, stated as a contrast: the helper
  // the dialog used before produces exactly the broken string for these
  // payloads. If this ever stops being true the swap was pointless.
  it("is a real improvement over the helper it replaced", () => {
    expect(errorMessage(TIMEOUT)).toContain("[object Object]");
    expect(commandErrorMessage(TIMEOUT)).not.toContain("[object Object]");
  });

  it("still handles the plain-string and Error shapes the HTML path raises", () => {
    expect(commandErrorMessage("disk full")).toBe("disk full");
    expect(commandErrorMessage(new Error("boom"))).toBe("boom");
  });
});
