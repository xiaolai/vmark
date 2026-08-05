/**
 * Parser robustness in the engine VMark actually ships.
 *
 * `parserRobustness.test.ts` sweeps the full TOML and JSON suites, but under
 * Node/V8. The never-crash claim it makes is about the PREVIEW PANE, which
 * runs in WKWebView (JavaScriptCore) on macOS — a different engine with a
 * different stack budget and a different `JSON.parse` implementation. A
 * recursion depth that is fine in V8 can overflow in JSC, so the claim was
 * being made in the wrong place.
 *
 * Only the ENGINE-DEPENDENT cases live here — deep nesting and the native
 * parser's own limits. The corpus sweep stays in the jsdom tier, where it
 * is fast and where engine choice cannot change the answer.
 *
 * @coordinates-with parserRobustness.test.ts — the jsdom corpus sweep
 * @coordinates-with ../toml.tsx — tomlValidator
 * @coordinates-with ../json.tsx — jsonValidator
 * @module lib/formats/adapters/__tests__/parserRobustness.webkit.test
 */
import { describe, it, expect } from "vitest";
import { tomlValidator } from "../toml";
import { jsonValidator } from "../json";

const hasError = (diags: { severity: string }[]) =>
  diags.some((d) => d.severity === "error");

describe("JSON validator survives hostile depth in WebKit", () => {
  it("rejects 100k unclosed arrays without throwing", () => {
    expect(hasError(jsonValidator("[".repeat(100_000), "probe.json"))).toBe(true);
  });

  it("does not crash on 10k closed nested arrays", () => {
    const n = 10_000;
    expect(() => jsonValidator("[".repeat(n) + "]".repeat(n), "probe.json")).not.toThrow();
  });

  it("does not crash on deeply nested objects", () => {
    const n = 5_000;
    const doc = '{"a":'.repeat(n) + "1" + "}".repeat(n);
    expect(() => jsonValidator(doc, "probe.json")).not.toThrow();
  });

  it("does not crash on a deep single JSONL line", () => {
    expect(() =>
      jsonValidator("[".repeat(10_000) + "]".repeat(10_000) + "\n", "probe.jsonl"),
    ).not.toThrow();
  });
});

describe("TOML validator survives hostile depth in WebKit", () => {
  it("does not crash on 10k nested inline arrays", () => {
    const n = 10_000;
    expect(() => tomlValidator(`a = ${"[".repeat(n)}${"]".repeat(n)}\n`)).not.toThrow();
  });

  it("rejects 50k unclosed arrays without throwing", () => {
    expect(hasError(tomlValidator(`a = ${"[".repeat(50_000)}\n`))).toBe(true);
  });

  it("does not crash on a very long single-line table", () => {
    const pairs = Array.from({ length: 20_000 }, (_, i) => `k${i} = ${i}`).join(", ");
    expect(() => tomlValidator(`t = { ${pairs} }\n`)).not.toThrow();
  });
});
