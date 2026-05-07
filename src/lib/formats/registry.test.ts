// WI-1A.2 — Format registry tests.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  registerFormat,
  dispatchEditor,
  getFormatById,
  listFormats,
  getSupportedExtensions,
  __resetRegistry,
} from "./registry";
import type { FormatConfig } from "./types";

const baseAdapters: FormatConfig["adapters"] = {
  saveDialogFilters: [{ name: "Plain", extensions: ["txt"] }],
  untitledExtension: "txt",
  searchAdapter: "codemirror",
  readOnlyDefault: false,
  closeSavePolicy: "markdown-default",
  menuPolicy: {
    sourceWysiwygToggle: false,
    cjkFormatActions: false,
    insertBlockActions: false,
    paragraphFormatting: false,
  },
};

const txtConfig: FormatConfig = {
  id: "txt",
  nameI18nKey: "format.txt",
  extensions: ["txt"],
  kind: "split-pane",
  adapters: baseAdapters,
};

const mdAdapters: FormatConfig["adapters"] = {
  ...baseAdapters,
  saveDialogFilters: [
    { name: "Markdown", extensions: ["md", "markdown"] },
  ],
  untitledExtension: "md",
  searchAdapter: "tiptap",
  menuPolicy: {
    sourceWysiwygToggle: true,
    cjkFormatActions: true,
    insertBlockActions: true,
    paragraphFormatting: true,
  },
};

const StubComponent = (() => null) as unknown as FormatConfig["wysiwygComponent"];

const mdConfig: FormatConfig = {
  id: "markdown",
  nameI18nKey: "format.markdown",
  extensions: ["md", "markdown", "mdown", "mkd", "mdx"],
  kind: "wysiwyg",
  wysiwygComponent: StubComponent,
  adapters: mdAdapters,
};

