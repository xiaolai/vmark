// YAML parse-error linter. Any YAML file (workflow or not) now
// surfaces parse-level errors on the CodeMirror gutter.

import { describe, it, expect } from "vitest";
import { collectYamlDiagnostics } from "./sourceYamlLint";

describe("collectYamlDiagnostics", () => {
  it("returns empty for valid YAML", () => {
    expect(collectYamlDiagnostics("name: ci\non: push\n")).toEqual([]);
  });

  it("flags duplicate keys", () => {
    const text = "name: a\nname: b\n";
    const diags = collectYamlDiagnostics(text);
    expect(diags.length).toBeGreaterThan(0);
    // The yaml package phrases this as "map keys must be unique" —
    // accept either phrasing for forward-compat with library updates.
    expect(diags[0].message.toLowerCase()).toMatch(/duplicat|unique/);
  });

  it("flags unterminated string", () => {
    const text = `value: "unterminated\n`;
    const diags = collectYamlDiagnostics(text);
    expect(diags.length).toBeGreaterThan(0);
  });

  it("flags bad indentation", () => {
    const text = "list:\n  - item\n - item2\n";
    const diags = collectYamlDiagnostics(text);
    expect(diags.length).toBeGreaterThan(0);
  });

  it("returns diagnostics with valid offsets in document range", () => {
    const text = "name: a\nname: b\n";
    const diags = collectYamlDiagnostics(text);
    for (const d of diags) {
      expect(d.from).toBeGreaterThanOrEqual(0);
      expect(d.to).toBeLessThanOrEqual(text.length);
      expect(d.from).toBeLessThanOrEqual(d.to);
    }
  });

  it("returns severity: 'error' for syntax errors", () => {
    const text = `value: "unterminated\n`;
    const diags = collectYamlDiagnostics(text);
    expect(diags[0].severity).toBe("error");
  });

  it("does not throw on completely garbled input", () => {
    expect(() => collectYamlDiagnostics(":::\n@@@\n")).not.toThrow();
  });

  it("handles empty input", () => {
    expect(collectYamlDiagnostics("")).toEqual([]);
  });
});
