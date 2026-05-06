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

  it("treats unbootstrapped registry as markdown (failure-open preserves prior behavior)", () => {
    // Registry empty → dispatchEditor would throw; the helper catches
    // and falls back to "treat as markdown."
    maybeMarkLargeMarkdownAsSource("tab-1", "/foo.md", true);
    expect(
      useLargeFileSessionStore.getState().forcedSourceTabs["tab-1"],
    ).toBe(true);
  });
});
