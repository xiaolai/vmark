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
import { describe, it, expect, beforeEach } from "vitest";
import { useDocumentStore } from "@/stores/documentStore";

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
