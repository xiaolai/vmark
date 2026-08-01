/**
 * The store's REMAINING doors canonicalise too.
 *
 * WI-1.2 armed `setEditorContent` with a development assertion that throws on a
 * literal `\r`, on the premise that external text is canonicalised before it
 * arrives. It is not: `initDocument` and `loadContent` write their argument
 * verbatim, and `fileOpen` hands `readTextFile` output straight to
 * `initDocument`. Opening a CRLF file therefore put a carriage return into
 * `content`, WYSIWYG parsed it into a text node (remark keeps `\r\n` inside a
 * paragraph), and the first keystroke serialised it back out — into the
 * assertion, inside an UNGUARDED requestAnimationFrame. The throw was swallowed
 * and the store simply stopped receiving edits.
 *
 * An assertion whose invariant nothing establishes is not a safety net, it is
 * the bug. These tests establish the invariant at the doors that were missing
 * it, which is also the direction WI-1.5 completes per-origin.
 *
 * `lastDiskContent` deliberately keeps the RAW bytes — it is the disk domain
 * (see the field contract in documentState.ts), and external-change detection
 * and `preserve` both depend on it being what is actually on disk.
 *
 * WI-1.2 — the LF invariant reaches every store door
 *
 * @coordinates-with stores/documentStore/document.ts
 * @coordinates-with services/navigation/fileOpen.ts — the ingress that exposed this
 * @module stores/documentStore/__tests__/ingressCanonicalisation.test
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useDocumentStore, useRevisionStore } from "@/stores/documentStore";

const TAB = "tab-ingress";
const doc = (tabId = TAB) => useDocumentStore.getState().documents[tabId];

beforeEach(() => {
  useDocumentStore.setState({ documents: {} });
});

describe("initDocument canonicalises", () => {
  it("strips carriage returns from content", () => {
    useDocumentStore.getState().initDocument(TAB, "a\r\nb", "/f.md");
    expect(doc()?.content).toBe("a\nb");
  });

  it("keeps the raw bytes as the disk snapshot", () => {
    useDocumentStore.getState().initDocument(TAB, "a\r\nb", "/f.md");
    expect(doc()?.lastDiskContent).toBe("a\r\nb");
  });

  it("canonicalises an explicit savedContent too, so dirty is a same-domain compare", () => {
    // A CRLF file restored with its own text as savedContent must come back
    // CLEAN. Comparing canonical content against raw savedContent made every
    // CRLF document dirty the moment it opened.
    useDocumentStore.getState().initDocument(TAB, "a\r\nb", "/f.md", "a\r\nb");
    expect(doc()?.savedContent).toBe("a\nb");
    expect(doc()?.isDirty).toBe(false);
  });

  it("still reports dirty when saved and current genuinely differ", () => {
    useDocumentStore.getState().initDocument(TAB, "a\r\nb", "/f.md", "different");
    expect(doc()?.isDirty).toBe(true);
  });

  it("handles a lone CR", () => {
    useDocumentStore.getState().initDocument(TAB, "a\rb", "/f.md");
    expect(doc()?.content).toBe("a\nb");
  });

  it("leaves LF content untouched", () => {
    useDocumentStore.getState().initDocument(TAB, "a\nb", "/f.md");
    expect(doc()?.content).toBe("a\nb");
    expect(doc()?.lastDiskContent).toBe("a\nb");
  });
});

describe("loadContent canonicalises", () => {
  beforeEach(() => {
    useDocumentStore.getState().initDocument(TAB, "", null);
  });

  it("strips carriage returns from content", () => {
    useDocumentStore.getState().loadContent(TAB, "a\r\nb", "/f.md");
    expect(doc()?.content).toBe("a\nb");
  });

  it("keeps the raw bytes as the disk snapshot", () => {
    useDocumentStore.getState().loadContent(TAB, "a\r\nb", "/f.md");
    expect(doc()?.lastDiskContent).toBe("a\r\nb");
  });

  it("leaves the reloaded document clean", () => {
    useDocumentStore.getState().loadContent(TAB, "a\r\nb", "/f.md");
    expect(doc()?.isDirty).toBe(false);
    expect(doc()?.savedContent).toBe("a\nb");
  });

  it("still applies the filePath argument", () => {
    useDocumentStore.getState().loadContent(TAB, "a\r\nb", "/new.md");
    expect(doc()?.filePath).toBe("/new.md");
  });
});

describe("BOM convergence (decision D1): every door strips, the flag remembers", () => {
  const BOM = "﻿";

  it("initDocument strips a leading BOM into hasBom", () => {
    useDocumentStore.getState().initDocument(TAB, `${BOM}a\r\nb`, "/f.md");
    expect(doc()?.content).toBe("a\nb");
    expect(doc()?.hasBom).toBe(true);
    expect(doc()?.lastDiskContent).toBe(`${BOM}a\r\nb`);
  });

  it("initDocument canonicalises an explicit savedContent's BOM the same way", () => {
    useDocumentStore.getState().initDocument(TAB, `${BOM}a`, "/f.md", `${BOM}a`);
    expect(doc()?.savedContent).toBe("a");
    expect(doc()?.isDirty).toBe(false);
  });

  it("loadContent strips a leading BOM into hasBom", () => {
    useDocumentStore.getState().initDocument(TAB, "", null);
    useDocumentStore.getState().loadContent(TAB, `${BOM}a\r\nb`, "/f.md");
    expect(doc()?.content).toBe("a\nb");
    expect(doc()?.hasBom).toBe(true);
    expect(doc()?.lastDiskContent).toBe(`${BOM}a\r\nb`);
  });

  it("loadContent clears a stale hasBom when the new text has none", () => {
    useDocumentStore.getState().initDocument(TAB, `${BOM}a`, "/f.md");
    useDocumentStore.getState().loadContent(TAB, "a", "/f.md");
    expect(doc()?.hasBom).toBe(false);
  });

  it("a BOM that is not at offset 0 stays content", () => {
    useDocumentStore.getState().initDocument(TAB, `a${BOM}b`, "/f.md");
    expect(doc()?.content).toBe(`a${BOM}b`);
    expect(doc()?.hasBom).toBe(false);
  });
});

describe("the regression these doors caused", () => {
  it("a CRLF document opened then edited does not trip the editor-domain assertion", () => {
    // The exact shipped failure: fileOpen -> initDocument (verbatim), WYSIWYG
    // parses the CR into a text node, the first flush serialises it back, and
    // setEditorContent threw inside an unguarded RAF.
    const store = useDocumentStore.getState();
    store.initDocument(TAB, "First para\r\nsecond line\r\n\r\nThird\r\n", "/f.md");

    const content = doc()?.content ?? "";
    expect(content).not.toContain("\r");
    // Round-tripping what the store now holds is what the flush does.
    expect(() => store.setEditorContent(TAB, content)).not.toThrow();
  });
});

describe("audit round: BOM and metadata leaks at the remaining doors", () => {
  const BOM = "\u{FEFF}";

  it("reloading identical BOM'd content does not manufacture a revision bump", () => {
    // `buildLoadState` stores BOM-STRIPPED text while the revision compare used
    // `canonicalizeLineEndings`, which strips line endings only. The two
    // disagreed for any BOM'd file, so an identical reload looked like a change
    // — and an in-flight MCP write carrying the old revision was rejected STALE.
    const store = useDocumentStore.getState();
    store.initDocument(TAB, "", null);
    store.loadContent(TAB, `${BOM}same\n`, "/f.md");
    const first = useRevisionStore.getState().getRevision(TAB);

    store.loadContent(TAB, `${BOM}same\n`, "/f.md");
    expect(useRevisionStore.getState().getRevision(TAB)).toBe(first);
  });

  it("a genuine reload still bumps", () => {
    const store = useDocumentStore.getState();
    store.initDocument(TAB, "", null);
    store.loadContent(TAB, `${BOM}first\n`, "/f.md");
    const first = useRevisionStore.getState().getRevision(TAB);

    store.loadContent(TAB, `${BOM}second\n`, "/f.md");
    expect(useRevisionStore.getState().getRevision(TAB)).not.toBe(first);
  });

  it("initDocument derives hardBreakStyle — it SURVIVES canonicalisation", () => {
    // The transfer paths (tab move, workspace move) are initDocument's only
    // remaining non-empty callers, and their payloads carry no line metadata.
    // A backslash-break document arriving there reported "unknown", which
    // `resolveHardBreakStyle` turns into "twoSpaces" on save — rewriting every
    // hard break in the file.
    useDocumentStore.getState().initDocument(TAB, "one\\\ntwo\n", "/f.md");
    expect(doc()?.hardBreakStyle).toBe("backslash");
  });

  it("initDocument leaves lineEnding UNKNOWN — canonicalisation erased it", () => {
    // Deriving here would assert "lf" for a transferred CRLF document, which is
    // worse than unknown: unknown lets the save-time resolver apply the user's
    // setting, "lf" asserts a convention the file never had.
    useDocumentStore.getState().initDocument(TAB, "one\ntwo\n", "/f.md");
    expect(doc()?.lineEnding).toBe("unknown");
  });

  it("an empty document reports unknown for both", () => {
    useDocumentStore.getState().initDocument(TAB, "", null);
    expect(doc()?.hardBreakStyle).toBe("unknown");
    expect(doc()?.lineEnding).toBe("unknown");
  });
});

describe("audit round: the canonical assertion covers the WHOLE invariant", () => {
  it("rejects a leading BOM in development, not just a carriage return", () => {
    // The contract is "LF-only, BOM-free"; the guard checked only \r, so a BOM
    // could be placed straight into the editor buffer — the exact character
    // whose presence at offset 0 breaks block detection.
    vi.stubEnv("DEV", true);
    useDocumentStore.getState().initDocument(TAB, "", null);
    expect(() =>
      useDocumentStore.getState().setEditorContent(TAB, "\u{FEFF}text"),
    ).toThrow(/BOM|byte-order/i);
    vi.unstubAllEnvs();
  });

  it("a BOM elsewhere in the text is content and stays accepted", () => {
    vi.stubEnv("DEV", true);
    useDocumentStore.getState().initDocument(TAB, "", null);
    expect(() =>
      useDocumentStore.getState().setEditorContent(TAB, "a\u{FEFF}b"),
    ).not.toThrow();
    vi.unstubAllEnvs();
  });
});
