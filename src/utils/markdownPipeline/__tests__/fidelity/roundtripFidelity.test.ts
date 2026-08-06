/**
 * Markdown pipeline — round-trip FIDELITY gate.
 *
 * Purpose: assert that opening an authored document and writing it back does
 * not change it — in meaning at all, and in text only in ways someone has
 * explicitly named and signed for.
 *
 * Why this exists alongside the characterization harness and the property test:
 * both check *stability*, never *fidelity*.
 *   - `roundtrip.property.test.ts` asserts idempotence — `rt(rt(x)) === rt(x)`.
 *     A transformation that destroys meaning on the FIRST pass and is stable
 *     afterwards satisfies it completely.
 *   - `characterization/` freezes `rt(x)` against a golden. A golden records
 *     what the pipeline does, so once approved, a corruption and a cosmetic
 *     normalization are indistinguishable in review.
 * Neither compares the result to the AUTHOR'S INPUT. This gate does.
 *
 * It asks two questions per document:
 *   1. SEMANTIC — does `parse(input)` still equal `parse(roundTrip(input))`?
 *      This is DERIVED from the parsed documents, not from anyone's reading of
 *      a text diff, so it cannot be talked out of. A drift here is real
 *      corruption and must be declared in SEMANTIC_DEFECTS.
 *   2. SOURCE — does the emitted markdown differ from what the author wrote?
 *      Differences are allowed only when a named rule in the ledger explains
 *      them, so every rewrite of a user's file is a decision on record.
 *
 * This matters because `useTiptapFlush` re-serializes the ProseMirror doc on
 * every debounced edit: whatever the pipeline changes on open is written back
 * to the user's file the moment they type.
 *
 * The corpus is shared with the characterization harness — one set of fixtures,
 * different questions asked of it.
 *
 * @coordinates-with ../characterization/corpus — the shared fixtures
 * @coordinates-with fidelityLedger.ts — per-document declared deviations
 * @coordinates-with normalizationRules.ts — the rule predicates
 * @coordinates-with docFingerprint.ts — the derived semantic comparison
 * @module utils/markdownPipeline/__tests__/fidelity/roundtripFidelity.test
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import { parseMarkdown, serializeMarkdown } from "../../adapter";
import { getProductionSchema } from "@/test/productionSchema";
import { hunkDiff, formatHunks, type Hunk } from "./hunkDiff";
import { docFingerprint } from "./docFingerprint";
import { RULES, type RuleName } from "./normalizationRules";
import { FIDELITY_LEDGER, SEMANTIC_DEFECTS, MAX_KNOWN_DEFECTS } from "./fidelityLedger";

const here = dirname(fileURLToPath(import.meta.url));
const corpusDir = join(here, "..", "characterization", "corpus");
const schema = getProductionSchema();

const roundTrip = (md: string): string => serializeMarkdown(schema, parseMarkdown(schema, md));
const fingerprint = (md: string): string => docFingerprint(parseMarkdown(schema, md));

const corpus = readdirSync(corpusDir)
  .filter((f) => f.endsWith(".md"))
  .sort();

/** Classify each hunk against the rules this document declares. */
function classify(
  hunks: readonly Hunk[],
  declared: readonly RuleName[],
): { unexplained: Hunk[]; used: Set<RuleName> } {
  const unexplained: Hunk[] = [];
  const used = new Set<RuleName>();
  for (const hunk of hunks) {
    const rule = declared.find((name) => RULES[name](hunk));
    if (rule) used.add(rule);
    else unexplained.push(hunk);
  }
  return { unexplained, used };
}

/** First differing line of two fingerprints, for a readable failure. */
function firstDivergence(a: string, b: string): string {
  const al = a.split("\n");
  const bl = b.split("\n");
  for (let i = 0; i < Math.max(al.length, bl.length); i += 1) {
    if (al[i] !== bl[i]) {
      return `      authored: ${al[i] ?? "<end of document>"}\n      returned: ${bl[i] ?? "<end of document>"}`;
    }
  }
  return "";
}

/** Optional triage dump: VMARK_FIDELITY_REPORT=<path> writes every deviation. */
const reportPath = process.env.VMARK_FIDELITY_REPORT;

