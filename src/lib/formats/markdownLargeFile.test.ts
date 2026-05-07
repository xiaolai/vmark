// WI-1A.6 — markdown-adapter-internal large-file helper tests.
//
// Lives outside markdown.tsx to keep the leaf module pure (no React /
// store imports transitively through the rendering tree). The helper
// is conceptually part of the markdown adapter; physically a leaf
// utility imported by both the adapter and entry-point hooks.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetRegistry, registerFormat } from "./registry";
import { maybeMarkLargeMarkdownAsSource } from "./markdownLargeFile";
import { useLargeFileSessionStore } from "@/stores/largeFileSessionStore";
import type { FormatConfig } from "./types";

const stubMd: FormatConfig = {
  id: "markdown",
  nameI18nKey: "format.markdown",
  extensions: ["md"],
  kind: "wysiwyg",
  // wysiwygComponent is required by invariant 3 for kind=wysiwyg
  wysiwygComponent: (() => null) as FormatConfig["wysiwygComponent"],
  adapters: {
    saveDialogFilters: [{ name: "Markdown", extensions: ["md"] }],
    untitledExtension: "md",
    searchAdapter: "tiptap",
    readOnlyDefault: false,
    closeSavePolicy: "markdown-default",
    menuPolicy: {
      sourceWysiwygToggle: true,
      cjkFormatActions: true,
      insertBlockActions: true,
      paragraphFormatting: true,
    },
  },
};

const stubTxt: FormatConfig = {
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
};

describe("maybeMarkLargeMarkdownAsSource", () => {
  beforeEach(() => {
    __resetRegistry();
    useLargeFileSessionStore.setState({ forcedSourceTabs: {} });
  });
  afterEach(() => {
    __resetRegistry();
    useLargeFileSessionStore.setState({ forcedSourceTabs: {} });
  });

  it("no-ops when shouldForce is false", () => {
    registerFormat(stubMd);
    maybeMarkLargeMarkdownAsSource("tab-1", "/foo.md", false);
    expect(
      useLargeFileSessionStore.getState().forcedSourceTabs["tab-1"],
    ).toBeUndefined();
  });

  it("marks markdown tabs when shouldForce is true", () => {
    registerFormat(stubMd);
    maybeMarkLargeMarkdownAsSource("tab-1", "/foo.md", true);
    expect(
      useLargeFileSessionStore.getState().forcedSourceTabs["tab-1"],
    ).toBe(true);
  });

  it("does not mark non-markdown tabs even when shouldForce is true", () => {
    registerFormat(stubMd);
    registerFormat(stubTxt);
    maybeMarkLargeMarkdownAsSource("tab-1", "/foo.txt", true);
    expect(
      useLargeFileSessionStore.getState().forcedSourceTabs["tab-1"],
    ).toBeUndefined();
  });

  it("treats unbootstrapped registry as markdown for .md files (failure-open preserves prior behavior)", () => {
    // Registry empty → dispatchEditor would throw; the helper falls back
    // to a static markdown-extension allow-list and treats .md as markdown.
    maybeMarkLargeMarkdownAsSource("tab-1", "/foo.md", true);
    expect(
      useLargeFileSessionStore.getState().forcedSourceTabs["tab-1"],
    ).toBe(true);
  });

  it("does NOT mark non-markdown extensions when registry is unbootstrapped", () => {
    // Regression: previously the failure-open path defaulted every
    // extension to markdown, so /foo.txt with the registry empty would
    // get marked forced-source — wrong, because txt doesn't have a
    // WYSIWYG path. Static extension allow-list now rejects it.
    maybeMarkLargeMarkdownAsSource("tab-1", "/foo.txt", true);
    expect(
      useLargeFileSessionStore.getState().forcedSourceTabs["tab-1"],
    ).toBeUndefined();
    maybeMarkLargeMarkdownAsSource("tab-2", "/path/to/foo.json", true);
    expect(
      useLargeFileSessionStore.getState().forcedSourceTabs["tab-2"],
    ).toBeUndefined();
    maybeMarkLargeMarkdownAsSource("tab-3", "/no-extension", true);
    expect(
      useLargeFileSessionStore.getState().forcedSourceTabs["tab-3"],
    ).toBeUndefined();
  });

  it("matches every markdown alias when registry is unbootstrapped", () => {
    for (const [i, ext] of ["md", "markdown", "mdown", "mkd", "mdx"].entries()) {
      const tabId = `tab-mdvariant-${i}`;
      maybeMarkLargeMarkdownAsSource(tabId, `/foo.${ext}`, true);
      expect(
        useLargeFileSessionStore.getState().forcedSourceTabs[tabId],
      ).toBe(true);
    }
  });
});
