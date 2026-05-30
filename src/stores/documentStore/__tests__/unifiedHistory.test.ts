// WI-5.2 — Tests for cross-mode undo/redo checkpoint stack (MAX_CHECKPOINTS eviction, undo/redo, per-tab isolation, isRestoring guard, clearDocument)

import { describe, it, expect, beforeEach } from "vitest";
import { useUnifiedHistoryStore } from "../unifiedHistory";
import type { HistoryCheckpoint } from "../unifiedHistory";

const TAB_A = "tab-a";
const TAB_B = "tab-b";

/** Build a checkpoint payload (timestamp is assigned by the store). */
function cp(
  markdown: string,
  mode: "source" | "wysiwyg" = "wysiwyg",
): Omit<HistoryCheckpoint, "timestamp"> {
  return { markdown, mode, cursorInfo: null };
}

function reset() {
  useUnifiedHistoryStore.setState({ documents: {}, isRestoring: false });
}

/** Read the raw history for a tab (or empty stacks if absent). */
function history(tabId: string) {
  return (
    useUnifiedHistoryStore.getState().documents[tabId] ?? {
      undoStack: [],
      redoStack: [],
    }
  );
}

describe("useUnifiedHistoryStore", () => {
  beforeEach(reset);

  describe("createCheckpoint", () => {
    it("appends a checkpoint to the undo stack", () => {
      useUnifiedHistoryStore.getState().createCheckpoint(TAB_A, cp("v1"));
      const { undoStack } = history(TAB_A);
      expect(undoStack).toHaveLength(1);
      expect(undoStack[0].markdown).toBe("v1");
      expect(undoStack[0].timestamp).toBeTypeOf("number");
    });

    it("deduplicates consecutive checkpoints with identical markdown", () => {
      const { createCheckpoint } = useUnifiedHistoryStore.getState();
      createCheckpoint(TAB_A, cp("same"));
      createCheckpoint(TAB_A, cp("same"));
      expect(history(TAB_A).undoStack).toHaveLength(1);
    });

    it("does NOT deduplicate when markdown differs", () => {
      const { createCheckpoint } = useUnifiedHistoryStore.getState();
      createCheckpoint(TAB_A, cp("v1"));
      createCheckpoint(TAB_A, cp("v2"));
      expect(history(TAB_A).undoStack.map((c) => c.markdown)).toEqual(["v1", "v2"]);
    });

    it("clears the redo stack when a new checkpoint is created (new branch)", () => {
      const { createCheckpoint, pushRedo } = useUnifiedHistoryStore.getState();
      pushRedo(TAB_A, cp("redo-1"));
      expect(history(TAB_A).redoStack).toHaveLength(1);

      createCheckpoint(TAB_A, cp("new-branch"));
      expect(history(TAB_A).redoStack).toHaveLength(0);
      expect(history(TAB_A).undoStack.map((c) => c.markdown)).toEqual(["new-branch"]);
    });
  });

  describe("MAX_CHECKPOINTS eviction (cap = 50)", () => {
    it("caps the undo stack at 50, evicting the oldest while retaining the newest", () => {
      const { createCheckpoint } = useUnifiedHistoryStore.getState();
      // Push 60 distinct checkpoints (distinct markdown avoids dedup).
      for (let i = 0; i < 60; i++) {
        createCheckpoint(TAB_A, cp(`v${i}`));
      }

      const { undoStack } = history(TAB_A);
      expect(undoStack).toHaveLength(50);
      // Oldest 10 (v0..v9) evicted; window is v10..v59.
      expect(undoStack[0].markdown).toBe("v10");
      expect(undoStack[undoStack.length - 1].markdown).toBe("v59");
      // The evicted oldest is gone.
      expect(undoStack.some((c) => c.markdown === "v0")).toBe(false);
      expect(undoStack.some((c) => c.markdown === "v9")).toBe(false);
    });

    it("exposes maxCheckpoints = 50 in state", () => {
      expect(useUnifiedHistoryStore.getState().maxCheckpoints).toBe(50);
    });

    it("caps the redo stack at 50 via pushRedo", () => {
      const { pushRedo } = useUnifiedHistoryStore.getState();
      for (let i = 0; i < 55; i++) {
        pushRedo(TAB_A, cp(`r${i}`));
      }
      const { redoStack } = history(TAB_A);
      expect(redoStack).toHaveLength(50);
      expect(redoStack[0].markdown).toBe("r5");
      expect(redoStack[redoStack.length - 1].markdown).toBe("r54");
    });

    it("caps the undo stack at 50 via pushUndo", () => {
      const { pushUndo } = useUnifiedHistoryStore.getState();
      for (let i = 0; i < 55; i++) {
        pushUndo(TAB_A, cp(`u${i}`));
      }
      const { undoStack } = history(TAB_A);
      expect(undoStack).toHaveLength(50);
      expect(undoStack[0].markdown).toBe("u5");
      expect(undoStack[undoStack.length - 1].markdown).toBe("u54");
    });
  });

  describe("popUndo / popRedo", () => {
    it("popUndo returns checkpoints in LIFO order and shrinks the stack", () => {
      const { createCheckpoint, popUndo } = useUnifiedHistoryStore.getState();
      createCheckpoint(TAB_A, cp("v1"));
      createCheckpoint(TAB_A, cp("v2"));
      createCheckpoint(TAB_A, cp("v3"));

      expect(popUndo(TAB_A)?.markdown).toBe("v3");
      expect(popUndo(TAB_A)?.markdown).toBe("v2");
      expect(popUndo(TAB_A)?.markdown).toBe("v1");
      expect(history(TAB_A).undoStack).toHaveLength(0);
    });

    it("popUndo returns null when the undo stack is empty", () => {
      expect(useUnifiedHistoryStore.getState().popUndo(TAB_A)).toBeNull();
      // Unknown tab must not create an entry.
      expect(useUnifiedHistoryStore.getState().documents[TAB_A]).toBeUndefined();
    });

    it("popRedo returns checkpoints in LIFO order and shrinks the stack", () => {
      const { pushRedo, popRedo } = useUnifiedHistoryStore.getState();
      pushRedo(TAB_A, cp("r1"));
      pushRedo(TAB_A, cp("r2"));

      expect(popRedo(TAB_A)?.markdown).toBe("r2");
      expect(popRedo(TAB_A)?.markdown).toBe("r1");
      expect(history(TAB_A).redoStack).toHaveLength(0);
    });

    it("popRedo returns null when the redo stack is empty", () => {
      expect(useUnifiedHistoryStore.getState().popRedo(TAB_A)).toBeNull();
    });
  });

  describe("undo ↔ redo round-trips", () => {
    it("undo via popUndo + pushRedo restores prior state, redo replays it", () => {
      const store = useUnifiedHistoryStore.getState;
      // Establish history: v1, v2, v3 on the undo stack.
      store().createCheckpoint(TAB_A, cp("v1"));
      store().createCheckpoint(TAB_A, cp("v2"));
      store().createCheckpoint(TAB_A, cp("v3"));

      // Undo: pop newest off undo, move it to redo (the editor's actual flow).
      const undone = store().popUndo(TAB_A);
      expect(undone?.markdown).toBe("v3");
      store().pushRedo(TAB_A, cp("v3"));

      expect(history(TAB_A).undoStack.map((c) => c.markdown)).toEqual(["v1", "v2"]);
      expect(history(TAB_A).redoStack.map((c) => c.markdown)).toEqual(["v3"]);

      // Redo: pop newest off redo, push it back onto undo.
      const redone = store().popRedo(TAB_A);
      expect(redone?.markdown).toBe("v3");
      store().pushUndo(TAB_A, cp("v3"));

      expect(history(TAB_A).undoStack.map((c) => c.markdown)).toEqual(["v1", "v2", "v3"]);
      expect(history(TAB_A).redoStack).toHaveLength(0);
    });

    it("creating a new checkpoint after an undo truncates the redo branch", () => {
      const store = useUnifiedHistoryStore.getState;
      store().createCheckpoint(TAB_A, cp("v1"));
      store().createCheckpoint(TAB_A, cp("v2"));

      // Undo v2 into the redo stack.
      store().popUndo(TAB_A);
      store().pushRedo(TAB_A, cp("v2"));
      expect(history(TAB_A).redoStack).toHaveLength(1);

      // A new edit (checkpoint) must drop the redo branch.
      store().createCheckpoint(TAB_A, cp("v2-prime"));
      expect(history(TAB_A).redoStack).toHaveLength(0);
      expect(history(TAB_A).undoStack.map((c) => c.markdown)).toEqual(["v1", "v2-prime"]);
    });

    it("canUndoCheckpoint / canRedoCheckpoint reflect stack availability", () => {
      const store = useUnifiedHistoryStore.getState;
      expect(store().canUndoCheckpoint(TAB_A)).toBe(false);
      expect(store().canRedoCheckpoint(TAB_A)).toBe(false);

      store().createCheckpoint(TAB_A, cp("v1"));
      expect(store().canUndoCheckpoint(TAB_A)).toBe(true);
      expect(store().canRedoCheckpoint(TAB_A)).toBe(false);

      store().pushRedo(TAB_A, cp("r1"));
      expect(store().canRedoCheckpoint(TAB_A)).toBe(true);
    });
  });

  describe("per-tab isolation", () => {
    it("checkpoints for tab A do not affect tab B", () => {
      const { createCheckpoint } = useUnifiedHistoryStore.getState();
      createCheckpoint(TAB_A, cp("a1"));
      createCheckpoint(TAB_A, cp("a2"));
      createCheckpoint(TAB_B, cp("b1"));

      expect(history(TAB_A).undoStack.map((c) => c.markdown)).toEqual(["a1", "a2"]);
      expect(history(TAB_B).undoStack.map((c) => c.markdown)).toEqual(["b1"]);
    });

    it("popUndo on tab A leaves tab B untouched", () => {
      const { createCheckpoint, popUndo } = useUnifiedHistoryStore.getState();
      createCheckpoint(TAB_A, cp("a1"));
      createCheckpoint(TAB_B, cp("b1"));

      popUndo(TAB_A);
      expect(history(TAB_A).undoStack).toHaveLength(0);
      expect(history(TAB_B).undoStack.map((c) => c.markdown)).toEqual(["b1"]);
    });
  });

  describe("setRestoring guard", () => {
    it("suppresses createCheckpoint while isRestoring is true", () => {
      const { setRestoring, createCheckpoint } = useUnifiedHistoryStore.getState();
      setRestoring(true);
      createCheckpoint(TAB_A, cp("ignored"));
      expect(history(TAB_A).undoStack).toHaveLength(0);
      expect(useUnifiedHistoryStore.getState().documents[TAB_A]).toBeUndefined();
    });

    it("resumes createCheckpoint after isRestoring is cleared", () => {
      const { setRestoring, createCheckpoint } = useUnifiedHistoryStore.getState();
      setRestoring(true);
      createCheckpoint(TAB_A, cp("ignored"));
      setRestoring(false);
      createCheckpoint(TAB_A, cp("kept"));
      expect(history(TAB_A).undoStack.map((c) => c.markdown)).toEqual(["kept"]);
    });

    it("does NOT suppress pushUndo / pushRedo while restoring (only createCheckpoint is guarded)", () => {
      const { setRestoring, pushUndo, pushRedo } = useUnifiedHistoryStore.getState();
      setRestoring(true);
      pushUndo(TAB_A, cp("u1"));
      pushRedo(TAB_A, cp("r1"));
      expect(history(TAB_A).undoStack.map((c) => c.markdown)).toEqual(["u1"]);
      expect(history(TAB_A).redoStack.map((c) => c.markdown)).toEqual(["r1"]);
    });

    it("setRestoring toggles the isRestoring flag", () => {
      const { setRestoring } = useUnifiedHistoryStore.getState();
      setRestoring(true);
      expect(useUnifiedHistoryStore.getState().isRestoring).toBe(true);
      setRestoring(false);
      expect(useUnifiedHistoryStore.getState().isRestoring).toBe(false);
    });
  });

  describe("clearDocument / clearAll", () => {
    it("clearDocument removes only the target tab's history", () => {
      const { createCheckpoint, clearDocument } = useUnifiedHistoryStore.getState();
      createCheckpoint(TAB_A, cp("a1"));
      createCheckpoint(TAB_B, cp("b1"));

      clearDocument(TAB_A);
      expect(useUnifiedHistoryStore.getState().documents[TAB_A]).toBeUndefined();
      expect(history(TAB_B).undoStack.map((c) => c.markdown)).toEqual(["b1"]);
    });

    it("clearDocument on an unknown tab is a no-op", () => {
      const { createCheckpoint, clearDocument } = useUnifiedHistoryStore.getState();
      createCheckpoint(TAB_A, cp("a1"));
      clearDocument("nonexistent");
      expect(history(TAB_A).undoStack).toHaveLength(1);
    });

    it("clearAll wipes all histories and resets isRestoring", () => {
      const { createCheckpoint, setRestoring, clearAll } = useUnifiedHistoryStore.getState();
      createCheckpoint(TAB_A, cp("a1"));
      createCheckpoint(TAB_B, cp("b1"));
      setRestoring(true);

      clearAll();
      expect(useUnifiedHistoryStore.getState().documents).toEqual({});
      expect(useUnifiedHistoryStore.getState().isRestoring).toBe(false);
    });
  });
});
