// @vitest-environment node
// Round 3, #38 — the act payload parser, pinned rule by rule without a handler
// around it. Nothing is mocked: the parser reads the wire contract and nothing else.
import { describe, it, expect } from "vitest";
import { parseActAction } from "@/services/mcpBridge/v2/browserActParse";

const refused = (error: string) => ({ ok: false, error });

describe("parseActAction — operation vocabulary", () => {
  it.each([["frobnicate"], ["read"], ["upload"], [""], [undefined], [7]])(
    "refuses %j — anything outside click/type/scroll/key",
    (operation) => {
      const out = parseActAction({ operation, role: "button", name: "Go" });
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.error).toMatch(/^act supports 'click', 'type', 'scroll', 'key', not '/);
    },
  );
});

describe("parseActAction — click and type targeting", () => {
  it("targets by role+name (approval-legible) and keeps the accessible name as given", () => {
    expect(parseActAction({ operation: "click", role: "button", name: " Publish " })).toEqual({
      ok: true,
      action: { operation: "click", targeting: { by: "target", role: "button", name: " Publish " } },
    });
  });

  it("targets by ref (granted-only) with the ref kept exactly as supplied", () => {
    expect(parseActAction({ operation: "click", ref: "e5" })).toEqual({
      ok: true,
      action: { operation: "click", targeting: { by: "ref", ref: "e5" } },
    });
    expect(parseActAction({ operation: "type", ref: " e3", text: "hi" })).toEqual({
      ok: true,
      action: { operation: "type", text: "hi", targeting: { by: "ref", ref: " e3" } },
    });
  });

  it("refuses both a ref and a role/name, and refuses neither", () => {
    expect(parseActAction({ operation: "click", ref: "e5", role: "button", name: "X" })).toEqual(
      refused("act takes either {ref} or {role, name}, not both"),
    );
    expect(parseActAction({ operation: "click" })).toEqual(refused("act requires {ref} or a non-empty role and name"));
  });

  it.each([
    [{ role: "", name: "" }],
    [{ role: "  ", name: "\t" }],
    [{ role: "button" }],
    [{ name: "Go" }],
  ])("refuses a blank or missing role/name %j instead of targeting the first element", (target) => {
    expect(parseActAction({ operation: "click", ...target })).toEqual(
      refused("act requires {ref} or a non-empty role and name"),
    );
  });

  it("requires a string text for type — an omitted text is malformed, an empty one is a deliberate clear", () => {
    expect(parseActAction({ operation: "type", role: "textbox", name: "Title" })).toEqual(
      refused("type requires a string 'text' (pass \"\" to intentionally clear the field)"),
    );
    expect(parseActAction({ operation: "type", role: "textbox", name: "Title", text: "" })).toEqual({
      ok: true,
      action: { operation: "type", text: "", targeting: { by: "target", role: "textbox", name: "Title" } },
    });
  });

  it("judges the text rule before the targeting rules", () => {
    expect(parseActAction({ operation: "type", ref: "e1", role: "x", name: "y" })).toEqual(
      refused("type requires a string 'text' (pass \"\" to intentionally clear the field)"),
    );
  });
});

describe("parseActAction — scroll", () => {
  it("scrolls to a ref or by a finite delta, never both, never neither", () => {
    expect(parseActAction({ operation: "scroll", ref: "e4" })).toEqual({
      ok: true,
      action: { operation: "scroll", targeting: { by: "ref", ref: "e4" } },
    });
    expect(parseActAction({ operation: "scroll", dy: -250 })).toEqual({
      ok: true,
      action: { operation: "scroll", targeting: { by: "delta", dy: -250 } },
    });
    expect(parseActAction({ operation: "scroll", ref: "e4", dy: 10 })).toEqual(
      refused("scroll takes either {ref} or {dy}, not both"),
    );
    expect(parseActAction({ operation: "scroll" })).toEqual(
      refused("scroll requires a {ref} (from read) or a numeric {dy} pixel delta"),
    );
  });

  it("treats a non-finite or non-numeric dy and a blank ref as absent", () => {
    for (const dy of [NaN, Infinity, "300", null]) {
      expect(parseActAction({ operation: "scroll", dy })).toEqual(
        refused("scroll requires a {ref} (from read) or a numeric {dy} pixel delta"),
      );
    }
    expect(parseActAction({ operation: "scroll", ref: "  ", dy: 0 })).toEqual({
      ok: true,
      action: { operation: "scroll", targeting: { by: "delta", dy: 0 } },
    });
  });
});

describe("parseActAction — key", () => {
  it("needs a non-empty key name", () => {
    for (const key of [undefined, "", 13]) {
      expect(parseActAction({ operation: "key", key })).toEqual(
        refused("key requires a non-empty 'key' name (e.g. 'Enter', 'Escape', 'Tab')"),
      );
    }
  });

  it("reads an optional ref (null means the active element) and boolean modifiers", () => {
    expect(parseActAction({ operation: "key", key: "Enter" })).toEqual({
      ok: true,
      action: { operation: "key", key: "Enter", ref: null, modifiers: undefined },
    });
    expect(parseActAction({ operation: "key", key: "a", ref: "e2", modifiers: { ctrl: true, shift: "yes" } })).toEqual({
      ok: true,
      action: {
        operation: "key",
        key: "a",
        ref: "e2",
        modifiers: { ctrl: true, shift: false, alt: false, meta: false },
      },
    });
    // A non-object modifiers value (the contract drops it) reads as no modifiers.
    expect(parseActAction({ operation: "key", key: "a", modifiers: [] })).toMatchObject({
      ok: true,
      action: { modifiers: undefined },
    });
  });
});
