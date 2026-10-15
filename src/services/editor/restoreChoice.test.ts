// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import {
  chooseEditorRestore,
  forgetShownEditorSurface,
  noteEditorJump,
} from "./restoreChoice";
import {
  clearEditorScrollOffsets,
  getEditorScrollOffset,
  setEditorScrollOffset,
} from "./scrollPosition";

const TAB = "tab-choice";

beforeEach(() => {
  clearEditorScrollOffsets(TAB);
  forgetShownEditorSurface(TAB);
});

describe("chooseEditorRestore", () => {
  it("restores by scroll when there is no cursor, on any show", () => {
    expect(chooseEditorRestore(TAB, "wysiwyg", false)).toBe("scroll");
    expect(chooseEditorRestore(TAB, "source", false)).toBe("scroll");
    expect(chooseEditorRestore(TAB, "source", false)).toBe("scroll");
  });

  it("restores by cursor on the first show of a tab", () => {
    // A cursor carried in from a hot-exit restore: nothing on screen yet to return to.
    expect(chooseEditorRestore(TAB, "wysiwyg", true)).toBe("cursor");
  });

  it("restores by scroll when the reader returns to the surface they left (#1556)", () => {
    chooseEditorRestore(TAB, "wysiwyg", true);
    setEditorScrollOffset(TAB, "wysiwyg", 4200); // the reader scrolled on past the caret

    // Tab switch away and back: the same surface remounts.
    expect(chooseEditorRestore(TAB, "wysiwyg", true)).toBe("scroll");
  });

  it("keeps choosing scroll across repeated round trips (#1556)", () => {
    chooseEditorRestore(TAB, "source", true);
    for (const offset of [1000, 2500, 300]) {
      setEditorScrollOffset(TAB, "source", offset);
      expect(chooseEditorRestore(TAB, "source", true)).toBe("scroll");
      expect(getEditorScrollOffset(TAB, "source")).toBe(offset);
    }
  });

  it("falls back to the cursor when the surface it returns to remembers nothing", () => {
    chooseEditorRestore(TAB, "wysiwyg", true);
    expect(chooseEditorRestore(TAB, "wysiwyg", true)).toBe("cursor");
  });

  it("restores by cursor on a mode switch, whatever the target surface remembers", () => {
    // Pixels mean nothing across surfaces; the cursor carries the mapping.
    setEditorScrollOffset(TAB, "source", 900);
    chooseEditorRestore(TAB, "wysiwyg", true);

    expect(chooseEditorRestore(TAB, "source", true)).toBe("cursor");
  });

  it("drops the target surface's stale offset when a mode switch hands the view to the cursor", () => {
    // Otherwise a cursor already in view (no scroll event, nothing recorded)
    // leaves the old pixels standing, and the next tab switch returns to them.
    setEditorScrollOffset(TAB, "source", 900);
    chooseEditorRestore(TAB, "wysiwyg", true);
    chooseEditorRestore(TAB, "source", true);

    expect(getEditorScrollOffset(TAB, "source")).toBeUndefined();
    expect(chooseEditorRestore(TAB, "source", true)).toBe("cursor");
  });

  it("keeps the target surface's offset on a mode switch without a cursor (#1249)", () => {
    setEditorScrollOffset(TAB, "source", 900);
    chooseEditorRestore(TAB, "wysiwyg", false);

    expect(chooseEditorRestore(TAB, "source", false)).toBe("scroll");
    expect(getEditorScrollOffset(TAB, "source")).toBe(900);
  });

  it("keeps the other surface's offset when one surface is handed to the cursor", () => {
    chooseEditorRestore(TAB, "wysiwyg", true);
    setEditorScrollOffset(TAB, "wysiwyg", 700);
    chooseEditorRestore(TAB, "source", true);

    expect(getEditorScrollOffset(TAB, "wysiwyg")).toBe(700);
  });

  it("tracks tabs independently", () => {
    chooseEditorRestore(TAB, "wysiwyg", true);
    setEditorScrollOffset(TAB, "wysiwyg", 500);
    setEditorScrollOffset("tab-other", "wysiwyg", 800);

    expect(chooseEditorRestore("tab-other", "wysiwyg", true)).toBe("cursor");
    expect(chooseEditorRestore(TAB, "wysiwyg", true)).toBe("scroll");
    clearEditorScrollOffsets("tab-other");
    forgetShownEditorSurface("tab-other");
  });

  it("treats a missing tab id as a first show", () => {
    expect(chooseEditorRestore(undefined, "wysiwyg", true)).toBe("cursor");
    expect(chooseEditorRestore(null, "source", false)).toBe("scroll");
  });

  it("forgets a closed tab, so a reused id starts fresh", () => {
    chooseEditorRestore(TAB, "wysiwyg", true);
    setEditorScrollOffset(TAB, "wysiwyg", 500);
    forgetShownEditorSurface(TAB);

    expect(chooseEditorRestore(TAB, "wysiwyg", true)).toBe("cursor");
  });
});

describe("noteEditorJump", () => {
  it("counts as showing the surface, so the next return restores by scroll", () => {
    noteEditorJump(TAB, "wysiwyg");
    setEditorScrollOffset(TAB, "wysiwyg", 1200);

    expect(chooseEditorRestore(TAB, "wysiwyg", true)).toBe("scroll");
  });

  it("drops the stale offset of a surface it switches to", () => {
    setEditorScrollOffset(TAB, "source", 900);
    chooseEditorRestore(TAB, "wysiwyg", false);
    noteEditorJump(TAB, "source");

    expect(getEditorScrollOffset(TAB, "source")).toBeUndefined();
  });

  it("keeps the offset of the surface already showing", () => {
    chooseEditorRestore(TAB, "source", false);
    setEditorScrollOffset(TAB, "source", 900);
    noteEditorJump(TAB, "source");

    expect(getEditorScrollOffset(TAB, "source")).toBe(900);
  });

  it("ignores a missing tab id", () => {
    expect(() => noteEditorJump(undefined, "source")).not.toThrow();
  });
});
