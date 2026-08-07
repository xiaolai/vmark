// @vitest-environment node
/**
 * WI-1 — every content mutation must invalidate the MCP revision.
 *
 * ADR-4 of `dev-docs/plans/20260504-mcp-pruning.md` shipped `expected_revision`
 * to stop AI writes clobbering user keystrokes. Revision bumps used to be wired
 * only into the Tiptap transaction listener, so every non-Tiptap writer —
 * CodeMirror source mode, the split-pane source editor, the GHA workflow side
 * panel, history restore — mutated content while leaving the revision valid.
 * An AI holding a revision captured before those edits still passed
 * `isCurrentRevision` and overwrote them, saving the loss to disk.
 *
 * The invariant these tests pin: content changed ⇒ revision changed.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useDocumentStore, useRevisionStore } from "../../documentStore";

const TAB = "tab-1";

describe("setContent ⇒ revision invalidation", () => {
  beforeEach(() => {
    useDocumentStore.setState({ documents: {} });
    useRevisionStore.setState({ revisions: {} });
    useDocumentStore.getState().initDocument(TAB, "hello", "/tmp/a.md");
  });

  it("invalidates a revision read before a source-mode edit", () => {
    // An MCP client reads the document and captures the revision.
    const readRevision = useRevisionStore.getState().getRevision(TAB);

    // The user types in source mode — this path never touched Tiptap.
    useDocumentStore.getState().setContent(TAB, "hello world");

    // The captured revision must no longer be current, so a write carrying it
    // is rejected as STALE instead of clobbering the keystrokes.
    expect(useRevisionStore.getState().isCurrentRevision(TAB, readRevision)).toBe(false);
  });

  it("bumps the revision to a new value on each distinct edit", () => {
    const first = useRevisionStore.getState().getRevision(TAB);
    useDocumentStore.getState().setContent(TAB, "edit one");
    const second = useRevisionStore.getState().getRevision(TAB);
    useDocumentStore.getState().setContent(TAB, "edit two");
    const third = useRevisionStore.getState().getRevision(TAB);

    expect(second).not.toBe(first);
    expect(third).not.toBe(second);
  });

  it("does NOT bump when content is set to an identical value", () => {
    // The Tiptap flush path re-serializes and re-sets content on every update.
    // Bumping on a no-op write would cause false STALE rejections — the exact
    // failure mode revisionTracker's lazy-init comment warns about.
    const before = useRevisionStore.getState().getRevision(TAB);
    useDocumentStore.getState().setContent(TAB, "hello");
    expect(useRevisionStore.getState().getRevision(TAB)).toBe(before);
  });

  it("does not bump an unrelated tab's revision", () => {
    const other = "tab-2";
    useDocumentStore.getState().initDocument(other, "other", "/tmp/b.md");
    const otherRevision = useRevisionStore.getState().getRevision(other);

    useDocumentStore.getState().setContent(TAB, "changed");

    expect(useRevisionStore.getState().getRevision(other)).toBe(otherRevision);
  });

  it("is a no-op for an unknown tab", () => {
    expect(() =>
      useDocumentStore.getState().setContent("no-such-tab", "x")
    ).not.toThrow();
    expect(useRevisionStore.getState().revisions["no-such-tab"]).toBeUndefined();
  });
});

// Round-1 audit finding (document.ts:142, High): `loadContent` replaced content
// without invalidating the revision, so external-file reloads and hot-exit
// restores left a stale `expected_revision` valid — the same defect WI-1 fixed
// in `setContent`, on a different writer. Both now share one primitive.
describe("loadContent ⇒ revision invalidation", () => {
  beforeEach(() => {
    useDocumentStore.setState({ documents: {} });
    useRevisionStore.setState({ revisions: {} });
    useDocumentStore.getState().initDocument(TAB, "hello", "/tmp/a.md");
  });

  it("invalidates a revision read before an external reload", () => {
    const readRevision = useRevisionStore.getState().getRevision(TAB);
    useDocumentStore.getState().ingestExternalContent(TAB, "changed on disk", "disk-open", { filePath: "/tmp/a.md" });
    expect(useRevisionStore.getState().isCurrentRevision(TAB, readRevision)).toBe(false);
  });

  it("does NOT bump when the reload brings identical content", () => {
    const before = useRevisionStore.getState().getRevision(TAB);
    useDocumentStore.getState().ingestExternalContent(TAB, "hello", "disk-open", { filePath: "/tmp/a.md" });
    expect(useRevisionStore.getState().getRevision(TAB)).toBe(before);
  });

  it("still clears dirty state and increments documentId on reload", () => {
    useDocumentStore.getState().setContent(TAB, "local edit");
    const idBefore = useDocumentStore.getState().documents[TAB].documentId;

    useDocumentStore.getState().ingestExternalContent(TAB, "from disk", "disk-open", { filePath: "/tmp/a.md" });

    const doc = useDocumentStore.getState().documents[TAB];
    expect(doc.isDirty).toBe(false);
    expect(doc.documentId).toBe(idBefore + 1);
  });
});
