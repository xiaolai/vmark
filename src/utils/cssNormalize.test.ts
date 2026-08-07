// @vitest-environment node
import { describe, it, expect } from "vitest";
import { normalizeCss } from "./cssNormalize";

describe("normalizeCss", () => {
  it("strips comments", () => {
    expect(normalizeCss("position:fixed/**/")).toBe("position:fixed");
    expect(normalizeCss("position:/**/fixed")).toBe("position:fixed");
  });

  it("resolves hex escapes", () => {
    expect(normalizeCss("u\\72l(x)")).toBe("url(x)");
  });

  it("resolves SIMPLE escapes", () => {
    // `f\ixed` parses as `fixed`; only handling hex escapes let it through.
    expect(normalizeCss("f\\ixed")).toBe("fixed");
    expect(normalizeCss("ur\\l(x)")).toBe("url(x)");
  });

  it("consumes one whitespace character after a hex escape", () => {
    expect(normalizeCss("\\75 rl(x)")).toBe("url(x)");
  });

  it("leaves ordinary text alone", () => {
    expect(normalizeCss("relative")).toBe("relative");
    expect(normalizeCss("#ff0000")).toBe("#ff0000");
  });

  it("handles empty input", () => {
    expect(normalizeCss("")).toBe("");
  });
});
