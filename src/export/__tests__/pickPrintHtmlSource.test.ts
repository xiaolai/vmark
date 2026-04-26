/**
 * Tests for pickPrintHtmlSource — the print-source decision used by Cmd+P.
 *
 * Covers the three branches:
 *   - WYSIWYG: live `.ProseMirror` present → use its innerHTML
 *   - Source mode: no `.ProseMirror`, but markdown is non-empty → render it
 *   - Empty: no editor, no markdown → caller shows "no content to print"
 *
 * @module export/__tests__/pickPrintHtmlSource.test
 */
import { describe, expect, it } from "vitest";
import { pickPrintHtmlSource } from "../useExportOperations";

describe("pickPrintHtmlSource", () => {
  it("uses the live editor HTML when a ProseMirror element is provided (WYSIWYG)", () => {
    const editor = document.createElement("div");
    editor.className = "ProseMirror";
    editor.innerHTML = "<p>Hello, world.</p>";

    const source = pickPrintHtmlSource(editor, "# ignored markdown");
    expect(source).toEqual({ kind: "live", html: "<p>Hello, world.</p>" });
  });

  it("falls back to rendering markdown when no editor element is present (Source mode)", () => {
    const source = pickPrintHtmlSource(null, "# Hello\n\nSome content.");
    expect(source).toEqual({ kind: "render", markdown: "# Hello\n\nSome content." });
  });

  it("returns 'empty' when both editor and markdown are missing", () => {
    expect(pickPrintHtmlSource(null, "")).toEqual({ kind: "empty" });
  });

  it("treats whitespace-only markdown as empty", () => {
    expect(pickPrintHtmlSource(null, "   \n\t  \n")).toEqual({ kind: "empty" });
  });

  it("prefers the live editor over markdown even when both are present", () => {
    // WYSIWYG mode is the fast path; markdown here is the serialized fallback
    // that the caller passes for safety. Live DOM wins.
    const editor = document.createElement("div");
    editor.innerHTML = "<p>Live</p>";
    const source = pickPrintHtmlSource(editor, "# Markdown content");
    expect(source.kind).toBe("live");
    if (source.kind === "live") expect(source.html).toBe("<p>Live</p>");
  });

  it("returns the live HTML even when the editor is empty (user chose to print blank doc)", () => {
    // Empty live editor still beats markdown fallback — the user is in
    // WYSIWYG and we trust the visible state.
    const editor = document.createElement("div");
    editor.innerHTML = "";
    const source = pickPrintHtmlSource(editor, "# ignored");
    expect(source).toEqual({ kind: "live", html: "" });
  });
});
