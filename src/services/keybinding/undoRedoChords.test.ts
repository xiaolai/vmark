/**
 * WI-4.3 — undo/redo chords single source of truth. Asserts the canonical chord
 * set and the platform-gated redo list (Mod-y off-mac only; reserved for the AI
 * genie picker on macOS).
 */

import { describe, expect, it } from "vitest";
import {
  UNDO_CHORD,
  REDO_CHORD,
  REDO_CHORD_WINLINUX,
  redoChords,
} from "./undoRedoChords";

describe("undoRedoChords", () => {
  it("undo is Mod-z, redo is Mod-Shift-z", () => {
    expect(UNDO_CHORD).toBe("Mod-z");
    expect(REDO_CHORD).toBe("Mod-Shift-z");
    expect(REDO_CHORD_WINLINUX).toBe("Mod-y");
  });

  it("macOS redo is Mod-Shift-z only (Mod-y reserved for aiPrompts)", () => {
    expect(redoChords(true)).toEqual(["Mod-Shift-z"]);
    expect(redoChords(true)).not.toContain("Mod-y");
  });

  it("Windows/Linux redo also accepts Mod-y", () => {
    expect(redoChords(false)).toEqual(["Mod-Shift-z", "Mod-y"]);
  });
});
