// The allow-list that lets `pnpm lint:i18n` distinguish "nobody has translated
// this yet" from "this is the same string in every language".
//
// Before it existed, the two were conflated in a single ratcheting baseline. A
// literal filesystem path and a pure interpolation sat in a file whose stated
// contract is "translate these", where they could never be actioned and could
// never be removed — so the baseline could never reach zero and a genuinely new
// untranslated string had to be spotted among permanent residents.
import { describe, it, expect } from "vitest";

import {
  IDENTICAL_ALLOWLIST,
  allowedEntries,
  exceptionEntries,
  staleExceptions,
  type IdenticalException,
} from "../i18nIdenticalAllowlist.js";

const jsonException: IdenticalException = {
  kind: "json",
  ns: "settings.json",
  key: "files.autoResize.1920",
  locales: ["de", "ja"],
  reason: '"Full HD" is a universal marketing term.',
};

const yamlException: IdenticalException = {
  kind: "yaml",
  ns: "",
  key: "menu.file.export.pandocRtf",
  locales: ["de"],
  reason: "example",
};

describe("exceptionEntries", () => {
  it("expands a JSON exception to one baseline-format entry per locale", () => {
    expect(exceptionEntries(jsonException)).toEqual([
      "src/locales/de/settings.json:files.autoResize.1920",
      "src/locales/ja/settings.json:files.autoResize.1920",
    ]);
  });

  it("expands a YAML exception to the Rust bundle path", () => {
    expect(exceptionEntries(yamlException)).toEqual([
      "src-tauri/locales/de.yml:menu.file.export.pandocRtf",
    ]);
  });

  it("collects every exception into one lookup set", () => {
    const set = allowedEntries([jsonException, yamlException]);
    expect(set.has("src/locales/de/settings.json:files.autoResize.1920")).toBe(true);
    expect(set.has("src-tauri/locales/de.yml:menu.file.export.pandocRtf")).toBe(true);
    expect(set.has("src/locales/fr/settings.json:files.autoResize.1920")).toBe(false);
  });
});

describe("staleExceptions", () => {
  it("reports an exemption whose value is no longer identical to English", () => {
    // The ratchet in the other direction: translating an exempted string must
    // force the now-dead exemption to be deleted, or the list stops describing
    // what is actually untranslatable.
    const identical = new Set(["src/locales/de/settings.json:files.autoResize.1920"]);
    expect(staleExceptions([jsonException], identical)).toEqual([
      "src/locales/ja/settings.json:files.autoResize.1920",
    ]);
  });

  it("reports nothing when every exemption still applies", () => {
    const identical = new Set([
      "src/locales/de/settings.json:files.autoResize.1920",
      "src/locales/ja/settings.json:files.autoResize.1920",
    ]);
    expect(staleExceptions([jsonException], identical)).toEqual([]);
  });

  it("reports every locale of an exemption that is wholly obsolete", () => {
    expect(staleExceptions([jsonException], new Set())).toHaveLength(2);
  });
});

describe("the shipped allow-list", () => {
  it("documents a substantive reason and at least one locale for every entry", () => {
    expect(IDENTICAL_ALLOWLIST.length).toBeGreaterThan(0);
    for (const e of IDENTICAL_ALLOWLIST) {
      expect(e.locales.length, `${e.ns}:${e.key}`).toBeGreaterThan(0);
      // Long enough to be an actual justification rather than a shrug.
      expect(e.reason.length, `${e.ns}:${e.key}`).toBeGreaterThan(20);
      expect(e.key.length, `${e.ns}:${e.key}`).toBeGreaterThan(0);
      if (e.kind === "json") expect(e.ns).toMatch(/\.json$/);
    }
  });

  it("has no duplicate entry", () => {
    const all = IDENTICAL_ALLOWLIST.flatMap(exceptionEntries);
    expect(all.length).toBe(new Set(all).size);
  });
});
