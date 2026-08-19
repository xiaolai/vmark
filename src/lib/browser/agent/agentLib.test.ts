// WI-NB1.1 — the injected library's ASSEMBLY. Behaviour is tested where it is
// executed (actScript.test.ts in jsdom, actScript.webkit.test.ts in real
// WebKit, both through the builders); this pins that the assembled library
// actually carries every section, so a dropped concat member cannot ship as a
// page-side ReferenceError.
import { describe, it, expect } from "vitest";
import { AGENT_LIB } from "./agentLib";

describe("AGENT_LIB assembly", () => {
  it.each([
    "__vmarkRole",
    "__vmarkName",
    "__vmarkRefFor",
    "__vmarkQueryByRef",
    "__vmarkQuery",
    "__vmarkQueryAll",
    "__vmarkSnapshot",
    "__vmarkHidden",
    "__vmarkRendered",
    "__vmarkObscuredBy",
    "__vmarkClick",
    "__vmarkType",
    "__vmarkClickRef",
    "__vmarkTypeRef",
  ])("defines %s", (name) => {
    expect(AGENT_LIB).toContain(`function ${name}(`);
  });

  it("is standalone ES5 — no import/export reaches the page", () => {
    expect(AGENT_LIB).not.toMatch(/\bimport\b|\bexport\b/);
  });
});
