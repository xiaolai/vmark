/**
 * WI-2.1 — the Tiptap conversion oracle: markdown → ProseMirror JSON pinned
 * by an INDEPENDENT implementation.
 *
 * Both spec gates measure VMark against remark-family parsers; none pins the
 * mdast→ProseMirror conversion itself. Tiptap's official `@tiptap/markdown`
 * fixtures pair markdown with the PM document its own converter produces —
 * the same schema family VMark ships — so they are a second opinion at
 * exactly the boundary the other gates skip.
 *
 * Comparison contract: the expected JSON is a SPEC, not a golden —
 *   - node/mark TYPE names must match (after the small name map below),
 *   - text must match,
 *   - every attr the EXPECTATION states must match; VMark's extra metadata
 *     attrs (sourceLine, blankLinesBefore, id, …) are tolerated,
 *   - children compare recursively, same arity.
 * Divergences are declared per fixture with a reason — exact-signature
 * discipline, same as every other ledger in this tier.
 *
 * @coordinates-with corpusRegistry.ts — the vendored fixture corpus entry
 * @module utils/markdownPipeline/__tests__/spec/specTiptapOracle.test
 */
import { describe, it, expect } from "vitest";
import "../../dialect";
import { parseMarkdown } from "../../adapter";
import { getProductionSchema } from "@/test/productionSchema";
import { CORPORA, corpusFileBytes, type VendoredCorpus } from "./corpusRegistry";

interface PmJson {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: PmJson[];
}

const entry = CORPORA.find(
  (c): c is VendoredCorpus => c.kind === "vendored-json" && c.prefix === "tiptap",
)!;
const FIXTURES = (
  JSON.parse(corpusFileBytes(entry)) as {
    examples: { example: number; section: string; markdown: string; expectedOutput: PmJson }[];
  }
).examples;

/** Tiptap default names → VMark schema names, where they differ. */
const NAME_MAP: Record<string, string> = {};

/** Fixtures whose divergence from the oracle is understood and declared. */
const DECLARED: Record<string, string> = {
  "Task List":
    "Representation difference, measured: VMark parses markdown task syntax " +
    "into bulletList > listItem{checked:boolean} (round-trips byte-perfectly " +
    "— probed), while Tiptap's converter emits its taskList/taskItem nodes. " +
    "VMark's taskList schema nodes belong to the toolbar-insertion path, not " +
    "the markdown parser.",
  "Ordered List":
    "Indentation semantics: the fixture nests sublists 2 spaces under '1. ' " +
    "markers; CommonMark requires the content offset (≥3 columns), so " +
    "remark — spec-correct — reads flat sibling items where Tiptap's laxer " +
    "converter nests. VMark follows the spec.",
  "Ordered List with Nested Bullet List":
    "Same 2-space-under-ordered-marker indentation as 'Ordered List': " +
    "CommonMark reads flat siblings; Tiptap's converter nests.",
  "Mixed List Types":
    "Grouping + representation: '- Test' followed by '- [ ] Test' items is " +
    "ONE bullet list with checked attrs on the task items to VMark, but a " +
    "bulletList followed by a separate taskList to Tiptap's converter.",
  "Bullet List with Numeric Punctuation":
    "Lazy-continuation semantics for a number-dot line ('1997. was a good " +
    "year') inside a list item differ: remark reads a nested ordered list " +
    "start where Tiptap's converter keeps paragraph text.",
};

type Mismatch = { path: string; what: string };

function compare(expected: PmJson, actual: PmJson | undefined, path: string, out: Mismatch[]): void {
  if (!actual) {
    out.push({ path, what: `missing node (expected ${expected.type})` });
    return;
  }
  const wantType = NAME_MAP[expected.type] ?? expected.type;
  if (actual.type !== wantType) {
    out.push({ path, what: `type ${actual.type} ≠ ${wantType}` });
    return;
  }
  if (expected.text !== undefined && actual.text !== expected.text) {
    out.push({ path, what: `text ${JSON.stringify(actual.text)} ≠ ${JSON.stringify(expected.text)}` });
  }
  for (const [key, value] of Object.entries(expected.attrs ?? {})) {
    if (JSON.stringify(actual.attrs?.[key]) !== JSON.stringify(value)) {
      out.push({ path, what: `attr ${key}: ${JSON.stringify(actual.attrs?.[key])} ≠ ${JSON.stringify(value)}` });
    }
  }
  const expectedMarks = expected.marks ?? [];
  const actualMarks = actual.marks ?? [];
  if (expectedMarks.length !== actualMarks.length) {
    out.push({ path, what: `mark count ${actualMarks.length} ≠ ${expectedMarks.length}` });
  } else {
    expectedMarks.forEach((m, i) => {
      const am = actualMarks[i];
      if (am.type !== (NAME_MAP[m.type] ?? m.type)) {
        out.push({ path, what: `mark[${i}] ${am.type} ≠ ${m.type}` });
        return;
      }
      for (const [key, value] of Object.entries(m.attrs ?? {})) {
        if (JSON.stringify(am.attrs?.[key]) !== JSON.stringify(value)) {
          out.push({ path, what: `mark[${i}].${key}: ${JSON.stringify(am.attrs?.[key])} ≠ ${JSON.stringify(value)}` });
        }
      }
    });
  }
  const expectedChildren = expected.content ?? [];
  const actualChildren = actual.content ?? [];
  if (expectedChildren.length !== actualChildren.length) {
    out.push({
      path,
      what: `child count ${actualChildren.length} ≠ ${expectedChildren.length} (actual: ${actualChildren.map((c) => c.type).join(",")})`,
    });
  }
  const longest = Math.max(expectedChildren.length, actualChildren.length);
  for (let i = 0; i < longest; i += 1) {
    if (expectedChildren[i]) {
      compare(expectedChildren[i], actualChildren[i], `${path}.${i}(${expectedChildren[i].type})`, out);
    }
  }
}

describe("Tiptap conversion oracle (independent md→PM pinning)", () => {
  it("the corpus vendored the expected number of fixtures", () => {
    expect(FIXTURES.length).toBe(12);
  });

  it.each(FIXTURES)("$section", (fixture) => {
    const doc = parseMarkdown(getProductionSchema(), fixture.markdown).toJSON() as PmJson;
    const mismatches: Mismatch[] = [];
    compare(fixture.expectedOutput, doc, "doc", mismatches);

    const declared = DECLARED[fixture.section];
    if (declared) {
      // A declared fixture must STILL diverge — otherwise the declaration is
      // stale and must be deleted.
      expect(mismatches.length, `declared divergence no longer occurs: ${declared}`).toBeGreaterThan(0);
      return;
    }
    expect(mismatches.map((m) => `${m.path}: ${m.what}`)).toEqual([]);
  });
});