describe("format registry", () => {
  beforeEach(() => __resetRegistry());
  afterEach(() => __resetRegistry());

  describe("registerFormat", () => {
    it("registers and retrieves by id", () => {
      registerFormat(txtConfig);
      expect(getFormatById("txt")).toBe(txtConfig);
    });

    it("rejects empty id", () => {
      expect(() =>
        registerFormat({ ...txtConfig, id: "" }),
      ).toThrowError(/id/);
    });

    it("rejects id with invalid characters", () => {
      expect(() =>
        registerFormat({ ...txtConfig, id: "Foo_Bar" }),
      ).toThrowError(/id/);
    });

    it("rejects duplicate id", () => {
      registerFormat(txtConfig);
      expect(() => registerFormat(txtConfig)).toThrowError(/duplicate id/i);
    });

    it("rejects empty extensions", () => {
      expect(() =>
        registerFormat({ ...txtConfig, extensions: [] }),
      ).toThrowError(/extension/i);
    });

    it("rejects extension collision with another format", () => {
      registerFormat(txtConfig);
      expect(() =>
        registerFormat({
          ...txtConfig,
          id: "other",
          extensions: ["txt"],
        }),
      ).toThrowError(/collision|already registered/i);
    });

    it("rejects wysiwyg kind without wysiwygComponent", () => {
      expect(() =>
        registerFormat({
          ...mdConfig,
          wysiwygComponent: undefined,
        }),
      ).toThrowError(/wysiwygComponent/);
    });

    it("rejects wysiwyg kind that also declares loadLanguage", () => {
      expect(() =>
        registerFormat({
          ...mdConfig,
          loadLanguage: async () => ({}) as never,
        }),
      ).toThrowError(/wysiwyg.*loadLanguage/i);
    });

    it("allows split-pane stub without loadLanguage (Phase 1A stub fallback)", () => {
      const stub: FormatConfig = {
        id: "json",
        nameI18nKey: "format.json",
        extensions: ["json"],
        kind: "split-pane",
        adapters: baseAdapters,
      };
      expect(() => registerFormat(stub)).not.toThrow();
    });

    it("allows plain txt with no loadLanguage", () => {
      expect(() => registerFormat(txtConfig)).not.toThrow();
    });

    it("rejects readOnlyDefault=true with non-markdown-default closeSavePolicy", () => {
      expect(() =>
        registerFormat({
          ...txtConfig,
          adapters: {
            ...baseAdapters,
            readOnlyDefault: true,
            closeSavePolicy: "save-as-only",
          },
        }),
      ).toThrowError(/readOnlyDefault.*markdown-default/i);
    });

    it("rejects always-when-registered keep-alive outside the allow-list", () => {
      expect(() =>
        registerFormat({
          ...txtConfig,
          adapters: {
            ...baseAdapters,
            sidePanelKeepAlive: "always-when-registered",
          },
        }),
      ).toThrowError(/always-when-registered.*allow-list/i);
    });

    it("permits always-when-registered keep-alive for yaml-gha-workflow id", () => {
      expect(() =>
        registerFormat({
          ...txtConfig,
          id: "yaml-gha-workflow",
          extensions: ["yamlworkflow-marker"],
          adapters: {
            ...baseAdapters,
            sidePanelKeepAlive: "always-when-registered",
          },
        }),
      ).not.toThrow();
    });

    it("normalizes extensions: strips leading dot", () => {
      registerFormat({ ...txtConfig, extensions: [".txt"] });
      expect(dispatchEditor("/x/foo.txt").id).toBe("txt");
      expect(getSupportedExtensions()).toContain("txt");
      expect(getSupportedExtensions()).not.toContain(".txt");
    });

    it("normalizes extensions: trims whitespace", () => {
      registerFormat({ ...txtConfig, extensions: ["  txt  "] });
      expect(dispatchEditor("/x/foo.txt").id).toBe("txt");
    });

    it("normalizes extensions: lowercases", () => {
      registerFormat({ ...txtConfig, extensions: ["TXT"] });
      expect(dispatchEditor("/x/foo.txt").id).toBe("txt");
      expect(dispatchEditor("/x/foo.TXT").id).toBe("txt");
    });

    it("rejects empty extension after normalization", () => {
      expect(() =>
        registerFormat({ ...txtConfig, extensions: ["   "] }),
      ).toThrowError(/non-empty/);
      expect(() =>
        registerFormat({ ...txtConfig, extensions: ["."] }),
      ).toThrowError(/non-empty/);
    });

    it("rejects non-string extensions", () => {
      expect(() =>
        registerFormat({
          ...txtConfig,
          extensions: [123 as unknown as string],
        }),
      ).toThrowError(/string/);
    });

    it("rejects same extension declared twice in one format", () => {
      expect(() =>
        registerFormat({ ...txtConfig, extensions: ["txt", "TXT"] }),
      ).toThrowError(/more than once/);
    });
  });

  describe("dispatchEditor", () => {
    beforeEach(() => {
      registerFormat(mdConfig);
      registerFormat(txtConfig);
    });

    it("returns markdown for null path (untitled)", () => {
      expect(dispatchEditor(null).id).toBe("markdown");
    });

    it("matches by extension (case-insensitive)", () => {
      expect(dispatchEditor("/x/foo.MD").id).toBe("markdown");
      expect(dispatchEditor("/x/foo.txt").id).toBe("txt");
    });

    it("matches each registered markdown extension", () => {
      for (const ext of ["md", "markdown", "mdown", "mkd", "mdx"]) {
        expect(dispatchEditor(`/x/foo.${ext}`).id).toBe("markdown");
      }
    });

    it("returns plain-text fallback for unknown extension", () => {
      expect(dispatchEditor("/x/foo.unknown").id).toBe("txt");
    });

    it("returns plain-text fallback for paths with no extension", () => {
      expect(dispatchEditor("/x/Makefile").id).toBe("txt");
    });

    it("strips query string before extension match", () => {
      expect(dispatchEditor("/x/foo.md?reload=1").id).toBe("markdown");
    });

    it("strips fragment before extension match", () => {
      expect(dispatchEditor("/x/foo.md#section").id).toBe("markdown");
    });

    it("strips both query and fragment", () => {
      expect(dispatchEditor("/x/foo.txt?v=2#l3").id).toBe("txt");
    });
  });

  describe("dispatchEditor without txt fallback registered", () => {
    it("returns markdown for null path even when no fallback exists", () => {
      registerFormat(mdConfig);
      expect(dispatchEditor(null).id).toBe("markdown");
    });

    it("returns markdown for unknown extension when no txt registered (markdown is default fallback)", () => {
      registerFormat(mdConfig);
      expect(dispatchEditor("/x/foo.unknown").id).toBe("markdown");
    });
  });

  describe("listFormats / getSupportedExtensions", () => {
    it("listFormats returns registered formats in insertion order", () => {
      registerFormat(mdConfig);
      registerFormat(txtConfig);
      expect(listFormats().map((f) => f.id)).toEqual(["markdown", "txt"]);
    });

    it("getSupportedExtensions returns all unique extensions", () => {
      registerFormat(mdConfig);
      registerFormat(txtConfig);
      const exts = getSupportedExtensions();
      expect(exts).toContain("md");
      expect(exts).toContain("markdown");
      expect(exts).toContain("txt");
    });

    it("getSupportedExtensions has no duplicates", () => {
      registerFormat(mdConfig);
      const exts = getSupportedExtensions();
      const set = new Set(exts);
      expect(set.size).toBe(exts.length);
    });
  });
});
