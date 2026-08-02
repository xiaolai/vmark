/**
 * Tests for Source Copy-on-Select Plugin
 *
 * Covers:
 *   - Plugin creation returns an extension
 *   - mouseup copies selection when copyOnSelect is enabled
 *   - mouseup is no-op when copyOnSelect is disabled
 *   - Collapsed selection (no text) skips copy
 *   - Empty cleaned text skips clipboard write
 *   - Clipboard write failure is handled gracefully
 *   - destroy() removes event listener and sets destroyed flag
 *   - destroyed flag prevents copy after destroy
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

const mockCopyOnSelect = { value: true };

vi.mock("@/plugins/shared/hostSettings", () => ({
  hostSettings: { copyOnSelect: () => mockCopyOnSelect.value },
}));

vi.mock("@/plugins/markdownCopy/tiptap", () => ({
  cleanTextForClipboard: (text: string) => text.trim(),
}));

vi.mock("@/utils/debug", () => ({
  clipboardWarn: vi.fn(),
}));

import { createSourceCopyOnSelectPlugin } from "./sourceCopyOnSelect";
import { clipboardWarn } from "@/utils/debug";

const viewInstances: EditorView[] = [];

function createView(content: string, anchor?: number, head?: number): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);

  const a = anchor ?? 0;
  const h = head ?? a;

  const state = EditorState.create({
    doc: content,
    selection: { anchor: a, head: h },
    extensions: [createSourceCopyOnSelectPlugin()],
  });
  const view = new EditorView({ state, parent });
  viewInstances.push(view);
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCopyOnSelect.value = true;

  // Mock clipboard API
  Object.defineProperty(navigator, "clipboard", {
    value: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  viewInstances.forEach((v) => {
    const parent = v.dom.parentElement;
    v.destroy();
    parent?.remove();
  });
  viewInstances.length = 0;
});

describe("createSourceCopyOnSelectPlugin", () => {
  it("returns an extension", () => {
    const ext = createSourceCopyOnSelectPlugin();
    expect(ext).toBeDefined();
  });

  it("copies selected text on mouseup when copyOnSelect is enabled", async () => {
    const view = createView("hello world", 0, 5);

    // Simulate mouseup
    const mouseUpEvent = new MouseEvent("mouseup", { bubbles: true });
    view.dom.dispatchEvent(mouseUpEvent);

    // handleMouseUp uses requestAnimationFrame
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("hello");
  });

  it("does nothing on mouseup when copyOnSelect is disabled", async () => {
    mockCopyOnSelect.value = false;
    const view = createView("hello world", 0, 5);

    const mouseUpEvent = new MouseEvent("mouseup", { bubbles: true });
    view.dom.dispatchEvent(mouseUpEvent);

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });

    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("does nothing when selection is collapsed (no text selected)", async () => {
    const view = createView("hello world", 3, 3);

    const mouseUpEvent = new MouseEvent("mouseup", { bubbles: true });
    view.dom.dispatchEvent(mouseUpEvent);

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });

    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("does not copy when cleaned text is empty", async () => {
    // Select whitespace only — cleanTextForClipboard trims to empty string
    const view = createView("   ", 0, 3);

    const mouseUpEvent = new MouseEvent("mouseup", { bubbles: true });
    view.dom.dispatchEvent(mouseUpEvent);

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });

    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("handles clipboard write failure gracefully", async () => {
    const writeError = new Error("Clipboard blocked");
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValueOnce(writeError);

    const view = createView("hello world", 0, 5);

    const mouseUpEvent = new MouseEvent("mouseup", { bubbles: true });
    view.dom.dispatchEvent(mouseUpEvent);

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });

    // Wait for the rejected promise to be caught
    await vi.waitFor(() => {
      expect(clipboardWarn).toHaveBeenCalledWith(
        "Clipboard write failed:",
        "Clipboard blocked"
      );
    });
  });

  it("handles clipboard write failure with non-Error object", async () => {
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValueOnce("string error");

    const view = createView("hello world", 0, 5);

    const mouseUpEvent = new MouseEvent("mouseup", { bubbles: true });
    view.dom.dispatchEvent(mouseUpEvent);

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });

    await vi.waitFor(() => {
      expect(clipboardWarn).toHaveBeenCalledWith(
        "Clipboard write failed:",
        "string error"
      );
    });
  });

  it("does not copy after plugin is destroyed", async () => {
    const view = createView("hello world", 0, 5);

    // Destroy the view (which destroys the plugin)
    const parent = view.dom.parentElement;
    const dom = view.dom;
    view.destroy();
    parent?.remove();
    viewInstances.length = 0;

    // Simulate mouseup on the now-detached DOM — the listener should be removed
    const mouseUpEvent = new MouseEvent("mouseup", { bubbles: true });
    dom.dispatchEvent(mouseUpEvent);

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });

    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("skips copy in rAF callback if plugin was destroyed after mouseup", async () => {
    // This tests the `if (this.destroyed) return` guard inside the rAF callback
    // We need to trigger mouseup, then destroy before the rAF fires
    let rafCallback: FrameRequestCallback | null = null;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      rafCallback = cb;
      return 1;
    });

    const view = createView("hello world", 0, 5);

    // Trigger mouseup — this queues a rAF but doesn't execute it
    const mouseUpEvent = new MouseEvent("mouseup", { bubbles: true });
    view.dom.dispatchEvent(mouseUpEvent);

    // Destroy the plugin before rAF fires
    view.destroy();
    const parent = view.dom.parentElement;
    parent?.remove();
    viewInstances.length = 0;

    // Now execute the rAF callback — destroyed flag should prevent clipboard access
    if (rafCallback) {
      rafCallback(0);
    }

    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
