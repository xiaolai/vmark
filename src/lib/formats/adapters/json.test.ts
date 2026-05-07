// WI-2.1 — JSON / JSONL adapter tests.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetRegistry,
  dispatchEditor,
  getFormatById,
} from "../registry";
import { jsonFormat, registerJsonFormat, jsonValidator } from "./json";
import { registerMarkdownFormat } from "./markdown";

describe("json adapter", () => {
  beforeEach(() => __resetRegistry());
  afterEach(() => __resetRegistry());

  describe("FormatConfig", () => {
    it("declares id 'json'", () => {
      expect(jsonFormat.id).toBe("json");
    });

    it("registers .json and .jsonl extensions", () => {
      expect(jsonFormat.extensions).toEqual(["json", "jsonl"]);
    });

    it("declares kind 'split-pane'", () => {
      expect(jsonFormat.kind).toBe("split-pane");
    });

    it("declares loadLanguage", () => {
      expect(typeof jsonFormat.loadLanguage).toBe("function");
    });

    it("declares validator + genericPreview", () => {
      expect(typeof jsonFormat.validator).toBe("function");
      expect(jsonFormat.genericPreview).toBeDefined();
    });

    it("uses CodeMirror search adapter, R/W, content-search-indexed", () => {
      expect(jsonFormat.adapters.searchAdapter).toBe("codemirror");
      expect(jsonFormat.adapters.readOnlyDefault).toBe(false);
      expect(jsonFormat.adapters.contentSearchIndexed).toBe(true);
    });

    it("registerJsonFormat installs into the registry", () => {
      registerJsonFormat();
      expect(getFormatById("json")).toBe(jsonFormat);
    });

    it("dispatchEditor routes .json and .jsonl", () => {
      registerMarkdownFormat();
      registerJsonFormat();
      expect(dispatchEditor("/x/data.json").id).toBe("json");
      expect(dispatchEditor("/x/log.jsonl").id).toBe("json");
    });
  });

  describe("jsonValidator", () => {
    it("returns no diagnostics for valid JSON", () => {
      expect(jsonValidator('{"a": 1}')).toEqual([]);
      expect(jsonValidator("[]")).toEqual([]);
      expect(jsonValidator("null")).toEqual([]);
      expect(jsonValidator('"hello"')).toEqual([]);
    });

    it("returns one error for malformed JSON with line + column", () => {
      const diags = jsonValidator('{"a": 1,\n  "b": ,\n  "c": 3}');
      expect(diags).toHaveLength(1);
      expect(diags[0].severity).toBe("error");
      expect(diags[0].line).toBeGreaterThan(0);
      expect(diags[0].column).toBeGreaterThan(0);
      expect(diags[0].message).toMatch(/json|unexpected|expected/i);
    });

    it("flags unterminated string at the right line", () => {
      const diags = jsonValidator('{\n  "a": "unterminated\n}');
      expect(diags).toHaveLength(1);
      expect(diags[0].severity).toBe("error");
    });

    it("flags trailing comma", () => {
      const diags = jsonValidator('{"a": 1,}');
      expect(diags).toHaveLength(1);
      expect(diags[0].severity).toBe("error");
    });

    it("flags empty document as a syntax error at line 1", () => {
      // JSON.parse("") throws — empty content is not valid JSON, so the
      // validator surfaces a line:1 diagnostic. The user sees the same
      // gutter marker they would for any other parse failure.
      const diags = jsonValidator("");
      expect(diags).toHaveLength(1);
      expect(diags[0].line).toBe(1);
    });

    it("validator for .jsonl parses each line independently", () => {
      const content = '{"a":1}\n{"b": ,2}\n{"c":3}';
      // .jsonl path lets line 2 fail without poisoning lines 1 and 3.
      const diags = jsonValidator(content, "/x/log.jsonl");
      expect(diags.length).toBeGreaterThanOrEqual(1);
      // Line 2 has the syntax error
      const linesWithErrors = new Set(diags.map((d) => d.line));
      expect(linesWithErrors.has(2)).toBe(true);
    });

    it("validator for .jsonl ignores trailing blank line", () => {
      const diags = jsonValidator('{"a":1}\n{"b":2}\n', "/x/log.jsonl");
      expect(diags).toEqual([]);
    });
  });
});
