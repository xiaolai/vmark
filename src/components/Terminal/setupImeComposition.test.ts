/**
 * Tests for setupImeComposition's textarea-vs-event mismatch path.
 *
 * Pinned behavior: when the IME fires compositionend with e.data set to an
 * ASCII key but the helper textarea actually contains a converted CJK
 * character (macOS Pinyin punctuation conversion: "?" → "？", "," → "，",
 * "(" → "（", "--" → "——", "~" → "～", "!" → "！"), commit the textarea
 * diff, not e.data. Issue #910 misread the gating regex; the test below
 * locks the behavior in source-visible form so the misread can't repeat.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { setupImeComposition } from "./setupImeComposition";

function makeContainer(): { container: HTMLElement; textarea: HTMLTextAreaElement } {
  const container = document.createElement("div");
  const textarea = document.createElement("textarea");
  textarea.className = "xterm-helper-textarea";
  container.appendChild(textarea);
  document.body.appendChild(container);
  return { container, textarea };
}

function fireComposition(
  textarea: HTMLTextAreaElement,
  type: "compositionstart" | "compositionend",
  data: string,
): void {
  const event = new CompositionEvent(type, { data, bubbles: true });
  textarea.dispatchEvent(event);
}

describe("setupImeComposition — macOS Pinyin punctuation conversion", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  // Each row: ASCII key the IME reports in e.data, converted CJK actually in
  // textarea. Covers every conversion that the real macOS Pinyin layout does.
  const cases: Array<[string, string]> = [
    ["?", "？"],
    [",", "，"],
    ["(", "（"],
    ["~", "～"],
    ["!", "！"],
    ["--", "——"],
  ];

  it.each(cases)(
    "commits textarea diff (%s) when e.data lies with ASCII (%s)",
    (ascii, cjk) => {
      const { container, textarea } = makeContainer();
      const handle = setupImeComposition({ container });
      const onCommit = vi.fn();
      handle.onCompositionCommit = onCommit;

      // compositionstart: textarea is empty
      fireComposition(textarea, "compositionstart", "");
      // IME converts: textarea now contains the CJK char
      textarea.value = cjk;
      // compositionend: e.data reports the ASCII key (lying)
      fireComposition(textarea, "compositionend", ascii);

      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenCalledWith(cjk);
    },
  );

  it("does NOT trigger textarea-diff fallback when e.data is genuinely non-ASCII", () => {
    const { container, textarea } = makeContainer();
    const handle = setupImeComposition({ container });
    const onCommit = vi.fn();
    handle.onCompositionCommit = onCommit;

    fireComposition(textarea, "compositionstart", "");
    textarea.value = "你";
    // e.data is the real CJK character — the single-non-ASCII branch
    // (line 147) handles this, NOT the textarea-diff branch (line 179).
    fireComposition(textarea, "compositionend", "你");

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("你");
  });

  it("does NOT trigger textarea-diff fallback when textarea diff is empty", () => {
    const { container, textarea } = makeContainer();
    const handle = setupImeComposition({ container });
    const onCommit = vi.fn();
    handle.onCompositionCommit = onCommit;

    fireComposition(textarea, "compositionstart", "");
    // textarea unchanged — no diff
    fireComposition(textarea, "compositionend", "?");

    // Bare-ASCII compositionend with no textarea content: the textarea-diff
    // branch should not fire. xterm's onData handles plain ASCII keys.
    expect(onCommit).not.toHaveBeenCalled();
  });
});
