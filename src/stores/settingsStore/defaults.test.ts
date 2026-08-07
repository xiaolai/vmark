/**
 * First-install contract: a fresh VMark must not rewrite a file the user
 * did not ask to change. Every save-time / format-time normalization toggle
 * defaults to its conservative setting; normalization is opt-in.
 *
 * Context: a plain Cmd+S on an untouched document collapsed its blank lines
 * (loose lists went tight) because `preserveBlankLines` defaulted to false —
 * the file changed on disk with zero user edits. These pins keep that class
 * of default from regressing.
 */
import { describe, it, expect } from "vitest";
import { initialState as defaultSettings } from "./defaults";

describe("first-install defaults are non-destructive", () => {
  it("does not collapse blank lines on the WYSIWYG round-trip", () => {
    expect(defaultSettings.markdown.preserveBlankLines).toBe(true);
  });

  it("does not collapse newlines when CJK formatting is run", () => {
    expect(defaultSettings.cjkFormatting.newlineCollapsing).toBe(false);
  });

  it("preserves the file's hard-break style on save", () => {
    expect(defaultSettings.markdown.hardBreakStyleOnSave).toBe("preserve");
  });

  it("preserves the file's line endings on save", () => {
    expect(defaultSettings.general.lineEndingsOnSave).toBe("preserve");
  });

  // #1224 — a hidden extension turned `requirements.txt` into a mysterious
  // `requirements` in the sidebar. Showing the name that is actually on disk
  // is the honest default; hiding it is the opt-in.
  it("shows file extensions", () => {
    expect(defaultSettings.general.showFileExtensions).toBe(true);
  });
});
