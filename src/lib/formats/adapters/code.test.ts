// WI-4.1 — Code-viewer adapter tests.
//
// One adapter per language family. Each registers its extensions,
// declares kind="viewer" (read-only-by-default per ADR-3), and
// lazy-loads its CodeMirror language pack.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetRegistry,
  dispatchEditor,
  getFormatById,
} from "../registry";
import {
  codeFormats,
  registerCodeFormats,
} from "./code";
import { registerMarkdownFormat } from "./markdown";

describe("code adapters", () => {
  beforeEach(() => __resetRegistry());
  afterEach(() => __resetRegistry());

  it("declares one adapter per language family", () => {
    const ids = codeFormats.map((f) => f.id);
    // Phase 4 covers: typescript, javascript, python, rust, go, css,
    // shell, ruby, lua. (.zig deliberately out of v1 scope.)
    expect(ids).toEqual([
      "code-typescript",
      "code-javascript",
      "code-python",
      "code-rust",
      "code-go",
      "code-css",
      "code-shell",
      "code-ruby",
      "code-lua",
    ]);
  });

  it("every code-* adapter declares kind 'viewer'", () => {
    for (const f of codeFormats) {
      expect(f.kind).toBe("viewer");
    }
  });

  it("every code-* adapter declares loadLanguage (real lang pack)", () => {
    for (const f of codeFormats) {
      expect(typeof f.loadLanguage).toBe("function");
    }
  });

  it("every code-* adapter is read-only by default (ADR-3)", () => {
    for (const f of codeFormats) {
      expect(f.adapters.readOnlyDefault).toBe(true);
    }
  });

  it("every code-* adapter has closeSavePolicy='markdown-default' (invariant 5)", () => {
    // readOnlyDefault=true ⟹ closeSavePolicy="markdown-default"
    for (const f of codeFormats) {
      expect(f.adapters.closeSavePolicy).toBe("markdown-default");
    }
  });

  it("contentSearchIndexed=false by default for code (per ADR-9)", () => {
    for (const f of codeFormats) {
      expect(f.adapters.contentSearchIndexed).toBe(false);
    }
  });

  it("registerCodeFormats installs all code adapters", () => {
    registerCodeFormats();
    for (const f of codeFormats) {
      expect(getFormatById(f.id)).toBe(f);
    }
  });

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
  ])("dispatches .%s to %s", (ext, formatId) => {
    registerMarkdownFormat();
    registerCodeFormats();
    expect(dispatchEditor(`/x/foo.${ext}`).id).toBe(formatId);
  });
});
