/**
 * Unit tests for the code block action-button chrome (nodeViewActions.ts):
 * button factory, label refresh, and the copy-feedback state machine.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import {
  applyActionLabel,
  createCodeActionButton,
  CopyFeedback,
} from "../nodeViewActions";
import { COPY_ICON_SVG } from "../icons";

import { LanguageDropdown } from "../dropdown";
import { createLanguageChip } from "../nodeViewActions";

describe("language chip aria state", () => {
  // jsdom has no scrollIntoView; the dropdown's highlight rAF calls it.
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("exposes role/haspopup and starts collapsed", () => {
    const chip = createLanguageChip({ onMouseDown: vi.fn(), onKeyDown: vi.fn() });
    expect(chip.getAttribute("role")).toBe("button");
    expect(chip.getAttribute("aria-haspopup")).toBe("listbox");
    expect(chip.getAttribute("aria-expanded")).toBe("false");
  });

  it("aria-expanded tracks dropdown open AND close (incl. programmatic close)", () => {
    const chip = createLanguageChip({ onMouseDown: vi.fn(), onKeyDown: vi.fn() });
    document.body.appendChild(chip);
    const dropdown = new LanguageDropdown({
      anchor: chip,
      getCurrentLanguage: () => "javascript",
      onSelect: vi.fn(),
      onOpenChange: (open) => chip.setAttribute("aria-expanded", String(open)),
    });

    dropdown.toggle();
    expect(chip.getAttribute("aria-expanded")).toBe("true");

    dropdown.close();
    expect(chip.getAttribute("aria-expanded")).toBe("false");

    dropdown.destroy();
    chip.remove();
  });
});

describe("createCodeActionButton", () => {
  it("wires class, dataset, icon, label, and both listeners", () => {
    const onMouseDown = vi.fn();
    const onClick = vi.fn();
    const btn = createCodeActionButton(
      "copy",
      "<svg data-icon></svg>",
      "editor:plugin.copySource",
      onMouseDown,
      onClick
    );

    expect(btn.className).toBe("code-copy-btn");
    expect(btn.dataset.codeAction).toBe("copy");
    expect(btn.innerHTML).toContain("data-icon");
    expect(btn.title).toBeTruthy();
    expect(btn.getAttribute("aria-label")).toBe(btn.title);

    btn.dispatchEvent(new MouseEvent("mousedown"));
    expect(onMouseDown).toHaveBeenCalled();
    btn.dispatchEvent(new MouseEvent("click"));
    expect(onClick).toHaveBeenCalled();
  });
});

describe("applyActionLabel", () => {
  it("sets tooltip and accessible name from the translation key", () => {
    const btn = document.createElement("button");
    applyActionLabel(btn, "editor:plugin.runInTerminal");
    expect(btn.title).toBeTruthy();
    expect(btn.getAttribute("aria-label")).toBe(btn.title);
  });
});

describe("CopyFeedback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a modifier and resets to the copy icon after the timeout", () => {
    const btn = document.createElement("button");
    const feedback = new CopyFeedback(btn);

    feedback.show("<svg check></svg>", "success");
    expect(btn.classList.contains("code-copy-btn--success")).toBe(true);

    vi.advanceTimersByTime(1500);
    expect(btn.classList.contains("code-copy-btn--success")).toBe(false);
    // innerHTML roundtrips through DOM normalization (self-closing tags
    // expand), so assert on the copy icon's distinctive path data.
    expect(COPY_ICON_SVG).toContain("M5 15H4");
    expect(btn.innerHTML).toContain("M5 15H4");
  });

  it("never lets success and error classes coexist on rapid clicks", () => {
    const btn = document.createElement("button");
    const feedback = new CopyFeedback(btn);

    feedback.show("<svg check></svg>", "success");
    feedback.show("<svg x></svg>", "error");
    expect(btn.classList.contains("code-copy-btn--success")).toBe(false);
    expect(btn.classList.contains("code-copy-btn--error")).toBe(true);

    // The FIRST show's timer was cancelled: only the second's reset fires,
    // 1500ms after the second click, not earlier.
    vi.advanceTimersByTime(1400);
    expect(btn.classList.contains("code-copy-btn--error")).toBe(true);
    vi.advanceTimersByTime(100);
    expect(btn.classList.contains("code-copy-btn--error")).toBe(false);
  });

  it("dispose cancels a pending reset (no post-destroy mutation)", () => {
    const btn = document.createElement("button");
    const feedback = new CopyFeedback(btn);

    feedback.show("<svg check></svg>", "success");
    feedback.dispose();
    vi.advanceTimersByTime(2000);
    // Timer was cancelled: the modifier class stays exactly as disposed.
    expect(btn.classList.contains("code-copy-btn--success")).toBe(true);

    // dispose with no pending timer is a no-op
    feedback.dispose();
  });
});

describe("CopyFeedback idle icon", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("restores a custom idle icon (run button) instead of the copy icon", () => {
    const btn = document.createElement("button");
    const runIdle = "<svg data-run-idle></svg>";
    const feedback = new CopyFeedback(btn, runIdle);

    feedback.show("<svg x></svg>", "error");
    vi.advanceTimersByTime(1500);
    expect(btn.innerHTML).toContain("data-run-idle");
  });
});
