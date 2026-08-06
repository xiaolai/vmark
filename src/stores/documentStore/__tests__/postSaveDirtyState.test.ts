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
 * The dual-snapshot contract (WI-1.4) fixed this structurally: `saveToPath`
 * now passes the PRE-normalisation editor text as `editorSnapshot`, so the
 * dirty compare is same-domain and STRICT — no soft folding, which also closes
 * the trailing-newline TOCTOU hole the folding opened. The disk bytes live in
 * `diskSnapshot`/`lastDiskContent` for external-change detection. Both halves
 * are asserted here.
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
    useDocumentStore
      .getState()
      .markSaved(TAB, { editorSnapshot: editorContent, diskSnapshot: writtenToDisk });

    expect(docState().isDirty).toBe(false);
  });

  it("clears dirty for an auto-save with CRLF output too", () => {
    const editorContent = "# Doc\n\nbody\n";
    const writtenToDisk = "# Doc\r\n\r\nbody\r\n";

    useDocumentStore.getState().initDocument(TAB, editorContent);
    useDocumentStore.getState().setContent(TAB, editorContent);
    useDocumentStore
      .getState()
      .markAutoSaved(TAB, { editorSnapshot: editorContent, diskSnapshot: writtenToDisk });

    expect(docState().isDirty).toBe(false);
  });

  it("still reports dirty when the user edited during the async save (TOCTOU)", () => {
    const writtenToDisk = "# Doc\r\n\r\nbody\r\n";
    const editedSince = "# Doc\n\nbody with a later edit\n";

    useDocumentStore.getState().initDocument(TAB, "# Doc\n\nbody\n");
    useDocumentStore.getState().setContent(TAB, editedSince);
    useDocumentStore
      .getState()
      .markSaved(TAB, { editorSnapshot: "# Doc\n\nbody\n", diskSnapshot: writtenToDisk });

    expect(docState().isDirty).toBe(true);
  });

  it("keeps the real written bytes as lastDiskContent for external-change detection", () => {
    const editorContent = "# Doc\n\nbody\n";
    const writtenToDisk = "# Doc\r\n\r\nbody\r\n";

    useDocumentStore.getState().initDocument(TAB, editorContent);
    useDocumentStore.getState().setContent(TAB, editorContent);
    useDocumentStore
      .getState()
      .markSaved(TAB, { editorSnapshot: editorContent, diskSnapshot: writtenToDisk });

    // The DISK snapshot holds the real bytes — useExternalFileChanges compares
    // actual disk content against this.
    expect(docState().lastDiskContent).toBe(writtenToDisk);
  });

  it("still clears dirty for an ordinary LF document (unchanged behavior)", () => {
    const content = "# Doc\n\nbody\n";

    useDocumentStore.getState().initDocument(TAB, content);
    useDocumentStore.getState().setContent(TAB, content);
    useDocumentStore
      .getState()
      .markSaved(TAB, { editorSnapshot: content, diskSnapshot: content });

    expect(docState().isDirty).toBe(false);
  });
});
