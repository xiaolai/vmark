// @vitest-environment node
/**
 * The canonical-editor-text boundary.
 *
 * VMark already models line endings as METADATA — `documentStore` carries
 * `lineEnding`, and `saveToPath` applies it at write time. CodeMirror honours
 * that for free. ProseMirror does not: parsing CRLF markdown yields a text node
 * containing a literal carriage return, so in a CRLF file WYSIWYG sees no line
 * break at all, just a control character that then flows into word count,
 * search, lint and CJK formatting.
 *
 * This module is the one place external text becomes editor text. Metadata is
 * detected from the RAW string first — canonicalising before detecting would
 * destroy the very convention `lineEndingsOnSave: "preserve"` exists to keep.
 *
 * WI-1.1 — canonicalisation primitive, metadata ordering, BOM policy
 *
 * @coordinates-with utils/linebreakDetection.ts — detection this delegates to
 * @coordinates-with stores/documentStore — the consumer (WI-1.2)
 * @module utils/editorText.test
 */
import { describe, it, expect } from "vitest";
import { expectBoundedTime } from "@/test/timeBudget";
import { canonicalizeLineEndings, ingestExternalText } from "./editorText";
import { detectLinebreaks } from "./linebreakDetection";

const BOM = "﻿";

describe("canonicalizeLineEndings", () => {
  it.each([
    { label: "CRLF", input: "a\r\nb", expected: "a\nb" },
    { label: "lone CR", input: "a\rb", expected: "a\nb" },
    { label: "already LF", input: "a\nb", expected: "a\nb" },
    { label: "empty", input: "", expected: "" },
    { label: "only CRLF", input: "\r\n", expected: "\n" },
    { label: "only CR", input: "\r", expected: "\n" },
    { label: "mixed", input: "a\r\nb\rc\nd", expected: "a\nb\nc\nd" },
    { label: "trailing CRLF", input: "a\r\n", expected: "a\n" },
    { label: "consecutive CRLF", input: "a\r\n\r\nb", expected: "a\n\nb" },
  ])("converts $label", ({ input, expected }) => {
    expect(canonicalizeLineEndings(input)).toBe(expected);
  });

  it("is idempotent", () => {
    for (const s of ["a\r\nb", "a\rb", "a\nb", "", "\r\n\r\n", "中文\r\n内容"]) {
      expect(canonicalizeLineEndings(canonicalizeLineEndings(s))).toBe(
        canonicalizeLineEndings(s),
      );
    }
  });

  it("converts a lone CR inside a fenced block — canonicalisation is not markdown-aware", () => {
    // A CR is a control character wherever it sits. Making this markdown-aware
    // would mean parsing before canonicalising, which inverts the dependency.
    expect(canonicalizeLineEndings("```\ncode\r\nmore\n```")).toBe(
      "```\ncode\nmore\n```",
    );
  });

  it.each([
    { label: "CJK", input: "中文段落\r\n第二行" },
    { label: "surrogate pair", input: "𝕏𝕐\r\n𝕑" },
    { label: "combining marks", input: "é\r\nà" },
    { label: "RTL", input: "אב\r\nג" },
  ])("leaves $label untouched apart from EOL", ({ input }) => {
    expect(canonicalizeLineEndings(input)).toBe(input.replace(/\r\n?/g, "\n"));
  });

  it("handles 1 MiB of CRLF lines under 2 s and leaves no CR", () => {
    const line = "The quick brown fox jumps over the lazy dog.\r\n";
    const big = line.repeat(Math.ceil((1024 * 1024) / line.length));
    const started = performance.now();
    const out = canonicalizeLineEndings(big);
    expectBoundedTime(performance.now() - started, {
      budgetMs: 2000, livenessMs: 12_000,
      label: "editorText over a large document",
    });
    expect(out).not.toContain("\r");
  });
});

describe("ingestExternalText", () => {
  it("derives metadata from the RAW text and returns canonical content", () => {
    // The shape itself is the RED assertion: nothing today returns a canonical
    // body and its source metadata together, which is exactly how a caller ends
    // up canonicalising first and detecting a convention that no longer exists.
    expect(ingestExternalText(`${BOM}a\r\nb`)).toEqual({
      canonicalEditorText: "a\nb",
      lineEnding: "crlf",
      hardBreakStyle: "unknown",
      hasBom: true,
    });
  });

  it("reports lineEnding from the raw text even though the result has none", () => {
    const result = ingestExternalText("a\r\nb\r\nc");
    expect(result.lineEnding).toBe("crlf");
    expect(result.canonicalEditorText).not.toContain("\r");
  });

  it("strips only a LEADING BOM", () => {
    const result = ingestExternalText(`${BOM}title`);
    expect(result.hasBom).toBe(true);
    expect(result.canonicalEditorText).toBe("title");
  });

  it("keeps a BOM elsewhere in the text — that is content, not an encoding mark", () => {
    const result = ingestExternalText(`a${BOM}b`);
    expect(result.hasBom).toBe(false);
    expect(result.canonicalEditorText).toBe(`a${BOM}b`);
  });

  it("reports hasBom false for ordinary text", () => {
    expect(ingestExternalText("plain").hasBom).toBe(false);
  });

  it("carries hard-break style through", () => {
    expect(ingestExternalText("line  \nnext").hardBreakStyle).toBe("twoSpaces");
    expect(ingestExternalText("line\\\nnext").hardBreakStyle).toBe("backslash");
  });

  it.each([
    { label: "empty", input: "" },
    { label: "BOM only", input: BOM },
    { label: "single newline", input: "\n" },
  ])("handles $label without throwing", ({ input }) => {
    expect(() => ingestExternalText(input)).not.toThrow();
  });
});

describe("agreement with the existing detector", () => {
  // [CHAR] These pin current behaviour so a later change is a visible diff
  // rather than a silent one. They pass today by construction.
  it.each([
    "a\r\nb",
    "a\nb",
    "one\r\ntwo\nthree",
    "",
    "line  \nnext",
    "line\\\nnext",
  ])("delegates detection unchanged for %j", (input) => {
    const direct = detectLinebreaks(input);
    const viaIngest = ingestExternalText(input);
    expect(viaIngest.lineEnding).toBe(direct.lineEnding);
    expect(viaIngest.hardBreakStyle).toBe(direct.hardBreakStyle);
  });

  it("[CHAR] any CRLF marks the document crlf — this is NOT majority rule", () => {
    // Decision D2: current behaviour is pinned, not changed. One stray CRLF
    // among many LF lines still reports crlf. Majority-rule is a deferred
    // product decision; this test makes adopting it a visible diff.
    const mostlyLf = `${"a\n".repeat(50)}b\r\n${"c\n".repeat(50)}`;
    expect(ingestExternalText(mostlyLf).lineEnding).toBe("crlf");
  });

  it("[CHAR] hard-break detection is unaffected by canonicalisation order", () => {
    // Pins that detectHardBreakStyle already normalises internally, which is
    // why saveToPath's existing normalizeHardBreaks → normalizeLineEndings
    // order needs no change.
    const raw = "line  \r\nnext";
    expect(detectLinebreaks(raw).hardBreakStyle).toBe(
      detectLinebreaks(canonicalizeLineEndings(raw)).hardBreakStyle,
    );
  });
});
