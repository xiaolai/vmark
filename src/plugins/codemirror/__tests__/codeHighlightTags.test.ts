// WI-UI3.6 (corrected by audit 20260829) — Source mode's markdown STRUCTURE
// characters map via `tags.processingInstruction` ONLY: Lezer applies
// `tags.quote`/`tags.list` to the whole blockquote/list subtrees (prose
// included), so mapping those would restyle body text as punctuation.
// Likewise `tags.monospace` covers block CodeText as well as InlineCode, so
// it carries the FONT only, never a surface.
// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { tags } from "@lezer/highlight";
import { codeHighlightStyle } from "../theme";

function classFor(tag: unknown): string | null {
  return (codeHighlightStyle as unknown as { style: (t: unknown[]) => string | null }).style([tag]);
}

describe("markdown structure + monospace tags (WI-UI3.6)", () => {
  it("processingInstruction maps to cm-hl-md-char", () => {
    expect(classFor(tags.processingInstruction)).toContain("cm-hl-md-char");
  });

  it("quote and list are deliberately UNMAPPED — they cover whole subtrees", () => {
    for (const tag of [tags.quote, tags.list]) {
      const cls = classFor(tag);
      expect(cls ?? "").not.toContain("cm-hl-md-char");
    }
  });

  it("monospace styles the font only — no surface class that would wrap block code", () => {
    const cls = classFor(tags.monospace);
    expect(cls ?? "").not.toContain("cm-hl-inline-code");
  });

  it("cm-hl-md-char resolves to --md-char-color, and the dead surface class is gone", () => {
    const css = readFileSync("src/plugins/codemirror/source-syntax.css", "utf8");
    expect(css).toMatch(/\.cm-hl-md-char \{[^}]*var\(--md-char-color\)/);
    expect(css).not.toContain("cm-hl-inline-code");
  });
});
