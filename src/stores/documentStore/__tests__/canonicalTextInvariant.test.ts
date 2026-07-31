/**
 * The store holds CANONICAL editor text.
 *
 * `setContent` was the per-keystroke path for Source, WYSIWYG flush, split
 * panes, MCP and workflows, AND the way external text arrived. Those two roles
 * have opposite requirements — one must never scan, the other must always
 * canonicalise — so the combined action could not honour both and silently
 * accepted a literal `\r` into the document.
 *
 * `setEditorContent` is the editor-domain action: it asserts its input is
 * already canonical, in development only, so a violation surfaces at the writer
 * that caused it rather than as a stray control character in someone's word
 * count three layers away. Production performs no scan, which is what keeps the
 * keystroke path free.
 *
 * WI-1.2 — split the store API
 *
 * @coordinates-with stores/documentStore/document.ts
 * @coordinates-with utils/editorText.ts — canonicalizeLineEndings
 * @module stores/documentStore/__tests__/canonicalTextInvariant.test
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useDocumentStore } from "@/stores/documentStore";

const TAB = "tab-canonical";

beforeEach(() => {
  useDocumentStore.setState({ documents: {} });
  useDocumentStore.getState().initDocument(TAB, "", null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("setEditorContent rejects non-canonical text in development", () => {
  it.each([
    { label: "CRLF", input: "a\r\nb" },
    { label: "lone CR", input: "a\rb" },
    { label: "trailing CR", input: "a\r" },
  ])("throws on $label", ({ input }) => {
    vi.stubEnv("DEV", true);
    expect(() => useDocumentStore.getState().setEditorContent(TAB, input)).toThrow(
      /canonical/i,
    );
  });

  it("names the offending action so the writer is identifiable", () => {
    vi.stubEnv("DEV", true);
    expect(() => useDocumentStore.getState().setEditorContent(TAB, "a\r\nb")).toThrow(
      /setEditorContent/,
    );
  });

  it.each([
    { label: "plain LF", input: "a\nb" },
    { label: "empty", input: "" },
    { label: "no newline", input: "abc" },
    { label: "CJK", input: "中文\n内容" },
    { label: "surrogate pair", input: "𝕏\n𝕐" },
  ])("accepts $label", ({ input }) => {
    vi.stubEnv("DEV", true);
    expect(() => useDocumentStore.getState().setEditorContent(TAB, input)).not.toThrow();
    expect(useDocumentStore.getState().documents[TAB]?.content).toBe(input);
  });

  it("does NOT scan in production — the keystroke path stays free", () => {
    // The guard is a development affordance, not a runtime cost. Asserting the
    // production path accepts what the dev path rejects is the only way to show
    // the scan is genuinely absent rather than merely fast.
    vi.stubEnv("DEV", false);
    expect(() => useDocumentStore.getState().setEditorContent(TAB, "a\r\nb")).not.toThrow();
  });

  it("still updates dirty state like the action it replaces", () => {
    vi.stubEnv("DEV", true);
    const store = useDocumentStore.getState();
    store.initDocument(TAB, "original", null, "original");
    expect(useDocumentStore.getState().documents[TAB]?.isDirty).toBe(false);
    store.setEditorContent(TAB, "changed");
    expect(useDocumentStore.getState().documents[TAB]?.isDirty).toBe(true);
  });

  it("is a no-op for a missing tab, like every other keyed update", () => {
    vi.stubEnv("DEV", true);
    expect(() =>
      useDocumentStore.getState().setEditorContent("no-such-tab", "x"),
    ).not.toThrow();
    expect(useDocumentStore.getState().documents["no-such-tab"]).toBeUndefined();
  });
});
