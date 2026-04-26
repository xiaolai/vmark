/**
 * Language registry guard tests.
 *
 * The dropdown's `LANGUAGES` list and the `lowlight` instance live in
 * `languages.ts`. These tests pin two contracts that the rest of the file
 * relies on:
 *
 *   1. Every dropdown id must resolve to a real grammar — either listed in
 *      `lowlight.listLanguages()` or registered as an alias (e.g. `html` →
 *      `xml`). Without this, picking the id from the dropdown would fall
 *      through to `lowlight.highlightAuto()`, which mis-detects English prose
 *      as VB.NET and italicizes apostrophe contractions via `hljs-comment`.
 *
 *   2. The `plaintext` grammar must be present and produce zero `hljs-*`
 *      decorations on prose. This is the regression guard for the original
 *      bug — `defaultLanguage: "plaintext"` in `tiptap.ts` is only safe if
 *      `plaintext` is registered and inert.
 *
 * Tests run against the real `lowlight` instance from production code (no
 * mocks) — the guarantee we need to verify is about the actual registry.
 */
import { describe, expect, it } from "vitest";
import { LANGUAGES, lowlight } from "../languages";

describe("language registry", () => {
  it("every dropdown id resolves to a real lowlight grammar", () => {
    const registered = new Set(lowlight.listLanguages());
    const unresolved: string[] = [];

    for (const lang of LANGUAGES) {
      const ok =
        registered.has(lang.id) ||
        // `lowlight.registered(name)` also resolves alias names (e.g. `html` → `xml`)
        lowlight.registered(lang.id);
      if (!ok) {
        unresolved.push(lang.id);
      }
    }

    expect(unresolved).toEqual([]);
  });

  it("includes plaintext (used as defaultLanguage in tiptap.ts)", () => {
    expect(LANGUAGES.some((l) => l.id === "plaintext")).toBe(true);
    expect(lowlight.listLanguages()).toContain("plaintext");
  });

  it("plaintext does NOT auto-detect — it returns the input as a plain text node", () => {
    // Regression guard for the original bug: empty-language code blocks fell
    // through to `highlightAuto`, which detected English prose with apostrophe
    // contractions ("Don't", "isn't") as VB.NET and wrapped everything from
    // each apostrophe to end-of-line in `<span class="hljs-comment">` —
    // italicized via `hljs-syntax.css`.
    const prose =
      "Don't agree by default, flatter, or mirror. With AI execution it isn't — what was opt-in is default-on.";
    const result = lowlight.highlight("plaintext", prose);

    // Walk the hast tree: there must be no element nodes (no `<span class="hljs-*">`).
    const elementNodes: string[] = [];
    function walk(node: { type: string; tagName?: string; children?: { type: string }[] }): void {
      if (node.type === "element" && node.tagName) {
        elementNodes.push(node.tagName);
      }
      if (node.children) {
        for (const child of node.children) {
          walk(child as { type: string; tagName?: string; children?: { type: string }[] });
        }
      }
    }
    for (const child of result.children) {
      walk(child as { type: string; tagName?: string; children?: { type: string }[] });
    }

    expect(elementNodes).toEqual([]);
  });

  it("LANGUAGES has no duplicate ids", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const lang of LANGUAGES) {
      if (seen.has(lang.id)) dupes.push(lang.id);
      seen.add(lang.id);
    }
    expect(dupes).toEqual([]);
  });

  it("LANGUAGES has no empty id (the bug-causing entry)", () => {
    // `id: ""` previously coexisted with `id: "plaintext"` and was the entry
    // that triggered the auto-detection bug because the lowlight extension
    // treats empty/falsy languages as "use highlightAuto".
    expect(LANGUAGES.some((l) => l.id === "")).toBe(false);
  });
});
