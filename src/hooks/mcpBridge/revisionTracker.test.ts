import { describe, it, expect, beforeEach } from "vitest";
import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { initializeRevisionTracking } from "./revisionTracker";
import { useRevisionStore } from "@/stores/documentStore";

const TAB = "tab-track";
const OTHER = "tab-other";

/**
 * Minimal Tiptap-editor stand-in. initializeRevisionTracking only uses
 * editor.on("transaction", cb), so this captures that callback and lets the
 * test fire synthetic transactions.
 */
function createMockEditor() {
  let listener: ((props: { transaction: Transaction }) => void) | undefined;
  const editor = {
    on: (event: string, cb: (props: { transaction: Transaction }) => void) => {
      if (event === "transaction") listener = cb;
    },
  } as unknown as Editor;
  return {
    editor,
    fireTransaction: (docChanged: boolean) => {
      listener?.({ transaction: { docChanged } as Transaction });
    },
  };
}

beforeEach(() => {
  useRevisionStore.setState({ revisions: { [TAB]: { revision: "test-sentinel", lastUpdated: 0 } } });
});

describe("initializeRevisionTracking", () => {
  it("keeps an existing tab revision on init (no false STALE on remount)", () => {
    // A revision already exists for this tab (e.g. an MCP client read it while
    // the tab was a background tab). Mounting the editor must NOT reset it.
    const { editor } = createMockEditor();
    initializeRevisionTracking(editor, TAB);
    expect(useRevisionStore.getState().getRevision(TAB)).toBe("test-sentinel");
  });

  it("lazily initializes a revision for a never-tracked tab on init", () => {
    const { editor } = createMockEditor();
    initializeRevisionTracking(editor, "fresh-tab");
    const rev = useRevisionStore.getState().getRevision("fresh-tab");
    expect(rev).toMatch(/^rev-[A-Za-z0-9]{8}$/);
  });

  it("bumps the tab's revision on a document-changing transaction", () => {
    const { editor, fireTransaction } = createMockEditor();
    initializeRevisionTracking(editor, TAB);
    const before = useRevisionStore.getState().getRevision(TAB);
    fireTransaction(true);
    expect(useRevisionStore.getState().getRevision(TAB)).not.toBe(before);
  });

  it("leaves the tab's revision unchanged on a selection-only transaction", () => {
    const { editor, fireTransaction } = createMockEditor();
    initializeRevisionTracking(editor, TAB);
    const before = useRevisionStore.getState().getRevision(TAB);
    fireTransaction(false);
    expect(useRevisionStore.getState().getRevision(TAB)).toBe(before);
  });

  it("only bumps its own tab, not others (per-tab keying, WI-0.10)", () => {
    const { editor, fireTransaction } = createMockEditor();
    initializeRevisionTracking(editor, TAB);
    const otherBefore = useRevisionStore.getState().getRevision(OTHER);
    fireTransaction(true);
    expect(useRevisionStore.getState().getRevision(OTHER)).toBe(otherBefore);
  });
});
