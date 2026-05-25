/**
 * Unified History Store Tests
 *
 * Tests for cross-mode undo/redo checkpoint management.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useUnifiedHistoryStore } from "./documentStore";

const TAB_A = "tab-a";
const TAB_B = "tab-b";

function createCheckpointData(
  content: string,
  mode: "source" | "wysiwyg" = "wysiwyg"
) {
  return {
    markdown: content,
    mode,
    cursorInfo: null,
  };
}

describe("documentStore", () => {
  beforeEach(() => {
    // Reset store state before each test
    useUnifiedHistoryStore.getState().clearAll();
  });

  describe("createCheckpoint", () => {
    it("creates a checkpoint with timestamp", () => {
      const store = useUnifiedHistoryStore.getState();
      const before = Date.now();

      store.createCheckpoint(TAB_A, createCheckpointData("# Hello"));

      const checkpoint = store.popUndo(TAB_A);
      expect(checkpoint).not.toBeNull();
      expect(checkpoint!.markdown).toBe("# Hello");
      expect(checkpoint!.mode).toBe("wysiwyg");
      expect(checkpoint!.timestamp).toBeGreaterThanOrEqual(before);
      expect(checkpoint!.timestamp).toBeLessThanOrEqual(Date.now());
    });

    it("does not create checkpoint when isRestoring is true", () => {
      const store = useUnifiedHistoryStore.getState();

      store.setRestoring(true);
      store.createCheckpoint(TAB_A, createCheckpointData("# Content"));
      store.setRestoring(false);

      expect(store.canUndoCheckpoint(TAB_A)).toBe(false);
    });

    it("skips duplicate checkpoint when markdown is unchanged", () => {
      const store = useUnifiedHistoryStore.getState();

      store.createCheckpoint(TAB_A, createCheckpointData("Same content"));
      store.createCheckpoint(TAB_A, createCheckpointData("Same content"));
      store.createCheckpoint(TAB_A, createCheckpointData("Same content"));

      // Only one checkpoint should exist
      expect(store.popUndo(TAB_A)!.markdown).toBe("Same content");
      expect(store.popUndo(TAB_A)).toBeNull();
    });

    it("allows checkpoint with same markdown but different content after other changes", () => {
      const store = useUnifiedHistoryStore.getState();

      store.createCheckpoint(TAB_A, createCheckpointData("A"));
      store.createCheckpoint(TAB_A, createCheckpointData("B"));
      store.createCheckpoint(TAB_A, createCheckpointData("A")); // back to "A" — not a duplicate

      expect(store.popUndo(TAB_A)!.markdown).toBe("A");
      expect(store.popUndo(TAB_A)!.markdown).toBe("B");
      expect(store.popUndo(TAB_A)!.markdown).toBe("A");
      expect(store.popUndo(TAB_A)).toBeNull();
    });

    it("clears redo stack when new checkpoint is created", () => {
      const store = useUnifiedHistoryStore.getState();

      // Create initial checkpoint
      store.createCheckpoint(TAB_A, createCheckpointData("V1"));

      // Simulate undo: pop undo and push to redo
      store.popUndo(TAB_A);
      store.pushRedo(TAB_A, createCheckpointData("V2"));

      expect(store.canRedoCheckpoint(TAB_A)).toBe(true);

      // Create new checkpoint (new branch of history)
      store.createCheckpoint(TAB_A, createCheckpointData("V3"));

      // Redo stack should be cleared
      expect(store.canRedoCheckpoint(TAB_A)).toBe(false);
    });

    it("trims undo stack when exceeding maxCheckpoints", () => {
      const store = useUnifiedHistoryStore.getState();
      const max = store.maxCheckpoints;

      // Create max + 10 checkpoints
      for (let i = 0; i < max + 10; i++) {
        store.createCheckpoint(TAB_A, createCheckpointData(`Content ${i}`));
      }

      // Count checkpoints by popping
      let count = 0;
      while (store.popUndo(TAB_A) !== null) {
        count++;
      }

      expect(count).toBe(max);
    });
  });

  describe("popUndo", () => {
    it("returns null when no checkpoints exist", () => {
      const store = useUnifiedHistoryStore.getState();
      expect(store.popUndo(TAB_A)).toBeNull();
    });

    it("returns null for non-existent document", () => {
      const store = useUnifiedHistoryStore.getState();
      expect(store.popUndo("non-existent-tab")).toBeNull();
    });

    it("returns most recent checkpoint (LIFO)", () => {
      const store = useUnifiedHistoryStore.getState();

      store.createCheckpoint(TAB_A, createCheckpointData("First"));
      store.createCheckpoint(TAB_A, createCheckpointData("Second"));
      store.createCheckpoint(TAB_A, createCheckpointData("Third"));

      expect(store.popUndo(TAB_A)!.markdown).toBe("Third");
      expect(store.popUndo(TAB_A)!.markdown).toBe("Second");
      expect(store.popUndo(TAB_A)!.markdown).toBe("First");
      expect(store.popUndo(TAB_A)).toBeNull();
    });

    it("removes checkpoint from stack after pop", () => {
      const store = useUnifiedHistoryStore.getState();

      store.createCheckpoint(TAB_A, createCheckpointData("Only"));

      expect(store.canUndoCheckpoint(TAB_A)).toBe(true);
      store.popUndo(TAB_A);
      expect(store.canUndoCheckpoint(TAB_A)).toBe(false);
    });
  });

  describe("popRedo", () => {
    it("returns null when no redo checkpoints exist", () => {
      const store = useUnifiedHistoryStore.getState();
      expect(store.popRedo(TAB_A)).toBeNull();
    });

    it("returns most recent redo checkpoint (LIFO)", () => {
      const store = useUnifiedHistoryStore.getState();

      store.pushRedo(TAB_A, createCheckpointData("First"));
      store.pushRedo(TAB_A, createCheckpointData("Second"));

      expect(store.popRedo(TAB_A)!.markdown).toBe("Second");
      expect(store.popRedo(TAB_A)!.markdown).toBe("First");
      expect(store.popRedo(TAB_A)).toBeNull();
    });
  });

  describe("pushRedo", () => {
    it("adds checkpoint with timestamp", () => {
      const store = useUnifiedHistoryStore.getState();
      const before = Date.now();

      store.pushRedo(TAB_A, createCheckpointData("Redo content"));

      const checkpoint = store.popRedo(TAB_A);
      expect(checkpoint).not.toBeNull();
      expect(checkpoint!.markdown).toBe("Redo content");
      expect(checkpoint!.timestamp).toBeGreaterThanOrEqual(before);
    });

    it("trims redo stack when exceeding maxCheckpoints", () => {
      const store = useUnifiedHistoryStore.getState();
      const max = store.maxCheckpoints;

      for (let i = 0; i < max + 10; i++) {
        store.pushRedo(TAB_A, createCheckpointData(`Redo ${i}`));
      }

      let count = 0;
      while (store.popRedo(TAB_A) !== null) {
        count++;
      }

      expect(count).toBe(max);
    });
  });

  describe("canUndoCheckpoint / canRedoCheckpoint", () => {
    it("returns false for empty document", () => {
      const store = useUnifiedHistoryStore.getState();

      expect(store.canUndoCheckpoint(TAB_A)).toBe(false);
      expect(store.canRedoCheckpoint(TAB_A)).toBe(false);
    });

    it("returns true when checkpoints exist", () => {
      const store = useUnifiedHistoryStore.getState();

      store.createCheckpoint(TAB_A, createCheckpointData("Undo content"));
      store.pushRedo(TAB_A, createCheckpointData("Redo content"));

      expect(store.canUndoCheckpoint(TAB_A)).toBe(true);
      expect(store.canRedoCheckpoint(TAB_A)).toBe(true);
    });

    it("returns false for non-existent document", () => {
      const store = useUnifiedHistoryStore.getState();

      expect(store.canUndoCheckpoint("missing")).toBe(false);
      expect(store.canRedoCheckpoint("missing")).toBe(false);
    });
  });

  describe("per-document isolation", () => {
    it("maintains separate history stacks for different documents", () => {
      const store = useUnifiedHistoryStore.getState();

      store.createCheckpoint(TAB_A, createCheckpointData("Tab A content"));
      store.createCheckpoint(TAB_B, createCheckpointData("Tab B content"));

      expect(store.canUndoCheckpoint(TAB_A)).toBe(true);
      expect(store.canUndoCheckpoint(TAB_B)).toBe(true);

      store.popUndo(TAB_A);

      expect(store.canUndoCheckpoint(TAB_A)).toBe(false);
      expect(store.canUndoCheckpoint(TAB_B)).toBe(true);
    });

    it("clearDocument only affects target document", () => {
      const store = useUnifiedHistoryStore.getState();

      store.createCheckpoint(TAB_A, createCheckpointData("Tab A"));
      store.createCheckpoint(TAB_B, createCheckpointData("Tab B"));

      store.clearDocument(TAB_A);

      expect(store.canUndoCheckpoint(TAB_A)).toBe(false);
      expect(store.canUndoCheckpoint(TAB_B)).toBe(true);
    });
  });

  describe("setRestoring", () => {
    it("toggles isRestoring flag", () => {
      const store = useUnifiedHistoryStore.getState();

      expect(useUnifiedHistoryStore.getState().isRestoring).toBe(false);

      store.setRestoring(true);
      expect(useUnifiedHistoryStore.getState().isRestoring).toBe(true);

      store.setRestoring(false);
      expect(useUnifiedHistoryStore.getState().isRestoring).toBe(false);
    });
  });

  describe("clearDocument", () => {
    it("removes document from store", () => {
      const store = useUnifiedHistoryStore.getState();

      store.createCheckpoint(TAB_A, createCheckpointData("Content"));
      store.pushRedo(TAB_A, createCheckpointData("Redo"));

      expect(store.canUndoCheckpoint(TAB_A)).toBe(true);
      expect(store.canRedoCheckpoint(TAB_A)).toBe(true);

      store.clearDocument(TAB_A);

      expect(store.canUndoCheckpoint(TAB_A)).toBe(false);
      expect(store.canRedoCheckpoint(TAB_A)).toBe(false);
    });

    it("does nothing for non-existent document", () => {
      const store = useUnifiedHistoryStore.getState();

      // Should not throw
      store.clearDocument("non-existent");

      expect(useUnifiedHistoryStore.getState().documents).toEqual({});
    });
  });

  describe("clearAll", () => {
    it("removes all documents and resets isRestoring", () => {
      const store = useUnifiedHistoryStore.getState();

      store.createCheckpoint(TAB_A, createCheckpointData("A"));
      store.createCheckpoint(TAB_B, createCheckpointData("B"));
      store.setRestoring(true);

      store.clearAll();

      expect(useUnifiedHistoryStore.getState().documents).toEqual({});
      expect(useUnifiedHistoryStore.getState().isRestoring).toBe(false);
    });
  });

  describe("pushUndo", () => {
    it("pushes to undo stack without clearing redo", () => {
      const store = useUnifiedHistoryStore.getState();

      // Set up redo stack first
      store.pushRedo(TAB_A, createCheckpointData("Redo-1"));
      expect(store.canRedoCheckpoint(TAB_A)).toBe(true);

      // pushUndo should NOT clear redo stack
      store.pushUndo(TAB_A, createCheckpointData("Undo-1"));

      expect(store.canUndoCheckpoint(TAB_A)).toBe(true);
      expect(store.canRedoCheckpoint(TAB_A)).toBe(true);
    });

    it("adds checkpoint with timestamp", () => {
      const store = useUnifiedHistoryStore.getState();
      const before = Date.now();

      store.pushUndo(TAB_A, createCheckpointData("Content"));

      const checkpoint = store.popUndo(TAB_A);
      expect(checkpoint).not.toBeNull();
      expect(checkpoint!.markdown).toBe("Content");
      expect(checkpoint!.timestamp).toBeGreaterThanOrEqual(before);
    });

    it("trims undo stack when exceeding maxCheckpoints", () => {
      const store = useUnifiedHistoryStore.getState();
      const max = store.maxCheckpoints;

      for (let i = 0; i < max + 10; i++) {
        store.pushUndo(TAB_A, createCheckpointData(`Content ${i}`));
      }

      let count = 0;
      while (store.popUndo(TAB_A) !== null) {
        count++;
      }

      expect(count).toBe(max);
    });
  });

  describe("popRedo with non-existent document", () => {
    it("returns null for non-existent document", () => {
      const store = useUnifiedHistoryStore.getState();
      expect(store.popRedo("non-existent-tab")).toBeNull();
    });
  });

  describe("createCheckpoint on new document (no prior history)", () => {
    it("creates history entry for new document", () => {
      const store = useUnifiedHistoryStore.getState();

      // No prior documents entry for TAB_A
      store.createCheckpoint(TAB_A, createCheckpointData("First checkpoint"));

      expect(store.canUndoCheckpoint(TAB_A)).toBe(true);
      const cp = store.popUndo(TAB_A);
      expect(cp!.markdown).toBe("First checkpoint");
    });
  });

  describe("pushRedo / pushUndo on new document (no prior history)", () => {
    it("creates history entry for new document via pushRedo", () => {
      const store = useUnifiedHistoryStore.getState();

      store.pushRedo(TAB_A, createCheckpointData("Redo content"));

      expect(store.canRedoCheckpoint(TAB_A)).toBe(true);
    });

    it("creates history entry for new document via pushUndo", () => {
      const store = useUnifiedHistoryStore.getState();

      store.pushUndo(TAB_A, createCheckpointData("Undo content"));

      expect(store.canUndoCheckpoint(TAB_A)).toBe(true);
    });
  });

  describe("cursorInfo in checkpoints", () => {
    it("preserves cursorInfo when provided", () => {
      const store = useUnifiedHistoryStore.getState();
      const cursorInfo = { line: 5, column: 10, offset: 42 };

      store.createCheckpoint(TAB_A, {
        markdown: "Content",
        mode: "source",
        cursorInfo: cursorInfo as never,
      });

      const cp = store.popUndo(TAB_A);
      expect(cp!.cursorInfo).toEqual(cursorInfo);
      expect(cp!.mode).toBe("source");
    });
  });
});
