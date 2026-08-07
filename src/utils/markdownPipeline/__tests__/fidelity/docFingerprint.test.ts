// @vitest-environment node
/**
 * Tests for the semantic fingerprint backing the fidelity gate.
 *
 * The gate trusts this function to decide whether a round-trip changed meaning,
 * so it must be sensitive to everything that carries meaning (structure, marks,
 * link targets, heading level, text) and blind to provenance bookkeeping that
 * legitimately moves when a document is re-serialized.
 *
 * @module utils/markdownPipeline/__tests__/fidelity/docFingerprint.test
 */
import { describe, it, expect } from "vitest";
import { parseMarkdown } from "../../adapter";
import { getProductionSchema } from "@/test/productionSchema";
import { docFingerprint } from "./docFingerprint";

const schema = getProductionSchema();
const fp = (md: string): string => docFingerprint(parseMarkdown(schema, md));

describe("docFingerprint", () => {
  it("is identical for identical documents", () => {
    expect(fp("# Title\n\nBody text.\n")).toBe(fp("# Title\n\nBody text.\n"));
  });

  it("ignores where a node came from (sourceLine is provenance, not meaning)", () => {
    // Same document, reached via different amounts of leading blank space: the
    // recorded source lines differ, the meaning does not.
    expect(fp("Body text.\n")).toBe(fp("\n\nBody text.\n"));
  });

  it("distinguishes heading levels", () => {
    expect(fp("# Title\n")).not.toBe(fp("## Title\n"));
  });

  it("distinguishes a heading from a paragraph", () => {
    expect(fp("# Title\n")).not.toBe(fp("Title\n"));
  });

  it("distinguishes different text", () => {
    expect(fp("Hello.\n")).not.toBe(fp("Goodbye.\n"));
  });

  it("detects a dropped inline mark", () => {
    expect(fp("**bold**\n")).not.toBe(fp("bold\n"));
  });

  it("detects a changed link target", () => {
    expect(fp("[t](https://a.example)\n")).not.toBe(fp("[t](https://b.example)\n"));
  });

  it("detects a changed list type", () => {
    expect(fp("- one\n- two\n")).not.toBe(fp("1. one\n2. two\n"));
  });

  it("detects a deleted node", () => {
    expect(fp("# Title\n\nBody.\n")).not.toBe(fp("# Title\n"));
  });

  it("treats CJK text as significant", () => {
    expect(fp("中文文本\n")).not.toBe(fp("日本語テキスト\n"));
  });
});
