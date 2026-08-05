/**
 * Purpose: the ONE loader for the vendored spec corpora.
 *
 * `specConformance.test.ts` and `specRoundtrip.test.ts` sweep the same three
 * corpora and had independent copies of this loader — so validation added to
 * one silently did not protect the other, which is exactly how two gates
 * drift into checking different things while both report green.
 *
 * @coordinates-with utils/markdownPipeline/__tests__/spec/corpus/*.json — the vendored examples (see README.md)
 * @coordinates-with utils/markdownPipeline/conformance/fixtures.ts — the VMark dialect manifest
 * @module test/markdownSpecCorpus
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FIXTURES } from "@/utils/markdownPipeline/conformance/fixtures";

const here = dirname(fileURLToPath(import.meta.url));
/** The vendored corpora live beside the gates that sweep them. */
const CORPUS_DIR = join(
  here,
  "..",
  "utils",
  "markdownPipeline",
  "__tests__",
  "spec",
  "corpus",
);

export interface SpecExample {
  /** Stable id: `cm-<n>`, `gfm-<n>` or `vmark-<fixture id>`. */
  id: string;
  section: string;
  markdown: string;
}

interface SpecCorpusFile {
  examples: { example: number; section: string; markdown: string }[];
}

function loadCorpus(file: string, prefix: string): SpecExample[] {
  const raw = JSON.parse(
    readFileSync(join(CORPUS_DIR, file), "utf8"),
  ) as SpecCorpusFile;
  return raw.examples.map((e) => ({
    id: `${prefix}-${e.example}`,
    section: e.section,
    markdown: e.markdown,
  }));
}

export const COMMONMARK: readonly SpecExample[] = loadCorpus(
  "commonmark-0.31.2.json",
  "cm",
);
export const GFM: readonly SpecExample[] = loadCorpus("gfm-extensions.json", "gfm");
export const VMARK_FIXTURES: readonly SpecExample[] = FIXTURES.map((f) => ({
  id: `vmark-${f.id}`,
  section: f.contentClass,
  markdown: f.markdown,
}));

/** Every example both spec gates sweep, in corpus order. */
export const ALL_EXAMPLES: readonly SpecExample[] = [
  ...COMMONMARK,
  ...GFM,
  ...VMARK_FIXTURES,
];

/** Pinned sizes — a lower bound would let vendored cases vanish silently. */
export const EXPECTED_COMMONMARK_COUNT = 652;
export const EXPECTED_GFM_COUNT = 24;

/** Ids of examples whose record is unusable (empty body or blank section). */
export function malformedExampleIds(): string[] {
  return ALL_EXAMPLES.filter(
    (e) =>
      typeof e.markdown !== "string" ||
      e.markdown.length === 0 ||
      typeof e.section !== "string" ||
      e.section.trim() === "",
  ).map((e) => e.id);
}
