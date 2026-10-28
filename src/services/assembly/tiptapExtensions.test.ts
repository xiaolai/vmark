// @vitest-environment node
// WI-3.4 — WYSIWYG composition order is pinned by explicit constraints, not by
// array position. These run the REAL composition and assert the resolved
// extension-name order equals the canonical list, proving that alphabetizing the
// source array (done inside createTiptapExtensions) does not change the order.
import { describe, it, expect } from "vitest";
import { createTiptapExtensions } from "./createTiptapExtensions";
import { WYSIWYG_COMPOSITION_ORDER, WYSIWYG_OPTIONAL_IDS } from "./compositionOrder";

describe("WI-3.4 — WYSIWYG composition order", () => {
  // 79 since audit 20260906 F5 added `safeBlockSplit` — Enter on a cross-block
  // selection, which StarterKit's splitBlock throws on. 80 since `undoIntegrity`
  // stopped normalizers rewriting an undo (#1407 soak, fuzz seed 4). 81 since
  // the agent edit journal's WYSIWYG collector (`journalProvenance`, optional).
  it("has 81 unique canonical entries", () => {
    expect(WYSIWYG_COMPOSITION_ORDER.length).toBe(81);
    expect(new Set(WYSIWYG_COMPOSITION_ORDER).size).toBe(81);
  });

  it("the provenance observer is optional, last, and registered only with a tab", () => {
    expect(WYSIWYG_OPTIONAL_IDS).toEqual(["markdownLint", "journalProvenance"]);
    expect(WYSIWYG_COMPOSITION_ORDER.at(-1)).toBe("journalProvenance");
    expect(createTiptapExtensions({ tabId: "tab-1" }).map((e) => e.name)).toContain("journalProvenance");
  });

  it("resolves to exactly the canonical order when a tab is known (lint present)", () => {
    const names = createTiptapExtensions({ tabId: "tab-1" }).map((e) => e.name);
    expect(names).toEqual([...WYSIWYG_COMPOSITION_ORDER]);
  });

  it("omits the optional entries with no tab, order otherwise preserved", () => {
    const names = createTiptapExtensions().map((e) => e.name);
    expect(names).toEqual(WYSIWYG_COMPOSITION_ORDER.filter((n) => !WYSIWYG_OPTIONAL_IDS.includes(n)));
  });

  it("composition throws nothing — every canonical id maps to a real extension", () => {
    expect(() => createTiptapExtensions({ tabId: "tab-1" })).not.toThrow();
  });

  // Audit finding #34. The media node views resolve a relative `src` against a
  // DOCUMENT's directory, and they learn which document from this option. If
  // the wiring is dropped they silently fall back to the focused tab, which is
  // right often enough that nothing looks broken until two documents are open
  // in a split — so the wiring needs an assertion of its own, not just working
  // node views. Deleting the `.configure(...)` calls left every other test in
  // this suite green.
  it.each(["block_image", "block_video", "block_audio"])(
    "configures %s with the owning tab",
    (name) => {
      const ext = createTiptapExtensions({ tabId: "tab-owner" }).find((e) => e.name === name);
      expect(ext, `${name} is not registered`).toBeDefined();
      expect((ext?.options as { ownerTabId?: string } | undefined)?.ownerTabId).toBe("tab-owner");
    },
  );

  it.each(["block_image", "block_video", "block_audio"])(
    "leaves %s without an owner when the editor has no tab",
    (name) => {
      // A preview with no tab behind it: the focused-tab fallback is correct.
      const ext = createTiptapExtensions().find((e) => e.name === name);
      expect((ext?.options as { ownerTabId?: string } | undefined)?.ownerTabId).toBeUndefined();
    },
  );
});
