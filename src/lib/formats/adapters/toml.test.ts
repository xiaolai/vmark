// WI-2.2 — TOML adapter tests.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetRegistry,
  dispatchEditor,
  getFormatById,
} from "../registry";
import { tomlFormat, registerTomlFormat, tomlValidator } from "./toml";
import { registerMarkdownFormat } from "./markdown";

describe("toml adapter", () => {
  beforeEach(() => __resetRegistry());
  afterEach(() => __resetRegistry());

  it("declares id 'toml'", () => {
    expect(tomlFormat.id).toBe("toml");
  });

  it("registers .toml extension only", () => {
    expect(tomlFormat.extensions).toEqual(["toml"]);
  });

  it("declares loadLanguage + validator + genericPreview", () => {
    expect(typeof tomlFormat.loadLanguage).toBe("function");
    expect(typeof tomlFormat.validator).toBe("function");
    expect(tomlFormat.genericPreview).toBeDefined();
  });

  it("registerTomlFormat installs into the registry", () => {
    registerTomlFormat();
    expect(getFormatById("toml")).toBe(tomlFormat);
  });

  it("dispatchEditor routes .toml", () => {
    registerMarkdownFormat();
    registerTomlFormat();
    expect(dispatchEditor("/x/Cargo.toml").id).toBe("toml");
  });

  describe("tomlValidator", () => {
    it("returns no diagnostics for valid TOML", () => {
      expect(
        tomlValidator(`
[package]
name = "vmark"
version = "0.7.0"
        `.trim()),
      ).toEqual([]);
    });

    it("returns no diagnostics for empty document (TOML allows empty)", () => {
      expect(tomlValidator("")).toEqual([]);
    });

    it("returns one error for malformed TOML with line/column", () => {
      const diags = tomlValidator(`
[package
name = "broken"
      `.trim());
      expect(diags).toHaveLength(1);
      expect(diags[0].severity).toBe("error");
      expect(diags[0].line).toBeGreaterThan(0);
    });

    it("flags duplicate keys", () => {
      const diags = tomlValidator(`
foo = 1
foo = 2
      `.trim());
      expect(diags).toHaveLength(1);
      expect(diags[0].severity).toBe("error");
    });

    it("returns diagnostics with json-style ruleId", () => {
      const diags = tomlValidator("[unclosed");
      expect(diags[0].ruleId).toMatch(/^toml\//);
    });
  });
});
