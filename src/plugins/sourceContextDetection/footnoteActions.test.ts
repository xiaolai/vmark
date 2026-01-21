import { describe, it, expect } from "vitest";
import {
  parseReferences,
  parseDefinitions,
  renumberFootnotes,
  cleanupOrphanedDefinitions,
} from "./footnoteActions";

describe("footnoteActions", () => {
  // ===========================================
  // Reference Parsing
  // ===========================================
  describe("parseReferences", () => {
    it("finds numeric labels", () => {
      const refs = parseReferences("text [^1] more [^2]");
      expect(refs).toHaveLength(2);
      expect(refs[0].label).toBe("1");
      expect(refs[1].label).toBe("2");
    });

    it("finds alphanumeric labels", () => {
      const refs = parseReferences("text [^note] more [^ref-1] and [^my_ref]");
      expect(refs).toHaveLength(3);
      expect(refs[0].label).toBe("note");
      expect(refs[1].label).toBe("ref-1");
      expect(refs[2].label).toBe("my_ref");
    });

    it("records correct positions", () => {
      const doc = "text [^1] more";
      const refs = parseReferences(doc);
      expect(refs[0].start).toBe(5);
      expect(refs[0].end).toBe(9);
      expect(doc.slice(refs[0].start, refs[0].end)).toBe("[^1]");
    });

    it("ignores definition markers", () => {
      const refs = parseReferences("[^1]: this is a definition");
      expect(refs).toHaveLength(0);
    });

    it("finds reference before definition on same line", () => {
      const refs = parseReferences("See [^1] below\n\n[^1]: definition");
      expect(refs).toHaveLength(1);
      expect(refs[0].label).toBe("1");
    });

    it("ignores references in fenced code blocks", () => {
      const doc = "text [^1]\n\n```\n[^2] inside code\n```\n\nmore [^3]";
      const refs = parseReferences(doc);
      expect(refs).toHaveLength(2);
      expect(refs[0].label).toBe("1");
      expect(refs[1].label).toBe("3");
    });

    it("ignores references in indented code blocks", () => {
      const doc = "text [^1]\n\n    [^2] indented code\n\nmore [^3]";
      const refs = parseReferences(doc);
      expect(refs).toHaveLength(2);
      expect(refs[0].label).toBe("1");
      expect(refs[1].label).toBe("3");
    });

    it("handles empty document", () => {
      expect(parseReferences("")).toHaveLength(0);
    });

    it("handles document with no footnotes", () => {
      expect(parseReferences("Just plain text")).toHaveLength(0);
    });

    it("handles consecutive references", () => {
      const refs = parseReferences("[^1][^2][^3]");
      expect(refs).toHaveLength(3);
    });

    // Malformed input tests - document expected behavior
    it("ignores empty label [^]", () => {
      const refs = parseReferences("text [^] more");
      expect(refs).toHaveLength(0);
    });

    it("ignores label with spaces [^a b]", () => {
      const refs = parseReferences("text [^a b] more");
      expect(refs).toHaveLength(0);
    });

    it("ignores label with special chars [^a:b]", () => {
      const refs = parseReferences("text [^a:b] more [^a.b]");
      expect(refs).toHaveLength(0);
    });

    it("ignores unclosed bracket [^1", () => {
      const refs = parseReferences("text [^1 more");
      expect(refs).toHaveLength(0);
    });
  });

  // ===========================================
  // Definition Parsing
  // ===========================================
  describe("parseDefinitions", () => {
    it("parses single-line definition", () => {
      const doc = "[^1]: Simple definition";
      const defs = parseDefinitions(doc);
      expect(defs).toHaveLength(1);
      expect(defs[0].label).toBe("1");
      expect(defs[0].content).toBe("Simple definition");
    });

    it("parses alphanumeric labels", () => {
      const doc = "[^my-note]: Content here";
      const defs = parseDefinitions(doc);
      expect(defs[0].label).toBe("my-note");
      expect(defs[0].content).toBe("Content here");
    });

    it("parses multi-line definition with 4-space indent", () => {
      const doc = "[^1]: First line\n    Second line\n    Third line";
      const defs = parseDefinitions(doc);
      expect(defs).toHaveLength(1);
      expect(defs[0].content).toBe("First line\n    Second line\n    Third line");
    });

    it("parses multi-line definition with tab indent", () => {
      const doc = "[^1]: First line\n\tSecond line\n\tThird line";
      const defs = parseDefinitions(doc);
      expect(defs).toHaveLength(1);
      expect(defs[0].content).toBe("First line\n\tSecond line\n\tThird line");
    });

    it("stops at next definition", () => {
      const doc = "[^1]: First def\n    Continued\n[^2]: Second def";
      const defs = parseDefinitions(doc);
      expect(defs).toHaveLength(2);
      expect(defs[0].label).toBe("1");
      expect(defs[0].content).toBe("First def\n    Continued");
      expect(defs[1].label).toBe("2");
      expect(defs[1].content).toBe("Second def");
    });

    it("stops at non-indented non-blank line", () => {
      const doc = "[^1]: First line\n    Continued\nNormal paragraph";
      const defs = parseDefinitions(doc);
      expect(defs).toHaveLength(1);
      expect(defs[0].content).toBe("First line\n    Continued");
    });

    it("includes blank lines within definition", () => {
      const doc = "[^1]: First line\n\n    After blank\n    More";
      const defs = parseDefinitions(doc);
      expect(defs).toHaveLength(1);
      expect(defs[0].content).toBe("First line\n\n    After blank\n    More");
    });

    it("records correct positions", () => {
      const doc = "text\n\n[^1]: Definition";
      const defs = parseDefinitions(doc);
      expect(defs[0].start).toBe(6);
      expect(doc.slice(defs[0].start, defs[0].end)).toBe("[^1]: Definition");
    });

    it("ignores definitions in fenced code blocks", () => {
      const doc = "```\n[^1]: fake\n```\n[^2]: real";
      const defs = parseDefinitions(doc);
      expect(defs).toHaveLength(1);
      expect(defs[0].label).toBe("2");
    });

    it("handles empty definition", () => {
      const doc = "[^1]: ";
      const defs = parseDefinitions(doc);
      expect(defs).toHaveLength(1);
      expect(defs[0].content).toBe("");
    });

    it("handles definition with only whitespace content", () => {
      const doc = "[^1]:    ";
      const defs = parseDefinitions(doc);
      expect(defs).toHaveLength(1);
      expect(defs[0].content).toBe("   ");
    });

    it("handles multiple definitions", () => {
      const doc = "[^1]: One\n[^2]: Two\n[^3]: Three";
      const defs = parseDefinitions(doc);
      expect(defs).toHaveLength(3);
    });

    it("handles empty document", () => {
      expect(parseDefinitions("")).toHaveLength(0);
    });
  });

  // ===========================================
  // Renumbering
  // ===========================================
  describe("renumberFootnotes", () => {
    it("renumbers out-of-order references", () => {
      const doc = "A[^2] B[^1]\n\n[^2]: Two\n[^1]: One";
      const result = renumberFootnotes(doc);
      expect(result).not.toBeNull();
      expect(result).toContain("A[^1]");
      expect(result).toContain("B[^2]");
      expect(result).toContain("[^1]: Two");
      expect(result).toContain("[^2]: One");
    });

    it("handles duplicate references (same label used twice)", () => {
      const doc = "A[^1] B[^2] C[^1]\n\n[^1]: One\n[^2]: Two";
      const result = renumberFootnotes(doc);
      // Already sequential with definitions at end - no change needed
      // If result is null, original doc is already correct
      const output = result ?? doc;
      expect(output).toContain("A[^1]");
      expect(output).toContain("B[^2]");
      expect(output).toContain("C[^1]");
    });

    it("returns null when already sequential", () => {
      const doc = "A[^1] B[^2]\n\n[^1]: One\n[^2]: Two";
      expect(renumberFootnotes(doc)).toBeNull();
    });

    it("moves definitions to document end", () => {
      const doc = "[^1]: Early def\n\nText [^1] here\n\nMore text";
      const result = renumberFootnotes(doc);
      expect(result).not.toBeNull();
      // Definition should be at the end
      expect(result).toMatch(/More text\n\n\[/);
    });

    it("orders definitions by reference appearance", () => {
      const doc = "First [^b] then [^a]\n\n[^a]: Alpha\n[^b]: Beta";
      const result = renumberFootnotes(doc);
      expect(result).not.toBeNull();
      // [^b] appears first, so it becomes [^1]
      // [^a] appears second, so it becomes [^2]
      const defSection = result!.split("\n\n").pop()!;
      const firstDef = defSection.indexOf("[^1]:");
      const secondDef = defSection.indexOf("[^2]:");
      expect(firstDef).toBeLessThan(secondDef);
      expect(result).toContain("[^1]: Beta");
      expect(result).toContain("[^2]: Alpha");
    });

    it("removes orphaned definitions", () => {
      const doc = "Text [^1]\n\n[^1]: Used\n[^2]: Orphan";
      const result = renumberFootnotes(doc);
      expect(result).toContain("[^1]: Used");
      expect(result).not.toContain("[^2]");
      expect(result).not.toContain("Orphan");
    });

    it("creates empty definition for references without definition", () => {
      const doc = "Text [^1] and [^2]\n\n[^1]: Has def";
      const result = renumberFootnotes(doc);
      expect(result).not.toBeNull();
      expect(result).toContain("[^1]: Has def");
      expect(result).toContain("[^2]: ");
    });

    it("preserves multi-line definitions", () => {
      // Use out-of-order label to force renumbering
      const doc = "Text [^2]\n\n[^2]: Line one\n    Line two\n    Line three";
      const result = renumberFootnotes(doc);
      expect(result).not.toBeNull();
      expect(result).toContain("[^1]: Line one\n    Line two\n    Line three");
    });

    it("converts alphanumeric labels to sequential numbers", () => {
      const doc = "Text [^note] and [^ref]\n\n[^note]: Note content\n[^ref]: Ref content";
      const result = renumberFootnotes(doc);
      expect(result).not.toBeNull();
      expect(result).toContain("[^1]");
      expect(result).toContain("[^2]");
      expect(result).not.toContain("[^note]");
      expect(result).not.toContain("[^ref]");
    });

    it("ignores references and definitions in code blocks", () => {
      const doc = "Text [^1]\n\n```\n[^2]: fake\nsome [^3] ref\n```\n\n[^1]: Real";
      const result = renumberFootnotes(doc);
      // Only [^1] ref and [^1] def are outside code blocks - already correct
      // If result is null, original doc is already correct
      const output = result ?? doc;
      expect(output).toContain("```\n[^2]: fake\nsome [^3] ref\n```");
      expect(output).toContain("[^1]: Real");
    });

    it("returns null for empty document", () => {
      expect(renumberFootnotes("")).toBeNull();
    });

    it("returns null for document without footnotes", () => {
      expect(renumberFootnotes("Just text without footnotes")).toBeNull();
    });

    it("handles single footnote", () => {
      const doc = "Text [^5]\n\n[^5]: Definition";
      const result = renumberFootnotes(doc);
      expect(result).not.toBeNull();
      expect(result).toContain("[^1]");
      expect(result).not.toContain("[^5]");
    });

    it("adds proper spacing before definitions section", () => {
      const doc = "Text [^2]\n\n[^2]: Def";
      const result = renumberFootnotes(doc);
      expect(result).not.toBeNull();
      // Should have exactly one blank line before definitions
      expect(result).toMatch(/Text \[\^1\]\n\n\[\^1\]: Def$/);
    });
  });

  // ===========================================
  // Orphan Cleanup
  // ===========================================
  describe("cleanupOrphanedDefinitions", () => {
    it("removes definitions without references", () => {
      const doc = "Text\n\n[^1]: Orphan";
      const result = cleanupOrphanedDefinitions(doc);
      expect(result).not.toBeNull();
      expect(result).not.toContain("[^1]");
      expect(result).not.toContain("Orphan");
    });

    it("returns null when no orphans", () => {
      const doc = "Text [^1]\n\n[^1]: Used";
      expect(cleanupOrphanedDefinitions(doc)).toBeNull();
    });

    it("keeps definitions with references, removes orphans", () => {
      const doc = "Text [^1]\n\n[^1]: Used\n[^2]: Orphan";
      const result = cleanupOrphanedDefinitions(doc);
      expect(result).not.toBeNull();
      expect(result).toContain("[^1]: Used");
      expect(result).not.toContain("[^2]");
      expect(result).not.toContain("Orphan");
    });

    it("handles multi-line orphaned definitions", () => {
      const doc = "Text\n\n[^1]: Orphan line 1\n    Orphan line 2";
      const result = cleanupOrphanedDefinitions(doc);
      expect(result).not.toBeNull();
      expect(result).not.toContain("Orphan");
    });

    it("returns null for empty document", () => {
      expect(cleanupOrphanedDefinitions("")).toBeNull();
    });

    it("handles all definitions being orphans", () => {
      const doc = "Text\n\n[^1]: One\n[^2]: Two";
      const result = cleanupOrphanedDefinitions(doc);
      expect(result).toBe("Text");
    });
  });
});