describe("markdown pipeline round-trip fidelity", () => {
  // A silently-empty corpus would report green while guarding nothing.
  it("discovers a non-empty corpus", () => {
    expect(corpus.length).toBeGreaterThan(0);
  });

  if (reportPath) {
    it("writes the triage report", () => {
      const lines: string[] = [];
      for (const file of corpus) {
        const input = readFileSync(join(corpusDir, file), "utf8");
        const output = roundTrip(input);
        const hunks = hunkDiff(input, output);
        const semantic = fingerprint(input) === fingerprint(output) ? "stable" : "SEMANTIC DRIFT";
        lines.push(`### ${file} — ${hunks.length} deviation(s) — ${semantic}`);
        if (semantic !== "stable") lines.push(firstDivergence(fingerprint(input), fingerprint(output)));
        for (const h of hunks) {
          const matching = (Object.keys(RULES) as RuleName[]).filter((n) => RULES[n](h));
          lines.push(`  [${matching.join(",") || "UNCLASSIFIED"}]`, formatHunks([h]));
        }
        lines.push("");
      }
      writeFileSync(reportPath, lines.join("\n"));
    });
  }

  for (const file of corpus) {
    describe(file, () => {
      const input = readFileSync(join(corpusDir, file), "utf8");
      const output = roundTrip(input);
      const before = fingerprint(input);
      const after = fingerprint(output);
      const drifted = before !== after;
      const declaredDefect = SEMANTIC_DEFECTS[file];

      it("round-trips without changing the document's meaning", () => {
        expect(
          !drifted || declaredDefect
            ? ""
            : `\n  ${file}: the round-trip changed the parsed document.\n` +
              `  This is data corruption, not formatting — the rewrite is persisted by\n` +
              `  useTiptapFlush on the next edit. Fix it, or declare it in SEMANTIC_DEFECTS.\n` +
              `${firstDivergence(before, after)}\n`,
        ).toBe("");
      });

      it("declares no semantic defect that has been fixed", () => {
        expect(
          !declaredDefect || drifted
            ? ""
            : `\n  ${file}: SEMANTIC_DEFECTS claims this document is corrupted, but it now\n` +
              `  round-trips cleanly. Delete the entry and lower MAX_KNOWN_DEFECTS.\n`,
        ).toBe("");
      });

      const entries = FIDELITY_LEDGER[file] ?? [];
      const declared = entries.map((e) => e.rule);
      const { unexplained, used } = classify(hunkDiff(input, output), declared);

      it("changes the author's markdown only in declared ways", () => {
        expect(
          unexplained.length === 0
            ? ""
            : `\n  ${file}: ${unexplained.length} undeclared deviation(s).\n` +
              `  Add each to FIDELITY_LEDGER with a rule, a reason, and a verdict.\n` +
              `${formatHunks(unexplained)}\n`,
        ).toBe("");
      });

      it("declares no normalization rule that has stopped firing", () => {
        const stale = declared.filter((name) => !used.has(name));
        expect(
          stale.length === 0
            ? ""
            : `\n  ${file}: ledger declares ${stale.join(", ")}, which no longer fires.\n` +
              `  If the behavior was fixed or the fixture changed, delete the entry.\n`,
        ).toBe("");
      });
    });
  }

  it("defines no classifier the corpus never needs", () => {
    const declared = new Set(Object.values(FIDELITY_LEDGER).flatMap((es) => es.map((e) => e.rule)));
    const orphans = (Object.keys(RULES) as RuleName[]).filter((name) => !declared.has(name));
    expect(
      orphans.length === 0
        ? ""
        : `\n  ${orphans.join(", ")} defined in RULES but declared by no document.\n` +
          `  An unused classifier is a claim about behavior nothing verifies — delete it,\n` +
          `  or add the fixture that needs it.\n`,
    ).toBe("");
  });

  it("holds the known-defect count at or below its ratchet", () => {
    const defects = Object.keys(SEMANTIC_DEFECTS);
    expect(
      defects.length <= MAX_KNOWN_DEFECTS
        ? ""
        : `\n  ${defects.length} semantic defects declared but MAX_KNOWN_DEFECTS is ${MAX_KNOWN_DEFECTS}.\n` +
          `  ${defects.join("\n  ")}\n  This gate ratchets DOWN only — never raise the ceiling.\n`,
    ).toBe("");
  });
});
