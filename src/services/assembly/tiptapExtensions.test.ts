// @vitest-environment node
// WI-3.4 — WYSIWYG composition order is pinned by explicit constraints, not by
// array position. These run the REAL composition and assert the resolved
// extension-name order equals the canonical list, proving that alphabetizing the
// source array (done inside createTiptapExtensions) does not change the order.
import { describe, it, expect } from "vitest";
import { createTiptapExtensions } from "./tiptapExtensions";
import { WYSIWYG_COMPOSITION_ORDER } from "./compositionOrder";

describe("WI-3.4 — WYSIWYG composition order", () => {
  it("has 78 unique canonical entries", () => {
    expect(WYSIWYG_COMPOSITION_ORDER.length).toBe(78);
    expect(new Set(WYSIWYG_COMPOSITION_ORDER).size).toBe(78);
  });

  it("resolves to exactly the canonical order when a tab is known (lint present)", () => {
    const names = createTiptapExtensions({ tabId: "tab-1" }).map((e) => e.name);
    expect(names).toEqual([...WYSIWYG_COMPOSITION_ORDER]);
  });

  it("omits the optional lint entry with no tab, order otherwise preserved", () => {
    const names = createTiptapExtensions().map((e) => e.name);
    expect(names).toEqual(WYSIWYG_COMPOSITION_ORDER.filter((n) => n !== "markdownLint"));
  });

  it("composition throws nothing — every canonical id maps to a real extension", () => {
    expect(() => createTiptapExtensions({ tabId: "tab-1" })).not.toThrow();
  });
});
