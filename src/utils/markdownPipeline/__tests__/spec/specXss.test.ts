/**
 * WI-2.3 — EXPLICIT sanitization assertions over the markdown-it xss corpus.
 *
 * The roundtrip gate's `policy` verdicts pin WHICH examples get rewritten;
 * this file asserts the security property itself, so it cannot be satisfied
 * by a ledger entry: after a full parse → ProseMirror → serialize roundtrip,
 * no link or image the re-parse reads may carry a scheme outside the
 * `isSafeUrl` allow-list. "The xss corpus is routed through the gates" is
 * plumbing; "no dangerous scheme survives the pipeline" is the claim.
 *
 * The corpus's own HTML side is NOT the oracle (markdown-it's sanitizer
 * decisions differ); the oracle is VMark's declared policy: `isSafeUrl`
 * returns true, or the URL was rewritten to about:blank.
 *
 * @coordinates-with corpusRegistry.ts — the xss corpus entry
 * @coordinates-with ../../urlValidation.ts — the policy under assertion
 * @module utils/markdownPipeline/__tests__/spec/specXss.test
 */
import { describe, it, expect } from "vitest";
import "../../dialect";
import { createProcessor } from "../../parser/processorFactory";
import { parseMarkdown, serializeMarkdown } from "../../adapter";
import { isSafeUrl } from "../../urlValidation";
import { getProductionSchema } from "@/test/productionSchema";
import { CORPORA, loadExamples, type VendoredCorpus } from "./corpusRegistry";
import type { RawNode } from "../../conformance/semanticProjection";

const schema = getProductionSchema();
const xssEntry = CORPORA.find(
  (c): c is VendoredCorpus => c.kind === "vendored-json" && c.prefix === "xss",
)!;
const EXAMPLES = loadExamples(xssEntry);

function mdastOf(markdown: string): RawNode {
  const processor = createProcessor(markdown);
  return processor.runSync(processor.parse(markdown)) as unknown as RawNode;
}

function collectUrls(node: RawNode, out: string[] = []): string[] {
  if ((node.type === "link" || node.type === "image") && typeof node.url === "string") {
    out.push(node.url);
  }
  for (const child of node.children ?? []) collectUrls(child, out);
  return out;
}

describe("xss corpus: no dangerous scheme survives the pipeline", () => {
  it("the corpus is a real security corpus — it contains dangerous inputs", () => {
    // A silently-neutered corpus (upstream edit, wrong file vendored) would
    // make every assertion below vacuously true.
    const dangerousInputs = EXAMPLES.filter((e) =>
      /javascript:|vbscript:|data:/i.test(e.markdown),
    );
    // Exact, because the corpus is digest-pinned: 9 of the 13 fixtures carry
    // a dangerous scheme in their markdown.
    expect(dangerousInputs.length).toBe(9);
  });

  it.each(EXAMPLES)("$id ($section)", (example) => {
    const output = serializeMarkdown(schema, parseMarkdown(schema, example.markdown));
    // Every link/image URL the RE-PARSE of the output reads must satisfy the
    // policy — either inherently safe or rewritten to about:blank. Asserting
    // on the re-parse (not the serialized bytes) means an encoding trick that
    // smuggles a scheme through serialization is still caught when it becomes
    // a live URL again.
    for (const url of collectUrls(mdastOf(output))) {
      // `about:blank` is the policy's own rewrite SENTINEL — inert by design,
      // yet not in the allow-list, so it must be accepted here explicitly.
      expect(
        isSafeUrl(url) || url === "about:blank",
        `${example.id}: unsafe URL survived the roundtrip: ${JSON.stringify(url)}`,
      ).toBe(true);
    }
  });

  it("a KNOWN-dangerous input is actually rewritten (probe, not just filtered)", () => {
    const output = serializeMarkdown(
      schema,
      parseMarkdown(schema, "[click](javascript:alert(1))\n"),
    );
    expect(output).toContain("about:blank");
    expect(output).not.toContain("javascript:");
  });
});
