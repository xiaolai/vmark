import { describe, it, expect, beforeEach } from "vitest";
import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { initializeRevisionTracking } from "./revisionTracker";
import { useRevisionStore } from "@/stores/documentStore";

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
  useRevisionStore.setState({ currentRevision: "test-sentinel", lastUpdated: 0 });
});

describe("initializeRevisionTracking", () => {
  it("replaces the revision with a freshly generated id on init", () => {
    const { editor } = createMockEditor();
    initializeRevisionTracking(editor);
    const rev = useRevisionStore.getState().getRevision();
    expect(rev).not.toBe("test-sentinel");
    expect(rev).toMatch(/^rev-[A-Za-z0-9]{8}$/);
  });

  it("bumps the revision on a document-changing transaction", () => {
    const { editor, fireTransaction } = createMockEditor();
    initializeRevisionTracking(editor);
    const before = useRevisionStore.getState().getRevision();
    fireTransaction(true);
    expect(useRevisionStore.getState().getRevision()).not.toBe(before);
  });

  it("leaves the revision unchanged on a selection-only transaction", () => {
    const { editor, fireTransaction } = createMockEditor();
    initializeRevisionTracking(editor);
    const before = useRevisionStore.getState().getRevision();
    fireTransaction(false);
    expect(useRevisionStore.getState().getRevision()).toBe(before);
  });
});
