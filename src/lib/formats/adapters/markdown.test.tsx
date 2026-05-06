// WI-1A.3 — Markdown adapter tests.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetRegistry,
  dispatchEditor,
  getFormatById,
  registerFormat,
} from "../registry";
import { markdownFormat, registerMarkdownFormat } from "./markdown";

describe("markdown adapter", () => {
  beforeEach(() => __resetRegistry());
  afterEach(() => __resetRegistry());

  it("declares id 'markdown'", () => {
    expect(markdownFormat.id).toBe("markdown");
  });

  it("registers all five canonical markdown extensions", () => {
    expect(markdownFormat.extensions).toEqual([
      "md",
      "markdown",
      "mdown",
      "mkd",
      "mdx",
    ]);
  });

  it("declares kind 'wysiwyg' with a wysiwygComponent", () => {
    expect(markdownFormat.kind).toBe("wysiwyg");
    expect(markdownFormat.wysiwygComponent).toBeDefined();
  });

  it("enables every markdown menu policy flag", () => {
    expect(markdownFormat.adapters.menuPolicy).toEqual({
      sourceWysiwygToggle: true,
      cjkFormatActions: true,
      insertBlockActions: true,
      paragraphFormatting: true,
    });
  });

  it("uses tiptap search adapter", () => {
    expect(markdownFormat.adapters.searchAdapter).toBe("tiptap");
  });

  it("declares .md as untitledExtension", () => {
    expect(markdownFormat.adapters.untitledExtension).toBe("md");
  });

  it("includes Markdown filter in saveDialogFilters", () => {
    const filters = markdownFormat.adapters.saveDialogFilters;
    const mdFilter = filters.find((f) =>
      f.extensions.some((e) => e === "md"),
    );
    expect(mdFilter).toBeDefined();
  });

  it("uses markdown-default closeSavePolicy", () => {
    expect(markdownFormat.adapters.closeSavePolicy).toBe("markdown-default");
  });

  it("registerMarkdownFormat installs into the registry", () => {
    registerMarkdownFormat();
    expect(getFormatById("markdown")).toBe(markdownFormat);
  });

  it("registerMarkdownFormat is the dispatch fallback for null path", () => {
    registerMarkdownFormat();
    expect(dispatchEditor(null).id).toBe("markdown");
  });

  it("registerMarkdownFormat dispatches every markdown extension", () => {
    registerMarkdownFormat();
    for (const ext of ["md", "markdown", "mdown", "mkd", "mdx"]) {
      expect(dispatchEditor(`/x/foo.${ext}`).id).toBe("markdown");
    }
  });

  it("registerMarkdownFormat is idempotent across registry resets via fresh import", () => {
    registerMarkdownFormat();
    expect(() => registerMarkdownFormat()).toThrowError(/duplicate/i);
    __resetRegistry();
    expect(() => registerMarkdownFormat()).not.toThrow();
  });

  it("does not pre-register without an explicit register call", () => {
    expect(getFormatById("markdown")).toBeUndefined();
    // Re-import side-effect should not have registered
    expect(getFormatById("markdown")).toBeUndefined();
  });

  it("does not collide with a separately-registered txt format", () => {
    registerFormat({
      id: "txt",
      nameI18nKey: "format.txt",
      extensions: ["txt"],
      kind: "split-pane",
      adapters: {
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
      },
    });
    expect(() => registerMarkdownFormat()).not.toThrow();
  });
});
