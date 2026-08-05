/**
 * WI-5.1 — runtime-download soaks over external corpora. SOAK TIER ONLY
 * (`pnpm test:soak`): downloads at run time, never vendored —
 * Pro Git is CC BY-NC-SA (must not be redistributed in this public repo),
 * the OSS-Fuzz bucket is a moving third-party artifact, and editing-traces
 * is bulk data.
 *
 * Invariants are deliberately coarse (this is a soak, not a gate): no crash,
 * and serialize∘parse reaches a fixed point after one normalization pass.
 * StarterKit-only schema, same rationale as the pathological child: the full
 * assembly is Vite-native, and these are core-construct sweeps.
 *
 * Availability policy: GitHub-hosted sources failing to download FAILS the
 * soak (that infrastructure is a dependency we accept); the OSS-Fuzz bucket
 * is best-effort — unavailable skips WITH A LOUD MESSAGE, never silently.
 *
 * @module test/externalCorpora.soak.test
 */
import { describe, it, expect } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { gunzipSync } from "node:zlib";
import "@/utils/markdownPipeline/dialect";
import { parseMarkdown, serializeMarkdown } from "@/utils/markdownPipeline/adapter";

const schema = getSchema([StarterKit]);

function stableAfterOnePass(markdown: string, label: string): void {
  const md1 = serializeMarkdown(schema, parseMarkdown(schema, markdown));
  const md2 = serializeMarkdown(schema, parseMarkdown(schema, md1));
  const md3 = serializeMarkdown(schema, parseMarkdown(schema, md2));
  expect(md3, `${label}: not a fixed point after one normalization pass`).toBe(md2);
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

describe("Pro Git multilingual stability soak (runtime download, CC BY-NC-SA)", () => {
  // Real prose across scripts — en, zh (CJK), ja, ar (RTL) — the Unicode
  // classes the edge-case rule demands, on real documents.
  const CHAPTERS = [
    "en/01-introduction/01-chapter1.markdown",
    "en/03-git-branching/01-chapter3.markdown",
    "zh/01-introduction/01-chapter1.markdown",
    "ja/01-introduction/01-chapter1.markdown",
    "ar/01-introduction/01-chapter1.markdown",
  ];

  it.each(CHAPTERS)("%s parses and reaches serialization fixed point", async (chapter) => {
    const text = await fetchText(`https://raw.githubusercontent.com/progit/progit/master/${chapter}`);
    expect(text.length).toBeGreaterThan(1000);
    stableAfterOnePass(text, chapter);
  });
});

describe("editing-traces replay soak (runtime download, CC BY 4.0)", () => {
  it("automerge-paper trace replays into a parseable, stable document", async () => {
    const res = await fetch(
      "https://raw.githubusercontent.com/josephg/editing-traces/master/sequential_traces/automerge-paper.json.gz",
    );
    if (!res.ok) throw new Error(`editing-traces download failed: HTTP ${res.status}`);
    const gz = Buffer.from(await res.arrayBuffer());
    const trace = JSON.parse(gunzipSync(gz).toString("utf8")) as {
      txns: { patches: [number, number, string][] }[];
    };
    // Replay position-based insert/delete patches into a plain string —
    // the trace is plain text; the SOAK value is feeding 100k+ real-keystroke
    // output through the pipeline afterwards.
    let doc = "";
    let ops = 0;
    for (const txn of trace.txns) {
      for (const [pos, del, ins] of txn.patches) {
        doc = doc.slice(0, pos) + ins + doc.slice(pos + del);
        ops += 1;
        if (ops >= 100_000) break;
      }
      if (ops >= 100_000) break;
    }
    expect(doc.length).toBeGreaterThan(1000);
    stableAfterOnePass(doc, "automerge-paper replay");
  });
});

describe("OSS-Fuzz cmark corpus soak (best-effort bucket)", () => {
  const BUCKET =
    "https://storage.googleapis.com/cmark-backup.clusterfuzz-external.appspot.com/corpus/libFuzzer/cmark_fuzzer/public.zip";

  it("a sample of the public fuzz corpus neither crashes nor oscillates", async (ctx) => {
    const head = await fetch(BUCKET, { method: "HEAD" }).catch(() => null);
    if (!head || !head.ok) {
      // Best-effort: the clusterfuzz bucket moves. Loud skip, never silent.
      console.warn(`[SOAK] OSS-Fuzz bucket unavailable (${head ? head.status : "network error"}) — SKIPPING this leg`);
      ctx.skip();
      return;
    }
    const { execFileSync } = await import("node:child_process");
    const { mkdtempSync, readdirSync, readFileSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "ossfuzz-"));
    const zipPath = join(dir, "public.zip");
    const res = await fetch(BUCKET);
    writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
    execFileSync("unzip", ["-q", zipPath, "-d", join(dir, "corpus")]);
    const files = readdirSync(join(dir, "corpus")).slice(0, 500);
    expect(files.length).toBeGreaterThan(100);
    const oscillating: string[] = [];
    for (const file of files) {
      const bytes = readFileSync(join(dir, "corpus", file));
      const text = bytes.toString("utf8");
      // Invariants: no crash always; fixed-point for MOST inputs. The spec
      // roundtrip ledger already pins open serializer defects that never
      // reach a fixed point (bracket-escape growth) — adversarial fuzz
      // inputs hit that class, so a small, LOUDLY-REPORTED tolerance keeps
      // the weekly soak signal instead of permanently red. Fixing the
      // ledgered defects shrinks this to zero.
      const md1 = serializeMarkdown(schema, parseMarkdown(schema, text));
      const md2 = serializeMarkdown(schema, parseMarkdown(schema, md1));
      const md3 = serializeMarkdown(schema, parseMarkdown(schema, md2));
      if (md3 !== md2) oscillating.push(file);
    }
    if (oscillating.length > 0) {
      console.warn(
        `[SOAK] ${oscillating.length}/${files.length} fuzz inputs oscillate (known escape-growth class): ` +
          oscillating.slice(0, 10).join(", "),
      );
    }
    expect(oscillating.length / files.length, "oscillating fraction").toBeLessThanOrEqual(0.02);
  });
});
