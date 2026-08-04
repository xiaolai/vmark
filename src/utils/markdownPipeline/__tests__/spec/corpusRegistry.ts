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

/**
 * ADR-2's dialect-node-produced contract for roundtrip-only corpora: a
 * wiki-link corpus whose examples all parsed as plain text would trivially
 * roundtrip and prove nothing — a self-oracle. The gate counts the examples
 * whose VMark parse contains `nodeType` and requires EXACTLY the measured
 * number, so the dialect silently dying (or silently widening) both fail.
 */
export interface MustProduce {
  nodeType: string;
  exampleCount: number;
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
  /** Required for roundtrip-only dialect corpora; optional elsewhere. */
  mustProduce?: MustProduce;
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
  // ── WI-2.3: external corpora, routed per what each case actually tests ──
  {
    kind: "vendored-json",
    prefix: "cmreg",
    file: "cmark-regression.json",
    source: "https://raw.githubusercontent.com/commonmark/cmark/0.31.1/test/regression.txt",
    revision: "0.31.1",
    license: "BSD-2-Clause (spec text CC-BY-SA 4.0)",
    sha256: "c7799ca7aa2cbe8ce10aa1b14a4a5462d5a97b71da49a6fccac519b5cc5d0365",
    routes: { conformance: true, roundtrip: true },
  },
  {
    kind: "vendored-json",
    prefix: "gfmreg",
    file: "cmark-gfm-regression.json",
    source: "https://raw.githubusercontent.com/github/cmark-gfm/0.29.0.gfm.13/test/regression.txt",
    revision: "0.29.0.gfm.13",
    license: "BSD-2-Clause (spec text CC-BY-SA 4.0)",
    sha256: "7aed2291e4774a41ddba4c90bb558bc2f4d731e60230e9400f72f8053f000192",
    routes: { conformance: true, roundtrip: true },
  },
  {
    kind: "vendored-json",
    prefix: "gfmext",
    file: "cmark-gfm-extensions.json",
    source: "https://raw.githubusercontent.com/github/cmark-gfm/0.29.0.gfm.13/test/extensions.txt",
    revision: "0.29.0.gfm.13",
    license: "BSD-2-Clause (spec text CC-BY-SA 4.0)",
    sha256: "5a16e546b87a9ab74aa748cf0885d468a032a1acec0f07fcc4fb6f274127f570",
    routes: { conformance: true, roundtrip: true },
  },
  {
    // Parser-level CJK emphasis boundaries. Typing-level CJK boundary cases
    // live in the WI-1.3 typed-input matrix — route by what a case TESTS,
    // not by its filename.
    kind: "vendored-json",
    prefix: "cjk",
    file: "pulldown-cjk-emphasis.json",
    source:
      "https://raw.githubusercontent.com/pulldown-cmark/pulldown-cmark/5cc24e8c3536ceb2519baddb09327834ef6c4858/pulldown-cmark/specs/cjk_friendly_emphasis.txt",
    revision: "main@5cc24e8c (postdates v0.13.0)",
    license: "MIT",
    sha256: "d17d23697816658825bd8589bc4ef9169391f63ab99ec5dbe8eb86c686c82c97",
    routes: { conformance: true, roundtrip: true },
  },
  {
    // Roundtrip-only: [[wiki]] is VMark dialect the stock reference cannot
    // read, so a conformance route would only declare a blanket delta family
    // against a knowingly-inapplicable oracle (ADR-2 forbids exactly that).
    kind: "vendored-json",
    prefix: "wiki",
    file: "pulldown-wikilinks.json",
    source:
      "https://raw.githubusercontent.com/pulldown-cmark/pulldown-cmark/v0.13.0/pulldown-cmark/specs/wikilinks.txt",
    revision: "v0.13.0",
    license: "MIT",
    sha256: "ff538c83c4bcda443b570ca40abf35e003d485d20368d130355053b21ad0b0a1",
    routes: { conformance: false, roundtrip: true },
    mustProduce: { nodeType: "wikiLink", exampleCount: 7 },
  },
  {
    kind: "vendored-json",
    prefix: "math",
    file: "pulldown-math.json",
    source:
      "https://raw.githubusercontent.com/pulldown-cmark/pulldown-cmark/v0.13.0/pulldown-cmark/specs/math.txt",
    revision: "v0.13.0",
    license: "MIT",
    sha256: "dd44da6b45dd62b91ec357b3666bb84f3bd0383e0a96abae30e7d4b94778e5ed",
    routes: { conformance: false, roundtrip: true },
    mustProduce: { nodeType: "inlineMath", exampleCount: 37 },
  },
  {
    kind: "vendored-json",
    prefix: "mdx",
    file: "markdown-it-extras.json",
    source:
      "https://raw.githubusercontent.com/markdown-it/markdown-it/14.1.0/test/fixtures/markdown-it/commonmark_extras.txt",
    revision: "14.1.0",
    license: "MIT",
    sha256: "cc10035a31bcb2f495391246b385adfa8a9480010fcf0060d5904c8e41b80539",
    routes: { conformance: true, roundtrip: true },
  },
  {
    // WI-2.1: Tiptap's official markdown→PM-JSON pairs — an independent
    // oracle at the mdast→ProseMirror boundary neither spec gate pins.
    // Routed to NEITHER gate: its consumer is specTiptapOracle.test.ts,
    // which reads the file's extra `expectedOutput` field directly.
    kind: "vendored-json",
    prefix: "tiptap",
    file: "tiptap-conversion.json",
    source:
      "https://github.com/ueberdosis/tiptap/tree/5158212970344952dd9918b6a44bfb400d7fb6c1/packages/markdown/__tests__/conversion-files",
    revision: "main@51582129 (12 of 16 fixtures; custom-*/nested-nodes need Tiptap-internal extensions)",
    license: "MIT",
    sha256: "990ee9c9e3a3e9b6b7eeb33cf72b3e1aa64c7a863f5aab2a6dc8576d626d0ef0",
    routes: { conformance: false, roundtrip: false },
  },
  {
    // Security-input fixtures. Roundtrip verdicts pin the policy rewrites;
    // the EXPLICIT sanitization assertions live in specXss.test.ts.
    kind: "vendored-json",
    prefix: "xss",
    file: "markdown-it-xss.json",
    source:
      "https://raw.githubusercontent.com/markdown-it/markdown-it/14.1.0/test/fixtures/markdown-it/xss.txt",
    revision: "14.1.0",
    license: "MIT",
    sha256: "ee2aac2a58d868ead38f5a9b0067ef36f7cfbb4dc1176d7c9004593dc7c4f165",
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
  // The digest proves byte identity, not shape: validate what the gates
  // consume, and that the file's own provenance matches the registry's (the
  // registry may append commentary after the file's value, nothing else).
  if (!Array.isArray(parsed.examples) || parsed.examples.length === 0) {
    throw new Error(`Corpus ${entry.file}: no examples array`);
  }
  if (parsed.source !== entry.source) {
    throw new Error(
      `Corpus ${entry.file}: file source ${JSON.stringify(parsed.source)} ≠ registry ${JSON.stringify(entry.source)}`,
    );
  }
  if (!entry.revision.startsWith(parsed.revision)) {
    throw new Error(
      `Corpus ${entry.file}: registry revision ${JSON.stringify(entry.revision)} does not start with file revision ${JSON.stringify(parsed.revision)}`,
    );
  }
  if (!entry.license.startsWith(parsed.license)) {
    throw new Error(
      `Corpus ${entry.file}: registry license ${JSON.stringify(entry.license)} does not start with file license ${JSON.stringify(parsed.license)}`,
    );
  }
  const seenNumbers = new Set<number>();
  return parsed.examples.map((e) => {
    if (!Number.isInteger(e.example) || e.example < 1 || seenNumbers.has(e.example)) {
      throw new Error(
        `Corpus ${entry.file}: example number must be a unique positive integer, got ${String(e.example)}`,
      );
    }
    seenNumbers.add(e.example);
    if (typeof e.markdown !== "string" || typeof e.section !== "string") {
      throw new Error(`Corpus ${entry.file}: example ${e.example} lacks string markdown/section`);
    }
    return {
      id: `${entry.prefix}-${e.example}`,
      section: e.section,
      markdown: e.markdown,
    };
  });
}

/** Registry-wide integrity: prefixes globally unique regardless of routes,
 *  and every corpus loadable. Route-scoped dedup alone left route-less or
 *  disjoint-route corpora able to collide in ledger id space. */
export function validateRegistry(): void {
  const prefixes = new Set<string>();
  for (const entry of CORPORA) {
    if (prefixes.has(entry.prefix)) {
      throw new Error(`Duplicate corpus prefix: ${entry.prefix}`);
    }
    prefixes.add(entry.prefix);
    loadExamples(entry);
  }
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
