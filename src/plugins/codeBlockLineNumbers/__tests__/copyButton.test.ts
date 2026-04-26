/**
 * Copy button behavior tests.
 *
 * Pin three contracts that the previous implementation broke:
 *
 *   1. **Success path**: when `navigator.clipboard.writeText` resolves, the
 *      button briefly shows the success icon + `--success` modifier.
 *   2. **Rejection path**: when `writeText` rejects (permission denied,
 *      user gesture missing, etc.), the button shows the error icon +
 *      `--error` modifier — *not* the success icon. The previous code did
 *      not await the promise and always showed success even on rejection.
 *   3. **Unavailable API**: when `navigator.clipboard` or `writeText` is
 *      missing entirely (e.g. insecure context), the button shows the error
 *      state instead of pretending the copy succeeded.
 *
 * The CSS imports are mocked so the production module loads in jsdom; the
 * `lowlight` instance is mocked because the heavy `all` bundle isn't needed
 * for these DOM-level assertions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/core";

vi.mock("../code-block-line-numbers.css", () => ({}));
vi.mock("../hljs-syntax.css", () => ({}));
vi.mock("@/plugins/sourcePopup", () => ({
  getPopupHostForDom: vi.fn(() => null),
  toHostCoordsForDom: vi.fn((_, coords) => coords),
}));
vi.mock("lowlight", () => ({
  all: {},
  common: {},
  createLowlight: vi.fn(() => ({
    highlight: vi.fn(),
    highlightAuto: vi.fn(),
    listLanguages: vi.fn(() => []),
    register: vi.fn(),
    registered: vi.fn(() => false),
  })),
}));

import { CodeBlockNodeView } from "../nodeView";

interface ClipboardMock {
  writeText?: ReturnType<typeof vi.fn>;
}

function makeNode(text: string, language = "plaintext"): ProseMirrorNode {
  return {
    type: { name: "codeBlock" },
    attrs: { language },
    textContent: text,
  } as unknown as ProseMirrorNode;
}

function makeEditor(): Editor {
  return {
    chain: () => ({
      focus: () => ({
        updateAttributes: () => ({ run: vi.fn() }),
      }),
    }),
  } as unknown as Editor;
}

function createView(text = "console.log('hi');"): CodeBlockNodeView {
  return new CodeBlockNodeView(makeNode(text), makeEditor(), () => 0);
}

function getCopyButton(view: CodeBlockNodeView): HTMLButtonElement {
  return view.dom.querySelector(".code-copy-btn") as HTMLButtonElement;
}

describe("copy button", () => {
  let originalClipboard: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalClipboard) {
      Object.defineProperty(navigator, "clipboard", originalClipboard);
    } else {
      // @ts-expect-error — restore to undefined when there was no descriptor
      delete navigator.clipboard;
    }
  });

  function setClipboard(mock: ClipboardMock | undefined): void {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      writable: true,
      value: mock,
    });
  }

  it("shows success state when writeText resolves", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });

    const view = createView("hello world");
    const btn = getCopyButton(view);

    btn.click();
    // Let the awaited promise resolve
    await vi.waitFor(() => {
      expect(btn.classList.contains("code-copy-btn--success")).toBe(true);
    });

    expect(writeText).toHaveBeenCalledWith("hello world");
    expect(btn.classList.contains("code-copy-btn--error")).toBe(false);

    vi.advanceTimersByTime(1500);
    expect(btn.classList.contains("code-copy-btn--success")).toBe(false);

    view.destroy();
  });

  it("shows error state — not success — when writeText rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    setClipboard({ writeText });

    const view = createView("oops");
    const btn = getCopyButton(view);

    btn.click();
    await vi.waitFor(() => {
      expect(btn.classList.contains("code-copy-btn--error")).toBe(true);
    });

    // Critical: the previous code always showed success — guard against regression
    expect(btn.classList.contains("code-copy-btn--success")).toBe(false);

    vi.advanceTimersByTime(1500);
    expect(btn.classList.contains("code-copy-btn--error")).toBe(false);

    view.destroy();
  });

  it("shows error state when navigator.clipboard is unavailable", async () => {
    setClipboard(undefined);

    const view = createView("nope");
    const btn = getCopyButton(view);

    btn.click();
    // No async hop because the early return is synchronous, but the handler
    // is `async` so its promise still resolves on the microtask queue.
    await Promise.resolve();

    expect(btn.classList.contains("code-copy-btn--error")).toBe(true);
    expect(btn.classList.contains("code-copy-btn--success")).toBe(false);

    view.destroy();
  });

  it("shows error state when writeText is missing on the clipboard object", async () => {
    setClipboard({}); // clipboard exists but writeText is undefined

    const view = createView("nope");
    const btn = getCopyButton(view);

    btn.click();
    await Promise.resolve();

    expect(btn.classList.contains("code-copy-btn--error")).toBe(true);
    expect(btn.classList.contains("code-copy-btn--success")).toBe(false);

    view.destroy();
  });
});
