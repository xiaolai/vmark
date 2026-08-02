/**
 * Source Copy-on-Select Tests
 *
 * Tests for the copy-on-select logic in source mode:
 * selection text extraction, setting checks, edge cases.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

// Mock settingsStore before importing the plugin
vi.mock("@/plugins/shared/hostSettings", () => ({
  hostSettings: { copyOnSelect: vi.fn(() => true) },
}));

import { hostSettings } from "@/plugins/shared/hostSettings";
import { createSourceCopyOnSelectPlugin } from "../sourceCopyOnSelect";

function createView(content: string, from: number, to: number): EditorView {
  const state = EditorState.create({
    doc: content,
    selection: { anchor: from, head: to },
    extensions: [createSourceCopyOnSelectPlugin()],
  });
  return new EditorView({
    state,
    parent: document.createElement("div"),
  });
}

describe("sourceCopyOnSelect", () => {
  let clipboardSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clipboardSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: clipboardSpy },
      writable: true,
      configurable: true,
    });

    vi.mocked(hostSettings.copyOnSelect).mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("copies selected text on mouseup", async () => {
    const content = "Hello, world!";
    const view = createView(content, 0, 5);

    view.dom.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    // Wait for requestAnimationFrame
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(clipboardSpy).toHaveBeenCalledWith("Hello");
    view.destroy();
  });

  it("does not copy when selection is empty (cursor only)", async () => {
    const content = "Hello, world!";
    const view = createView(content, 3, 3);

    view.dom.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(clipboardSpy).not.toHaveBeenCalled();
    view.destroy();
  });

  it("does not copy when copyOnSelect is disabled", async () => {
    vi.mocked(hostSettings.copyOnSelect).mockReturnValue(false);

    const content = "Hello, world!";
    const view = createView(content, 0, 5);

    view.dom.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(clipboardSpy).not.toHaveBeenCalled();
    view.destroy();
  });

  it("copies multi-line selection correctly", async () => {
    const content = "Line one\nLine two\nLine three";
    // "Line one\nLine two" = 17 chars (positions 0..17)
    const view = createView(content, 0, 17);

    view.dom.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(clipboardSpy).toHaveBeenCalledWith("Line one\nLine two");
    view.destroy();
  });

  it("silently handles clipboard write failure", async () => {
    clipboardSpy.mockRejectedValue(new Error("focus lost"));

    const content = "Hello, world!";
    const view = createView(content, 0, 5);

    view.dom.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    // Should not throw
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(clipboardSpy).toHaveBeenCalledWith("Hello");
    view.destroy();
  });

  it("trims trailing whitespace from copied text", async () => {
    const content = "hello   \nworld  ";
    const view = createView(content, 0, content.length);

    view.dom.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(clipboardSpy).toHaveBeenCalledWith("hello\nworld");
    view.destroy();
  });

  it("collapses multiple blank lines in copied text", async () => {
    const content = "a\n\n\n\nb";
    const view = createView(content, 0, content.length);

    view.dom.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(clipboardSpy).toHaveBeenCalledWith("a\n\nb");
    view.destroy();
  });

  it("trims leading/trailing blank lines from copied text", async () => {
    const content = "\n\nhello\n\n";
    const view = createView(content, 0, content.length);

    view.dom.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(clipboardSpy).toHaveBeenCalledWith("hello");
    view.destroy();
  });
});
