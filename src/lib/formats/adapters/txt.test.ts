// WI-1A.9 — Plain text adapter tests.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetRegistry,
  dispatchEditor,
  getFormatById,
  getSupportedExtensions,
} from "../registry";
import { registerMarkdownFormat } from "./markdown";
import { registerTxtFormat, txtFormat } from "./txt";

describe("txt adapter", () => {
  beforeEach(() => __resetRegistry());
  afterEach(() => __resetRegistry());

  it("declares id 'txt'", () => {
    expect(txtFormat.id).toBe("txt");
  });

  it("registers .txt as the only extension", () => {
    expect(txtFormat.extensions).toEqual(["txt"]);
  });

  it("declares kind 'split-pane'", () => {
    expect(txtFormat.kind).toBe("split-pane");
  });

  it("declares no validator (plain text has no syntax)", () => {
    expect(txtFormat.validator).toBeUndefined();
  });

  it("declares no genericPreview (no rendered output)", () => {
    expect(txtFormat.genericPreview).toBeUndefined();
  });

  it("declares no loadLanguage (plain text needs no syntax highlighting)", () => {
    expect(txtFormat.loadLanguage).toBeUndefined();
  });

  it("uses CodeMirror search adapter", () => {
    expect(txtFormat.adapters.searchAdapter).toBe("codemirror");
  });

  it("declares menuPolicy with all flags false (plain text is dumb)", () => {
    expect(txtFormat.adapters.menuPolicy).toEqual({
      sourceWysiwygToggle: false,
      cjkFormatActions: false,
      insertBlockActions: false,
      paragraphFormatting: false,
    });
  });

  it("registerTxtFormat installs into the registry", () => {
    registerTxtFormat();
    expect(getFormatById("txt")).toBe(txtFormat);
  });

  it("dispatches .txt files to the txt adapter", () => {
    registerMarkdownFormat();
    registerTxtFormat();
    expect(dispatchEditor("/x/notes.txt").id).toBe("txt");
  });

  it("dispatches unknown extensions to the txt adapter as fallback", () => {
    registerMarkdownFormat();
    registerTxtFormat();
    expect(dispatchEditor("/x/foo.unknown").id).toBe("txt");
  });

  it("does not collide with markdown's extensions", () => {
    registerMarkdownFormat();
    expect(() => registerTxtFormat()).not.toThrow();
  });

  it("appears in getSupportedExtensions after registration", () => {
    registerTxtFormat();
    expect(getSupportedExtensions()).toContain("txt");
  });

  it("contentSearchIndexed defaults to true (split-pane plain text is searchable)", () => {
    expect(txtFormat.adapters.contentSearchIndexed).toBe(true);
  });
});
