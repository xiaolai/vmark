// @vitest-environment node
// WI-UI1.5 — hljs-syntax.css is a ROLE MAP: zero literals, full scope coverage.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync("src/plugins/codeBlockLineNumbers/hljs-syntax.css", "utf8");
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, " ");

/**
 * Scopes GitHub's own stylesheet styles. The old hand-copy covered ~23 and
 * silently rendered the rest as plain text; each entry here must have a rule.
 */
const REQUIRED_SCOPES = [
  // the original set
  "hljs-keyword", "hljs-selector-tag", "hljs-literal", "hljs-title",
  "hljs-attr", "hljs-attribute", "hljs-number", "hljs-symbol", "hljs-type",
  "hljs-string", "hljs-regexp", "hljs-comment", "hljs-quote", "hljs-operator",
  "hljs-punctuation", "hljs-name", "hljs-tag", "hljs-built_in",
  "hljs-builtin-name", "hljs-variable", "hljs-template-variable",
  "hljs-addition", "hljs-deletion", "hljs-meta",
  // the scopes the hand-copy omitted (WI-UI1.5)
  "hljs-doctag", "hljs-template-tag", "hljs-section", "hljs-selector-class",
  "hljs-selector-id", "hljs-selector-attr", "hljs-selector-pseudo",
  "hljs-bullet", "hljs-formula", "hljs-params", "hljs-subst", "hljs-property",
  "hljs-link", "hljs-emphasis", "hljs-strong",
];

describe("hljs-syntax.css role map", () => {
  it("contains zero colour literals — every colour is a var()", () => {
    expect(stripped.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    // any raw rgb()/rgba()/hsl() not inside color-mix counts too
    const fnLiterals = [...stripped.matchAll(/\b(rgba?|hsla?)\(/g)];
    expect(fnLiterals).toEqual([]);
  });

  it("has a rule for every required scope — as an exact class TOKEN", () => {
    // Audit 20260829: substring matching let `.hljs-title.function_` satisfy
    // `hljs-title` and `.hljs-meta .hljs-string` satisfy `hljs-string`; an
    // exact-token scan cannot be satisfied by a compound-only survivor.
    const classTokens = new Set(
      [...stripped.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((m) => m[1]),
    );
    for (const scope of REQUIRED_SCOPES) {
      expect(classTokens.has(scope), scope).toBe(true);
    }
  });

  it("every colour declaration resolves through a --syntax-* or semantic token", () => {
    // Audit 20260829: the scan covers background(-color) too — two changed
    // background declarations previously bypassed role-token validation.
    for (const m of stripped.matchAll(/(?:^|[;{])\s*color\s*:\s*([^;}]+)/g)) {
      expect(m[1].trim(), m[1]).toMatch(/^var\(--syntax-[a-z]+\)$/);
    }
    for (const m of stripped.matchAll(/(?:^|[;{])\s*background(?:-color)?\s*:\s*([^;}]+)/g)) {
      const v = m[1].trim();
      expect(/var\(--[a-z-]+/.test(v) || /color-mix\(/.test(v), v).toBe(true);
    }
  });
});
