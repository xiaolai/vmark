// @vitest-environment node
// #1634 — which initial WYSIWYG parses may run while the editor is committed
// (content in the first painted frame) and which must stay deferred (the
// shell and the loading indicator paint first).
//
// The cut is the loading indicator's own threshold, measured in UTF-8 bytes
// like the file size it was calibrated on — so a CJK document is judged by
// its bytes, not its UTF-16 length.
import { describe, expect, it } from "vitest";
import { FILE_SIZE_THRESHOLDS } from "@/utils/fileSizeThresholds";
import { shouldDeferInitialParse } from "./tiptapInitialLoad";

const LIMIT = FILE_SIZE_THRESHOLDS.SHOW_PROGRESS_BYTES;

describe("shouldDeferInitialParse", () => {
  it.each([
    ["an empty document", "", false],
    ["a short ASCII document", "# Title\n\nBody.\n", false],
    ["ASCII one byte under the indicator threshold", "a".repeat(LIMIT - 1), false],
    ["ASCII exactly at the indicator threshold", "a".repeat(LIMIT), true],
    // 3 bytes per CJK character: a third of the threshold in characters is
    // already the whole threshold in bytes.
    ["CJK under the threshold in characters but at it in bytes", "中".repeat(Math.ceil(LIMIT / 3)), true],
    ["CJK just under the threshold in bytes", "中".repeat(Math.floor((LIMIT - 1) / 3)), false],
    // An astral character is two UTF-16 units but four UTF-8 bytes.
    ["emoji at the threshold in bytes", "😀".repeat(LIMIT / 4), true],
    ["emoji just under the threshold in bytes", "😀".repeat(LIMIT / 4 - 1), false],
    // A lone surrogate encodes as U+FFFD (3 bytes), as TextEncoder would.
    ["lone surrogates counted as replacement characters", "\uD800".repeat(Math.ceil(LIMIT / 3)), true],
  ])("%s → defer: %s", (_name, markdown, expected) => {
    expect(shouldDeferInitialParse(markdown, false)).toBe(expected);
  });

  it("agrees with TextEncoder on mixed content around the threshold", () => {
    const encoder = new TextEncoder();
    const unit = "Mixed 中文 😀 text\n";
    const base = unit.repeat(Math.floor(LIMIT / encoder.encode(unit).length));
    const d = LIMIT - encoder.encode(base).length; // bytes still missing
    expect(d).toBeGreaterThan(4);
    const a = (n: number) => "a".repeat(n);
    const tails = [a(d - 1), a(d), a(d - 3) + "中", a(d - 4) + "中", a(d - 4) + "😀", a(d - 5) + "😀"];
    for (const tail of tails) {
      const markdown = base + tail;
      const bytes = new TextEncoder().encode(markdown).length;
      expect(shouldDeferInitialParse(markdown, false)).toBe(bytes >= LIMIT);
    }
  });

  it("always defers while the loading indicator is up, however small the document", () => {
    expect(shouldDeferInitialParse("", true)).toBe(true);
    expect(shouldDeferInitialParse("# Title\n", true)).toBe(true);
  });
});
