// WI-1A.11 / Phase 2 / Phase 3 — format stub registration tests.
//
// Phase 2 graduated json/yaml/toml; Phase 3 graduated mermaid/svg/html.
// This file now covers Phase 4 (code-viewer) stubs only — the remaining
// formats not yet implemented.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetRegistry,
  dispatchEditor,
  getFormatById,
  getSupportedExtensions,
  listFormats,
} from "../registry";
import { registerMarkdownFormat } from "./markdown";
import { registerTxtFormat } from "./txt";
import { registerJsonFormat } from "./json";
import { registerYamlFormat } from "./yaml";
import { registerTomlFormat } from "./toml";
import { registerMermaidFormat } from "./mermaid";
import { registerSvgFormat } from "./svg";
import { registerHtmlFormat } from "./html";
import { registerStubFormats } from "./stubs";

describe("stub registrations", () => {
  beforeEach(() => {
    __resetRegistry();
    registerMarkdownFormat();
    registerTxtFormat();
    registerJsonFormat();
    registerYamlFormat();
    registerTomlFormat();
    registerMermaidFormat();
    registerSvgFormat();
    registerHtmlFormat();
    registerStubFormats();
  });
  afterEach(() => __resetRegistry());

  // Phase 4 code-viewer formats
  it.each([
    ["ts", "code-typescript"],
    ["tsx", "code-typescript"],
    ["js", "code-javascript"],
    ["jsx", "code-javascript"],
    ["py", "code-python"],
    ["rs", "code-rust"],
    ["go", "code-go"],
    ["css", "code-css"],
    ["sh", "code-shell"],
    ["bash", "code-shell"],
    ["rb", "code-ruby"],
    ["lua", "code-lua"],
  ])("dispatches .%s to the %s stub", (ext, formatId) => {
    expect(dispatchEditor(`/x/foo.${ext}`).id).toBe(formatId);
  });

  it("getSupportedExtensions returns 14+ extensions covering all final-format-surface entries", () => {
    const exts = getSupportedExtensions();
    // Markdown (5) + txt (1) + Phase 2 (5) + Phase 3 (4) + Phase 4 (12)
    // = 27 total, but markdown has 5 ext for one format. The plan DoD
    // requires 14+; we check the minimum is satisfied.
    expect(exts.length).toBeGreaterThanOrEqual(14);
  });

  it("every stubbed format has menuPolicy with all-false (markdown-only menus disabled)", () => {
    const stubs = listFormats().filter(
      (f) => f.id !== "markdown" && f.id !== "txt",
    );
    for (const f of stubs) {
      expect(f.adapters.menuPolicy).toEqual({
        sourceWysiwygToggle: false,
        cjkFormatActions: false,
        insertBlockActions: false,
        paragraphFormatting: false,
      });
    }
  });

  it("every code-* stub has readOnlyDefault=true (ADR-3)", () => {
    const codeStubs = listFormats().filter((f) => f.id.startsWith("code-"));
    expect(codeStubs.length).toBeGreaterThan(0);
    for (const f of codeStubs) {
      expect(f.adapters.readOnlyDefault).toBe(true);
      expect(f.adapters.closeSavePolicy).toBe("markdown-default");
    }
  });

  it("Phase 3 visual-render adapters have readOnlyDefault=false", () => {
    // Now graduated; verifies bootstrap registers them with R/W.
    for (const id of ["html", "svg", "mermaid"]) {
      expect(getFormatById(id)?.adapters.readOnlyDefault).toBe(false);
    }
  });

  it("each stub uses CodeMirror search adapter", () => {
    const stubs = listFormats().filter((f) => f.id !== "markdown");
    for (const f of stubs) {
      expect(f.adapters.searchAdapter).toBe("codemirror");
    }
  });

  it("code-* stubs default contentSearchIndexed=false (per ADR-9)", () => {
    const codeStubs = listFormats().filter((f) => f.id.startsWith("code-"));
    for (const f of codeStubs) {
      expect(f.adapters.contentSearchIndexed).toBe(false);
    }
  });

  it("Phase 3 visual-render adapters default contentSearchIndexed=true", () => {
    for (const id of ["html", "svg", "mermaid"]) {
      expect(getFormatById(id)?.adapters.contentSearchIndexed).toBe(true);
    }
  });

  it("Phase 4 stubs do not declare loadLanguage (raw CodeMirror fallback per invariant 4)", () => {
    // Markdown + txt + every Phase 2/3 graduate are excluded.
    const graduates = new Set([
      "markdown",
      "txt",
      "json",
      "yaml",
      "toml",
      "mermaid",
      "svg",
      "html",
    ]);
    const stubs = listFormats().filter((f) => !graduates.has(f.id));
    for (const f of stubs) {
      expect(f.loadLanguage).toBeUndefined();
    }
  });

  it("Phase 4 stubs do not declare validator", () => {
    const graduates = new Set([
      "markdown",
      "json",
      "yaml",
      "toml",
      "mermaid",
      "svg",
      "html",
    ]);
    const stubs = listFormats().filter((f) => !graduates.has(f.id));
    for (const f of stubs) {
      expect(f.validator).toBeUndefined();
    }
  });

  it("Phase 4 stubs do not declare genericPreview", () => {
    const graduates = new Set([
      "markdown",
      "json",
      "yaml",
      "toml",
      "mermaid",
      "svg",
      "html",
    ]);
    const stubs = listFormats().filter((f) => !graduates.has(f.id));
    for (const f of stubs) {
      expect(f.genericPreview).toBeUndefined();
    }
  });

  it("registerStubFormats is the second of two phases — assumes markdown + txt already registered", () => {
    __resetRegistry();
    registerMarkdownFormat();
    registerTxtFormat();
    expect(() => registerStubFormats()).not.toThrow();
  });

  it("each stub uses a unique nameI18nKey under format.*", () => {
    const stubs = listFormats().filter(
      (f) => f.id !== "markdown" && f.id !== "txt",
    );
    const keys = stubs.map((f) => f.nameI18nKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^format\./);
  });
});
