// Toolbar label translation mapping (audit 20260612 H17).
//
// Rot-proofing: every group/item id in toolbarGroups must have a mapping,
// and every mapped key must exist in en/editor.json — so adding a toolbar
// item without a translation key (or deleting a key) fails here instead of
// silently shipping an untranslated button.

import { describe, it, expect } from "vitest";
import editorEn from "@/locales/en/editor.json";
import { TOOLBAR_GROUPS } from "./toolbarGroups";
import {
  GROUP_LABEL_KEYS,
  ITEM_LABEL_KEYS,
  toolbarGroupLabel,
  toolbarItemLabel,
} from "./toolbarI18n";

const enKeys = new Set(Object.keys(editorEn));

describe("toolbar label key mapping", () => {
  it("maps every toolbar group id", () => {
    const unmapped = TOOLBAR_GROUPS.filter((g) => !GROUP_LABEL_KEYS[g.id]).map(
      (g) => g.id
    );
    expect(unmapped).toEqual([]);
  });

  it("maps every toolbar item id", () => {
    const unmapped = TOOLBAR_GROUPS.flatMap((g) => g.items)
      .filter((i) => !ITEM_LABEL_KEYS[i.id])
      .map((i) => i.id);
    expect(unmapped).toEqual([]);
  });

  it("every mapped key exists in en/editor.json", () => {
    const missing = [
      ...Object.values(GROUP_LABEL_KEYS),
      ...Object.values(ITEM_LABEL_KEYS),
    ].filter((k) => !enKeys.has(k));
    expect(missing).toEqual([]);
  });
});

describe("label resolution", () => {
  const tEcho = (key: string) => `<${key}>`;
  const tFallback = (_key: string, opts?: { defaultValue?: string }) =>
    opts?.defaultValue ?? "";

  it("resolves group labels through t()", () => {
    expect(toolbarGroupLabel(tEcho, { id: "block", label: "Heading" })).toBe(
      "<toolbar.group.heading>"
    );
  });

  it("resolves item labels through t()", () => {
    expect(toolbarItemLabel(tEcho, { id: "bold", label: "Bold" })).toBe(
      "<toolbar.inline.bold>"
    );
  });

  it("passes the hardcoded label as defaultValue", () => {
    expect(toolbarItemLabel(tFallback, { id: "bold", label: "Bold" })).toBe(
      "Bold"
    );
  });

  it("falls back to the hardcoded label for unknown ids", () => {
    expect(toolbarItemLabel(tEcho, { id: "future-item", label: "Future" })).toBe(
      "Future"
    );
    expect(toolbarGroupLabel(tEcho, { id: "future-group", label: "FG" })).toBe(
      "FG"
    );
  });
});
