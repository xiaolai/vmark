/**
 * Markdown pipeline — reference conformance gate.
 *
 * Purpose: catch losses that happen at PARSE time, which no round-trip check
 * can see.
 *
 * `roundtripFidelity.test.ts` compares VMark's parse of the input against
 * VMark's parse of the output. That is the right question for serializer bugs,
 * but it is blind by construction to anything the PARSER drops: if a construct
 * is destroyed on the way in, both sides are equally destroyed and the
 * round-trip looks perfectly stable. The setext-heading defect is exactly that
 * shape — `remarkDisableSetextHeadings` removes the heading before the
 * serializer is ever involved, so the fingerprint, the golden and the
 * idempotence property all agree that nothing is wrong.
 *
 * The only way to see it is an INDEPENDENT ruler. This gate parses the same
 * corpus with stock `remark-parse` + `remark-gfm` — a CommonMark/GFM baseline
 * with none of VMark's plugins — and compares the top-level block structure.
 *
 * A divergence is not automatically a bug: VMark deliberately extends markdown
 * (alerts, details, wiki links, math, TOC) and deliberately narrows it in one
 * place. So every divergence must be DECLARED with a reason, and a declaration
 * that stops firing fails, the same ratchet the rest of the pipeline gates use.
 *
 * @coordinates-with ../characterization/corpus — the shared fixtures
 * @coordinates-with ../../parser.ts — VMark's configured MDAST parse
 * @coordinates-with fidelityLedger.ts — the round-trip half of the story
 * @module utils/markdownPipeline/__tests__/fidelity/referenceConformance.test
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root, RootContent } from "mdast";
import { parseMarkdownToMdast } from "../../parser";

const here = dirname(fileURLToPath(import.meta.url));
const corpusDir = join(here, "..", "characterization", "corpus");

const reference = unified().use(remarkParse).use(remarkGfm);

/** Top-level block shape: node types, with heading depth (the thing at issue). */
function blockShape(root: Root): string[] {
  return (root.children as RootContent[]).map((n) =>
    n.type === "heading" ? `heading(${(n as { depth: number }).depth})` : n.type,
  );
}

/**
 * Divergences between the CommonMark/GFM baseline and VMark's parse that have
 * been reviewed.
 *
 * `extension` — VMark sees MORE structure than the baseline, because it
 *   deliberately supports a superset (math, frontmatter, details, TOC, wiki
 *   links, alerts). Expected and healthy.
 * `defect` — VMark sees LESS. The author wrote standard markdown and VMark did
 *   not understand it. Counted and ratcheted DOWN only.
 */
interface Divergence {
  verdict: "extension" | "defect";
  reason: string;
}

const DECLARED_DIVERGENCES: Record<string, Divergence> = {
  "07-math.md": {
    verdict: "extension",
    reason: "remark-math reads `$$…$$` as a `math` block; the baseline has no math and sees a paragraph.",
  },
  "09-frontmatter.md": {
    verdict: "extension",
    reason:
      "remark-frontmatter reads the leading `---` fence as a `yaml` node. The baseline, lacking it, reads a thematic break followed by the YAML as prose — the classic reason frontmatter needs an explicit extension.",
  },
  "10-details.md": {
    verdict: "extension",
    reason: "remarkDetailsBlock folds the `<details>`/`<summary>` HTML pair into one `details` node.",
  },
  "13-toc.md": {
    verdict: "extension",
    reason: "remarkTocBlock converts a `[TOC]` paragraph into a `toc` node.",
  },
  "18-nested-details.md": {
    verdict: "extension",
    reason: "As 10-details.md, with nesting: several html/paragraph pairs fold into one `details` tree.",
  },
  "23-setext-headings.md": {
    verdict: "defect",
    reason:
      "The baseline reads setext headings; VMark reads paragraphs and a thematic break. `remarkDisableSetextHeadings` turns off micromark's `setextUnderline` so an empty nested list item (`  -`) cannot misparse as a heading underline — a real corruption it prevents. But the cure was never mitigated in the other direction, and only the first corruption was measured. The damage is invisible to every other gate: the round-trip is stable, so the golden, the idempotence property and the fidelity fingerprint all pass. `useTiptapFlush` then persists it to the author's file on the next keystroke. Fixing it means keeping setext on read (special-casing the `  -` misparse) while continuing to emit ATX on write.",
  },
};

/**
 * Ceiling on divergences whose verdict is `defect`.
 *
 * Ratchets DOWN only. Fix one, lower this number. Never raise it.
 */
const MAX_CONFORMANCE_DEFECTS = 1;

const corpus = readdirSync(corpusDir)
  .filter((f) => f.endsWith(".md"))
  .sort();

describe("markdown pipeline reference conformance", () => {
  it("discovers a non-empty corpus", () => {
    expect(corpus.length).toBeGreaterThan(0);
  });

  for (const file of corpus) {
    describe(file, () => {
      const input = readFileSync(join(corpusDir, file), "utf8");
      const baseline = blockShape(reference.parse(input) as Root);
      const vmark = blockShape(parseMarkdownToMdast(input));
      const diverges = JSON.stringify(baseline) !== JSON.stringify(vmark);
      const declared = DECLARED_DIVERGENCES[file];

      it("reads the same block structure as CommonMark/GFM", () => {
        expect(
          !diverges || declared
            ? ""
            : `\n  ${file}: VMark's parser disagrees with the CommonMark/GFM baseline.\n` +
              `  baseline: ${baseline.join(", ")}\n` +
              `  vmark:    ${vmark.join(", ")}\n` +
              `  If this is an intended extension, declare it in DECLARED_DIVERGENCES.\n`,
        ).toBe("");
      });

      it("declares no divergence that no longer occurs", () => {
        expect(
          !declared || diverges
            ? ""
            : `\n  ${file}: a divergence from the CommonMark baseline is declared, but the\n` +
              `  parses now agree. Delete the entry.\n`,
        ).toBe("");
      });
    });
  }

  it("holds the conformance-defect count at or below its ratchet", () => {
    const defects = Object.entries(DECLARED_DIVERGENCES)
      .filter(([, d]) => d.verdict === "defect")
      .map(([file]) => file);
    expect(
      defects.length <= MAX_CONFORMANCE_DEFECTS
        ? ""
        : `\n  ${defects.length} conformance defects declared but the ceiling is ${MAX_CONFORMANCE_DEFECTS}.\n` +
          `  ${defects.join("\n  ")}\n  This gate ratchets DOWN only — never raise the ceiling.\n`,
    ).toBe("");
  });
});
