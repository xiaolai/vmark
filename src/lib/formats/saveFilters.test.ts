// @vitest-environment node
/**
 * Save-dialog filter names must be localized, and their extension lists must
 * come from the registry rather than being retyped per call site.
 *
 * The audit found `"Markdown"` hardcoded in `useExternalFileChanges`, and the
 * markdown extension list retyped in `fileOpen`. Both were symptoms of the
 * same thing: `FormatAdapters.saveDialogFilters` carried a literal English
 * `name`, so every consumer either shipped English or invented its own.
 * Carrying an i18n KEY makes the untranslated state unrepresentable.
 *
 * @coordinates-with lib/formats/saveFilters.ts
 * @module lib/formats/saveFilters.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/i18n", () => ({
  default: {
    t: (key: string) => {
      const table: Record<string, string> = {
        "common:format.markdown": "Markdown-LOCALIZED",
        "common:format.json": "JSON-LOCALIZED",
      };
      // i18next echoes the key back WITHOUT its namespace when missing.
      return table[key] ?? key.replace(/^common:/, "");
    },
  },
}));

import {
  localizedFormatName,
  resolveSaveFilters,
  markdownSaveFilters,
  MARKDOWN_EXTENSIONS_FALLBACK,
} from "./saveFilters";
import { registerFormat, __resetRegistry } from "./registry";
import type { FormatConfig } from "./types";

const mdFormat = {
  id: "markdown",
  nameI18nKey: "format.markdown",
  extensions: ["md", "markdown", "mdown"],
  kind: "viewer",  // registerFormat requires a component for wysiwyg; irrelevant here
  adapters: {
    saveDialogFilters: [{ nameI18nKey: "format.markdown", extensions: ["md", "markdown"] }],
    untitledExtension: "md",
    readOnlyDefault: false,
  },
} as unknown as FormatConfig;

beforeEach(() => {
  __resetRegistry();
});

describe("localizedFormatName", () => {
  it("returns the translation when one exists", () => {
    expect(localizedFormatName("format.markdown", "markdown")).toBe("Markdown-LOCALIZED");
  });

  it("falls back when i18next echoes the namespaced key", () => {
    expect(localizedFormatName("format.nope", "fallback-id")).toBe("fallback-id");
  });

  it("falls back when i18next echoes the BARE key — the form that used to leak", () => {
    // i18next echoes "format.nope", not "common:format.nope". Guarding only
    // the namespaced spelling let the raw key reach the dialog.
    expect(localizedFormatName("format.nope", "fallback-id")).not.toContain("format.");
  });

  it("falls back on an empty key rather than emitting a blank filter name", () => {
    expect(localizedFormatName("", "fallback-id")).toBe("fallback-id");
  });
});

describe("resolveSaveFilters", () => {
  it("localizes each filter's name at call time, not at module load", () => {
    expect(resolveSaveFilters(mdFormat)).toEqual([
      { name: "Markdown-LOCALIZED", extensions: ["md", "markdown"] },
    ]);
  });

  it("copies the extension arrays so a caller cannot mutate registry state", () => {
    const out = resolveSaveFilters(mdFormat);
    out[0].extensions.push("HACKED");
    expect(mdFormat.adapters.saveDialogFilters[0].extensions).not.toContain("HACKED");
  });

  it("returns an empty list for a format with no filters (media)", () => {
    const media = {
      ...mdFormat,
      adapters: { ...mdFormat.adapters, saveDialogFilters: [] },
    } as unknown as FormatConfig;
    expect(resolveSaveFilters(media)).toEqual([]);
  });

  it("falls back to the format id when the key is missing", () => {
    const odd = {
      ...mdFormat,
      id: "weird",
      adapters: {
        ...mdFormat.adapters,
        saveDialogFilters: [{ nameI18nKey: "format.absent", extensions: ["x"] }],
      },
    } as unknown as FormatConfig;
    expect(resolveSaveFilters(odd)[0].name).toBe("weird");
  });
});

describe("markdownSaveFilters — the shared fallback", () => {
  it("reads the registered markdown format when the registry is bootstrapped", () => {
    registerFormat(mdFormat);
    expect(markdownSaveFilters()).toEqual([
      { name: "Markdown-LOCALIZED", extensions: ["md", "markdown"] },
    ]);
  });

  it("still returns a localized, usable filter when the registry is empty", () => {
    // The pre-bootstrap path every call site had open-coded as
    // `[{ name: "Markdown", extensions: ["md", "markdown"] }]`.
    const filters = markdownSaveFilters();
    expect(filters).toHaveLength(1);
    expect(filters[0].name).toBe("Markdown-LOCALIZED");
    expect(filters[0].extensions).toEqual([...MARKDOWN_EXTENSIONS_FALLBACK]);
  });

  it("the fallback extension list covers every markdown spelling the app opens", () => {
    // fileOpen's open-dialog filter listed all five; closeSave listed only
    // "md". A user's .mdx file was invisible in one dialog and not the other.
    expect([...MARKDOWN_EXTENSIONS_FALLBACK]).toEqual([
      "md",
      "markdown",
      "mdown",
      "mkd",
      "mdx",
    ]);
  });

  it("does not hand out the shared fallback array itself", () => {
    const a = markdownSaveFilters();
    a[0].extensions.push("HACKED");
    expect(markdownSaveFilters()[0].extensions).not.toContain("HACKED");
  });
});
