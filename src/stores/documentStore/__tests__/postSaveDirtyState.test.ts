/**
 * Post-save dirty state across line-ending normalization.
 *
 * Regression guard for the CRLF save bug found by the E2E journey
 * `line-ending-preservation` (dev-docs/e2e-tier0-matrix.md I16):
 *
 *   Saving a CRLF document wrote the CORRECT bytes to disk, but the tab never
 *   cleared its dirty flag. `saveToPath` passes the EOL-normalized output
 *   (CRLF) to `markSaved`, while the editor's in-memory content is LF — so the
 *   post-save comparison could never be equal and the document stayed dirty
 *   forever. Every Windows-authored file showed a permanent unsaved-changes
 *   dot, prompted on close, and was refused by the non-force close guard,
 *   despite being fully saved.
 *
 * The comparison exists to catch a real TOCTOU race (the user edits during the
 * async save), so it cannot simply be dropped — it must fold only the benign
 * transforms the save pipeline itself applies (line endings, BOM, trailing
 * newline) while still reporting genuine edits as dirty. Both halves are
 * asserted here.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useDocumentStore } from "../document";

const TAB = "tab-postsave";

function docState() {
  return useDocumentStore.getState().documents[TAB];
}

beforeEach(() => {
  useDocumentStore.setState({ documents: {} });
});

describe("post-save dirty state vs. line-ending normalization", () => {
  it("clears dirty when the saved bytes differ from editor content only by CRLF", () => {
    const editorContent = "# Doc\n\nbody\n"; // in-memory: always LF
    const writtenToDisk = "# Doc\r\n\r\nbody\r\n"; // saveToPath's normalized output

    useDocumentStore.getState().initDocument(TAB, editorContent);
    useDocumentStore.getState().setContent(TAB, editorContent);
    useDocumentStore.getState().markSaved(TAB, writtenToDisk);

    expect(docState().isDirty).toBe(false);
  });

  it("clears dirty for an auto-save with CRLF output too", () => {
    const editorContent = "# Doc\n\nbody\n";
    const writtenToDisk = "# Doc\r\n\r\nbody\r\n";

    useDocumentStore.getState().initDocument(TAB, editorContent);
    useDocumentStore.getState().setContent(TAB, editorContent);
    useDocumentStore.getState().markAutoSaved(TAB, writtenToDisk);

    expect(docState().isDirty).toBe(false);
  });

  it("still reports dirty when the user edited during the async save (TOCTOU)", () => {
    const writtenToDisk = "# Doc\r\n\r\nbody\r\n";
    const editedSince = "# Doc\n\nbody with a later edit\n";

    useDocumentStore.getState().initDocument(TAB, "# Doc\n\nbody\n");
    useDocumentStore.getState().setContent(TAB, editedSince);
    useDocumentStore.getState().markSaved(TAB, writtenToDisk);

    expect(docState().isDirty).toBe(true);
  });

  it("keeps the real written bytes as lastDiskContent for external-change detection", () => {
    const editorContent = "# Doc\n\nbody\n";
    const writtenToDisk = "# Doc\r\n\r\nbody\r\n";

    useDocumentStore.getState().initDocument(TAB, editorContent);
    useDocumentStore.getState().setContent(TAB, editorContent);
    useDocumentStore.getState().markSaved(TAB, writtenToDisk);

    // Folding CRLF for the DIRTY check must not rewrite what we believe is on
    // disk — useExternalFileChanges compares real disk bytes against this.
    expect(docState().lastDiskContent).toBe(writtenToDisk);
  });

  it("still clears dirty for an ordinary LF document (unchanged behavior)", () => {
    const content = "# Doc\n\nbody\n";

    useDocumentStore.getState().initDocument(TAB, content);
    useDocumentStore.getState().setContent(TAB, content);
    useDocumentStore.getState().markSaved(TAB, content);

    expect(docState().isDirty).toBe(false);
  });
});
