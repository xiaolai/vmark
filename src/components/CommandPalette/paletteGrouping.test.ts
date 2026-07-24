// WI-4.2 — palette browse-mode grouping / search-mode flat list.
/**
 * Tests for buildPaletteSections — the pure sectioning behind the palette's
 * grouped browse view and flat search view.
 */

import { describe, it, expect } from "vitest";
import type { RankedCommand } from "@/services/commands";
import {
  buildPaletteSections,
  PALETTE_CATEGORY_ORDER,
  UNCATEGORIZED,
} from "./paletteGrouping";

function cmd(id: string, category?: string, score = 0): RankedCommand {
  return { command: { id, title: id, category, run: () => {} }, score };
}

// Identity label resolver — asserts on category ids, not translations.
const idLabel = (c: string) => c;

describe("buildPaletteSections", () => {
  it("search mode (non-empty query) returns ONE flat, header-less section preserving order", () => {
    const ranked = [cmd("view.a", "view"), cmd("editor.bold", "formatting"), cmd("view.b", "view")];
    const sections = buildPaletteSections(ranked, "bo", idLabel);
    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBeNull();
    expect(sections[0].label).toBeNull();
    expect(sections[0].items.map((r) => r.command.id)).toEqual([
      "view.a",
      "editor.bold",
      "view.b",
    ]);
  });

  it("a whitespace-only query still counts as browse mode (grouped)", () => {
    const ranked = [cmd("view.a", "view"), cmd("editor.bold", "formatting")];
    const sections = buildPaletteSections(ranked, "   ", idLabel);
    expect(sections.length).toBeGreaterThan(1);
    expect(sections.every((s) => s.label !== null)).toBe(true);
  });

  it("browse mode groups by category, each section labelled", () => {
    const ranked = [
      cmd("editor.bold", "formatting"),
      cmd("view.a", "view"),
      cmd("editor.italic", "formatting"),
    ];
    const sections = buildPaletteSections(ranked, "", idLabel);
    const view = sections.find((s) => s.id === "view");
    const formatting = sections.find((s) => s.id === "formatting");
    expect(view?.items.map((r) => r.command.id)).toEqual(["view.a"]);
    expect(formatting?.items.map((r) => r.command.id)).toEqual([
      "editor.bold",
      "editor.italic",
    ]);
    // Every browse section carries a (non-null) header label.
    expect(sections.every((s) => s.label !== null)).toBe(true);
  });

  it("orders sections by the curated order (view before formatting)", () => {
    const ranked = [cmd("editor.bold", "formatting"), cmd("view.a", "view")];
    const sections = buildPaletteSections(ranked, "", idLabel);
    expect(sections.map((s) => s.id)).toEqual(["view", "formatting"]);
    // Sanity: the curated order really does place view before formatting.
    expect(PALETTE_CATEGORY_ORDER.indexOf("view")).toBeLessThan(
      PALETTE_CATEGORY_ORDER.indexOf("formatting"),
    );
  });

  it("unknown categories sort last, alphabetically by localized label", () => {
    const ranked = [
      cmd("z.a", "zebra"),
      cmd("a.a", "aardvark"),
      cmd("view.a", "view"),
    ];
    // Label resolver upper-cases so we prove it sorts by LABEL, not id.
    const sections = buildPaletteSections(ranked, "", (c) => c.toUpperCase());
    expect(sections.map((s) => s.id)).toEqual(["view", "aardvark", "zebra"]);
  });

  it("commands with no category fall into the UNCATEGORIZED bucket", () => {
    const ranked = [cmd("loose.a"), cmd("view.a", "view")];
    const sections = buildPaletteSections(ranked, "", idLabel);
    const other = sections.find((s) => s.id === UNCATEGORIZED);
    expect(other?.items.map((r) => r.command.id)).toEqual(["loose.a"]);
  });

  it("flattened section items reproduce the full visual order (selection index contract)", () => {
    const ranked = [
      cmd("editor.bold", "formatting"),
      cmd("view.a", "view"),
      cmd("editor.italic", "formatting"),
      cmd("loose"),
    ];
    const sections = buildPaletteSections(ranked, "", idLabel);
    const flat = sections.flatMap((s) => s.items.map((r) => r.command.id));
    // view first (curated), then formatting (both), then uncategorized last.
    expect(flat).toEqual(["view.a", "editor.bold", "editor.italic", "loose"]);
  });

  it("empty input yields no sections", () => {
    expect(buildPaletteSections([], "", idLabel)).toEqual([]);
  });

  it("threads a locale into the unknown-category tie-break (Swedish sorts ä after z)", () => {
    // Both categories are absent from the curated order → alphabetical by label.
    // 'ä' collates BEFORE 'z' in English but AFTER 'z' in Swedish; passing the
    // locale must flip the order, proving VMark's language drives collation
    // rather than the host default.
    const ranked = [cmd("a.z", "zcat"), cmd("a.a", "ächen")];
    const en = buildPaletteSections(
      ranked,
      "",
      (c) => (c === "zcat" ? "Zebra" : "Ähnlich"),
      "en", // explicit — otherwise a Swedish-configured host would also see sv order
    );
    const sv = buildPaletteSections(
      ranked,
      "",
      (c) => (c === "zcat" ? "Zebra" : "Ähnlich"),
      "sv",
    );
    expect(en.map((s) => s.id)).toEqual(["ächen", "zcat"]); // Ä ~ A < Z
    expect(sv.map((s) => s.id)).toEqual(["zcat", "ächen"]); // Z < Ä (distinct letter)
  });
});
