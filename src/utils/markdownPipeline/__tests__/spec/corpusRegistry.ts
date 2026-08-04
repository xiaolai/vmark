/**
 * Purpose: the ONE list of spec corpora — which files exist, where they came
 * from, what may consume them, and the digest that proves they are unchanged
 * (WI-0.2, ADR-2/ADR-5).
 *
 * Both spec gates load examples exclusively through this module, so a corpus
 * cannot be consumed by one gate and forgotten by the other, and a corpus
 * list cannot fork across test files. Digests make silent mutation of a
 * vendored file fail loudly here; the merge-base ratchet
 * (`scripts/baselineRatchetManifest.mjs`) additionally refuses REMOVAL of
 * examples across commits — coverage only grows.
 *
 * IDs are `<prefix>-<example>` where `example` is the number in the SOURCE
 * FILE's own enumeration — spec.txt numbering restarts per file, so the
 * prefix names the file, and an id is stable as long as its upstream
 * revision is pinned.
 *
 * @coordinates-with specConformance.test.ts — parse-conformance consumer
 * @coordinates-with specRoundtrip.test.ts — roundtrip consumer
 * @coordinates-with ../../conformance/fixtures.ts — the VMark dialect manifest
 * @coordinates-with scripts/vendor-spec-corpus.mjs — how corpus files are made
 * @module utils/markdownPipeline/__tests__/spec/corpusRegistry
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURES } from "../../conformance/fixtures";

export interface CorpusRoutes {
  /** Compared against the stock remark reference parser. */
  conformance: boolean;
  /** Run through markdown → ProseMirror → markdown. */
  roundtrip: boolean;
}

export interface VendoredCorpus {
  kind: "vendored-json";
  /** Id prefix; also names the source file in ids (`cm-93`). */
  prefix: string;
  /** File name under `corpus/`. */
  file: string;
  source: string;
  revision: string;
  license: string;
  /** sha256 of the vendored file. Mutation fails the registry test. */
  sha256: string;
  routes: CorpusRoutes;
}

export interface FixtureCorpus {
  kind: "fixtures-manifest";
  prefix: string;
  routes: CorpusRoutes;
}

export type CorpusEntry = VendoredCorpus | FixtureCorpus;

export interface SpecExample {
  id: string;
  section: string;
  markdown: string;
}

export const CORPORA: readonly CorpusEntry[] = [
  {
    kind: "vendored-json",
    prefix: "cm",
    file: "commonmark-0.31.2.json",
    source: "https://spec.commonmark.org/0.31.2/spec.json",
    revision: "0.31.2",
    license: "CC-BY-SA 4.0",
    sha256: "24ba112c476dc0d04b126afd47b55563c5241fa213142f0d9f4f03f37d55b33b",
    routes: { conformance: true, roundtrip: true },
  },
  {
    kind: "vendored-json",
    prefix: "gfm",
    file: "gfm-extensions.json",
    source: "https://raw.githubusercontent.com/github/cmark-gfm/0.29.0.gfm.13/test/spec.txt",
    revision: "0.29.0.gfm.13 (extension sections only)",
    license: "CC-BY-SA 4.0",
    sha256: "3420e4e118a1128483fb157f3a55537070f4da782fb50faddef75ddd1c8962a4",
    routes: { conformance: true, roundtrip: true },
  },
  {
    kind: "fixtures-manifest",
    prefix: "vmark",
    routes: { conformance: true, roundtrip: true },
  },
] as const;

const here = dirname(fileURLToPath(import.meta.url));

interface VendoredFileShape {
  source: string;
  revision: string;
  license: string;
  examples: { example: number; section: string; markdown: string }[];
}

/** Raw file bytes of a vendored corpus — digest checks read through here. */
export function corpusFileBytes(entry: VendoredCorpus): string {
  return readFileSync(join(here, "corpus", entry.file), "utf8");
}

export function sha256Of(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Load one corpus's examples, verifying the digest first. Fails loud. */
export function loadExamples(entry: CorpusEntry): SpecExample[] {
  if (entry.kind === "fixtures-manifest") {
    return FIXTURES.map((f) => ({
      id: `${entry.prefix}-${f.id}`,
      section: f.contentClass,
      markdown: f.markdown,
    }));
  }
  const raw = corpusFileBytes(entry);
  const digest = sha256Of(raw);
  if (digest !== entry.sha256) {
    throw new Error(
      `Corpus ${entry.file} digest mismatch: registry pins ${entry.sha256}, ` +
        `file is ${digest}. A vendored corpus must not change silently — ` +
        `re-vendor deliberately and update the registry (and expect the ` +
        `merge-base ratchet to demand examples only be added, never removed).`,
    );
  }
  const parsed = JSON.parse(raw) as VendoredFileShape;
  return parsed.examples.map((e) => ({
    id: `${entry.prefix}-${e.example}`,
    section: e.section,
    markdown: e.markdown,
  }));
}

/** Every example a given gate consumes, across all corpora, id-deduplicated. */
export function examplesForRoute(route: keyof CorpusRoutes): SpecExample[] {
  const out: SpecExample[] = [];
  const seen = new Set<string>();
  for (const entry of CORPORA) {
    if (!entry.routes[route]) continue;
    for (const example of loadExamples(entry)) {
      if (seen.has(example.id)) {
        throw new Error(`Duplicate corpus id: ${example.id}`);
      }
      seen.add(example.id);
      out.push(example);
    }
  }
  return out;
}
