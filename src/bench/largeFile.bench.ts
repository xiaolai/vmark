/**
 * Large File Benchmark
 *
 * Parses a large markdown fixture to measure pipeline hot paths:
 *   - markdown → ProseMirror parse
 *   - ProseMirror → markdown serialize
 *   - ProseMirror state.apply() for single-char inserts (pure transform cost,
 *     does NOT exercise the Tiptap/editor plugin stack — for that, measure in
 *     the running app)
 *   - Full-doc descendants walk (baseline for plugin-scan costs)
 *
 * Fixture path is read from VMARK_BENCH_LARGE_FILE. If unset or missing,
 * benchmarks are skipped — keeps the suite portable across machines.
 *
 * Run:
 *   VMARK_BENCH_LARGE_FILE=/path/to/large.md pnpm vitest bench src/bench/largeFile.bench.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { bench, describe } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState } from "@tiptap/pm/state";
import { parseMarkdown, serializeMarkdown } from "@/utils/markdownPipeline/adapter";

const LARGE_FILE = process.env.VMARK_BENCH_LARGE_FILE;

if (!LARGE_FILE || !existsSync(LARGE_FILE)) {
  describe.skip("large file benchmark (fixture unavailable)", () => {
    bench("skipped — set VMARK_BENCH_LARGE_FILE to a readable markdown path", () => {}, {
      iterations: 1,
    });
  });
} else {
  const content = readFileSync(LARGE_FILE, "utf8");
  const schema = getSchema([StarterKit]);
  const parsed = parseMarkdown(schema, content);
  const baseState = EditorState.create({ doc: parsed, schema });

  describe(`large file (${(content.length / 1024).toFixed(0)}KB, ${content.split("\n").length} lines)`, () => {
    bench("parse markdown → ProseMirror", () => {
      parseMarkdown(schema, content);
    }, { iterations: 5, warmupIterations: 1 });

    bench("serialize ProseMirror → markdown", () => {
      serializeMarkdown(schema, parsed);
    }, { iterations: 5, warmupIterations: 1 });

    // Pure ProseMirror state.apply() cost for 100 single-char inserts.
    // This is the transform layer only — it does NOT exercise Tiptap's
    // `shouldRerenderOnTransaction` or any plugin view-layer work (those
    // need a mounted editor and must be measured in the running app).
    bench("apply 100 single-char inserts at doc start", () => {
      let state = baseState;
      for (let i = 0; i < 100; i++) {
        const tr = state.tr.insertText("a", 1);
        state = state.apply(tr);
      }
    }, { iterations: 20, warmupIterations: 2 });

    // Full-doc descendants walk — baseline for comparison. This is what the
    // footnote plugin used to do on every transaction before the cache.
    bench("descendants walk (full doc)", () => {
      let count = 0;
      parsed.descendants(() => {
        count++;
        return true;
      });
      // sink result to avoid dead-code elimination
      if (count < 0) throw new Error("unreachable");
    }, { iterations: 20, warmupIterations: 2 });
  });
}
