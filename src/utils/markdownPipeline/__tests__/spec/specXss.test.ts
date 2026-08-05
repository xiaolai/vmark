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
 * decisions differ); the oracle is VMark's declared policy.
 *
 * THAT POLICY CHANGED. Rewriting an unsafe URL to `about:blank` at the
 * MDAST→PM boundary corrupted the author's file on save — opening and saving
 * turned `[x](s3://bucket/key)` into `[x](about:blank)` — so storage now
 * keeps every URL VERBATIM and containment lives at the sinks that actually
 * activate a URL: Tiptap's `renderHTML` refuses to emit a dangerous href,
 * and `openExternalLink` allow-lists schemes (with a deny floor no user
 * setting can lift) before the OS opener sees one.
 *
 * So the claim asserted here is the one the pipeline still owes: a dangerous
 * scheme must survive UNCHANGED (no silent rewrite, no silent laundering
 * into something that looks safe), and `isSafeUrl` must still classify it as
 * unsafe so those sinks refuse it. The end-to-end containment proof lives in
 * `services/navigation/linkSecurity.test.ts`.
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
    const before = collectUrls(mdastOf(example.markdown));
    const after = collectUrls(mdastOf(output));
    // 1. No laundering: the roundtrip must not turn an unsafe URL into one
    //    that reads as safe. That is the failure mode a storage rewrite was
    //    meant to prevent and the one the sinks cannot catch, because by
    //    then the URL already looks legitimate.
    expect(
      after.filter((u) => !isSafeUrl(u)).length,
      `${example.id}: unsafe-URL count changed across the roundtrip`,
    ).toBe(before.filter((u) => !isSafeUrl(u)).length);
    // 2. No rewrite: the author's URL is preserved byte for byte.
    expect(after, `${example.id}: a URL was rewritten on save`).toEqual(before);
  });

  it("a KNOWN-dangerous input is preserved, and still classified unsafe", () => {
    // Preserved (the editor is not allowed to rewrite the author's file) …
    const output = serializeMarkdown(
      schema,
      parseMarkdown(schema, "[click](javascript:alert(1))\n"),
    );
    expect(output).toContain("javascript:alert(1)");
    expect(output).not.toContain("about:blank");
    // … and still recognised as unsafe, which is what makes the render and
    // activation sinks refuse it (proved end-to-end in linkSecurity.test.ts).
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
  });
});
