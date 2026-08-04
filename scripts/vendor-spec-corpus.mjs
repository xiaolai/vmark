#!/usr/bin/env node
/**
 * Purpose: convert upstream markdown spec sources into VMark's vendored
 * corpus JSON shape (WI-0.2).
 *
 * Two input formats:
 *   - CommonMark `spec.json` (array of {markdown, html, example, section})
 *   - `spec.txt` (cmark family): 32-backtick `example` fences, markdown and
 *     expected output separated by a lone `.` line, tabs spelled `→`.
 *
 * Output wrapper (one file per corpus):
 *   { source, revision, license, examples: [{example, section, markdown, html}] }
 *
 * Upstream expected `html` is KEPT even though the gates' ruler is the
 * reference parser, not HTML — the vendored file preserves upstream data so a
 * future oracle does not require re-downloading a moving source.
 *
 * `example` numbers for spec.txt inputs are positions in THAT FILE's own
 * enumeration (spec.txt numbering restarts per file — IDs must say which file).
 *
 * Offline vendoring tool: run by hand, never at test time. Unit-tested via
 * `specTxtConverter.test.ts`, which imports the exported functions.
 *
 * @coordinates-with src/utils/markdownPipeline/__tests__/spec/corpusRegistry.ts
 * @module scripts/vendor-spec-corpus
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FENCE = "`".repeat(32);

/**
 * Parse a cmark-family spec.txt into its enumerated examples.
 * Returns every example with its file-position number and current section.
 */
export function parseSpecTxt(text) {
  const lines = text.split("\n");
  const examples = [];
  let section = "";
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Example bodies are consumed whole by the inner loop below, so a heading
    // seen here is always a real section heading, never example content.
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) section = heading[1].trim();
    if (line.startsWith(`${FENCE} example`)) {
      const body = [];
      i += 1;
      while (i < lines.length && lines[i] !== FENCE) {
        body.push(lines[i]);
        i += 1;
      }
      const dot = body.indexOf(".");
      const markdown = body.slice(0, dot).join("\n");
      const html = body.slice(dot + 1).join("\n");
      examples.push({
        example: examples.length + 1,
        section,
        markdown: restoreTabs(markdown) + "\n",
        html: restoreTabs(html) + (html.length > 0 ? "\n" : ""),
      });
    }
    i += 1;
  }
  return examples;
}

/** spec.txt spells literal tabs as `→` so they survive display. */
export function restoreTabs(text) {
  return text.replaceAll("→", "\t");
}

/**
 * Parse a markdown-it-testgen fixture file: repeating blocks of
 * `[optional title]\n.\n<markdown>\n.\n<expected html>\n.` — delimiters are
 * lines that are EXACTLY a dot. The title (last non-empty line before the
 * opening dot) becomes the example's section, so issue references like
 * "Issue #246" survive into ids' context.
 */
export function parseMarkdownItFixtures(text) {
  const lines = text.split("\n");
  const examples = [];
  let title = "";
  let i = 0;
  while (i < lines.length) {
    if (lines[i] !== ".") {
      if (lines[i].trim() !== "") title = lines[i].trim();
      i += 1;
      continue;
    }
    const md = [];
    i += 1;
    while (i < lines.length && lines[i] !== ".") {
      md.push(lines[i]);
      i += 1;
    }
    const html = [];
    i += 1;
    while (i < lines.length && lines[i] !== ".") {
      html.push(lines[i]);
      i += 1;
    }
    i += 1; // past the closing dot
    examples.push({
      example: examples.length + 1,
      section: title,
      markdown: md.join("\n") + "\n",
      html: html.join("\n") + (html.length > 0 ? "\n" : ""),
    });
  }
  return examples;
}

/** Keep only examples whose section is in `sections` (exact match). */
export function filterSections(examples, sections) {
  const wanted = new Set(sections);
  return examples.filter((e) => wanted.has(e.section));
}

/** Strip CommonMark spec.json entries to the corpus example shape. */
export function fromCommonMarkJson(entries) {
  return entries.map((e) => ({
    example: e.example,
    section: e.section,
    markdown: e.markdown,
    html: e.html,
  }));
}

/** Wrap examples with their provenance for the vendored file. */
export function wrapCorpus({ source, revision, license }, examples) {
  return { source, revision, license, examples };
}

function main() {
  const [mode, inPath, outPath, sectionsCsv] = process.argv.slice(2);
  if (!mode || !inPath || !outPath) {
    console.error(
      "Usage: vendor-spec-corpus.mjs <commonmark-json|spec-txt|markdown-it> <in> <out> [sections-csv]\n" +
        "  Provenance fields are read from env: CORPUS_SOURCE, CORPUS_REVISION, CORPUS_LICENSE",
    );
    process.exit(2);
  }
  const provenance = {
    source: process.env.CORPUS_SOURCE ?? "unknown",
    revision: process.env.CORPUS_REVISION ?? "unknown",
    license: process.env.CORPUS_LICENSE ?? "unknown",
  };
  const raw = readFileSync(inPath, "utf8");
  let examples;
  if (mode === "commonmark-json") {
    examples = fromCommonMarkJson(JSON.parse(raw));
  } else if (mode === "spec-txt") {
    examples = parseSpecTxt(raw);
    if (sectionsCsv) examples = filterSections(examples, sectionsCsv.split(","));
  } else if (mode === "markdown-it") {
    examples = parseMarkdownItFixtures(raw);
  } else {
    console.error(`Unknown mode: ${mode}`);
    process.exit(2);
  }
  writeFileSync(outPath, `${JSON.stringify(wrapCorpus(provenance, examples), null, 1)}\n`);
  console.log(`${outPath}: ${examples.length} examples`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
