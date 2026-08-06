/**
 * A serialization sync must never manufacture dirty state.
 *
 * Regression guard for the "opening a file rewrites it" bug: auto-save calls
 * `flushActiveWysiwygNow()` BEFORE testing `isDirty`, and that flush
 * re-serializes the live ProseMirror doc into the store. Because the
 * serializer's canonical output is not byte-identical to arbitrary on-disk
 * markdown (blank-line runs collapse when `preserveBlankLines` is off, HTML
 * blocks gain surrounding blank lines, a trailing newline is appended), the
 * flush made `content !== savedContent` and `setContent` marked the document
 * dirty. Auto-save then saved a file the user had only ever OPENED — verified
 * live: a fresh file was rewritten ~6s after opening, with no edit and with no
 * dirty indicator ever shown.
 *
 * The fix separates the two meanings `isDirty` had been carrying — "the user
 * changed this document" vs. "the serialized bytes differ from disk". A flush
 * that is not driven by a user edit reports `fromUserEdit: false` and may
 * neither create nor clear dirt.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useDocumentStore } from "../document";
import { useRevisionStore } from "../revision";

const TAB = "tab-serialization-sync";

/** What the file holds on disk. */
const DISK = "# Title\n\n\n\nBody.\n\n<!-- marker -->\nRef\n<!-- /marker -->\n\nEnd.";
/** What the WYSIWYG serializer emits for that same document, unedited. */
const NORMALIZED = "# Title\n\nBody.\n\n<!-- marker -->\n\nRef\n\n<!-- /marker -->\n\nEnd.\n";

function doc() {
  return useDocumentStore.getState().documents[TAB];
}

beforeEach(() => {
  useDocumentStore.setState({ documents: {} });
});

describe("serialization sync (fromUserEdit: false)", () => {
  it("does not dirty a document the user never edited", () => {
    useDocumentStore.getState().initDocument(TAB, DISK, "/a.md");
    expect(doc().isDirty).toBe(false);

    useDocumentStore.getState().setContent(TAB, NORMALIZED, { fromUserEdit: false });

    expect(doc().isDirty).toBe(false);
    expect(doc().content).toBe(NORMALIZED);
  });

  it("still records the serialized content so a later save writes the live doc", () => {
    useDocumentStore.getState().initDocument(TAB, DISK, "/a.md");
    useDocumentStore.getState().setContent(TAB, NORMALIZED, { fromUserEdit: false });
    expect(doc().content).toBe(NORMALIZED);
  });

  it("does not CLEAR dirt on a document the user did edit", () => {
    useDocumentStore.getState().initDocument(TAB, DISK, "/a.md");
    useDocumentStore.getState().setContent(TAB, `${DISK} edited`);
    expect(doc().isDirty).toBe(true);

    // Auto-save's flush lands after a real edit — the dirt must survive it,
    // otherwise the edit would never be written.
    useDocumentStore.getState().setContent(TAB, `${NORMALIZED} edited`, { fromUserEdit: false });

    expect(doc().isDirty).toBe(true);
  });

  it("does not bump the revision — a sync is not a document change", () => {
    useDocumentStore.getState().initDocument(TAB, DISK, "/a.md");
    const before = useRevisionStore.getState().getRevision(TAB);

    useDocumentStore.getState().setContent(TAB, NORMALIZED, { fromUserEdit: false });

    expect(useRevisionStore.getState().getRevision(TAB)).toBe(before);
  });

  it("is idempotent across repeated auto-save cycles", () => {
    useDocumentStore.getState().initDocument(TAB, DISK, "/a.md");
    for (let i = 0; i < 5; i++) {
      useDocumentStore.getState().setContent(TAB, NORMALIZED, { fromUserEdit: false });
    }
    expect(doc().isDirty).toBe(false);
  });
});

describe("user edits (default) keep their existing behavior", () => {
  it("dirties when content differs from the saved bytes", () => {
    useDocumentStore.getState().initDocument(TAB, DISK, "/a.md");
    useDocumentStore.getState().setContent(TAB, `${DISK}!`);
    expect(doc().isDirty).toBe(true);
  });

  it("an explicit fromUserEdit: true dirties even from the normalized form", () => {
    useDocumentStore.getState().initDocument(TAB, DISK, "/a.md");
    useDocumentStore.getState().setContent(TAB, NORMALIZED, { fromUserEdit: true });
    expect(doc().isDirty).toBe(true);
  });

  it("returns to clean when the user restores the saved content", () => {
    useDocumentStore.getState().initDocument(TAB, DISK, "/a.md");
    useDocumentStore.getState().setContent(TAB, `${DISK}!`);
    useDocumentStore.getState().setContent(TAB, DISK);
    expect(doc().isDirty).toBe(false);
  });

  it("bumps the revision", () => {
    useDocumentStore.getState().initDocument(TAB, DISK, "/a.md");
    const before = useRevisionStore.getState().getRevision(TAB);
    useDocumentStore.getState().setContent(TAB, `${DISK}!`);
    expect(useRevisionStore.getState().getRevision(TAB)).not.toBe(before);
  });
});
