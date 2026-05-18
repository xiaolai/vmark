import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { isTextEditableContext, useSelectAllScope } from "./useSelectAllScope";

/**
 * Synthesize a keydown event that matches what the browser delivers for
 * Cmd/Ctrl+A. JSDOM doesn't apply OS-specific modifier semantics, so we set
 * both metaKey and ctrlKey explicitly when needed via per-test overrides.
 */
function fireSelectAll(
  target: Element,
  opts: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "a",
    bubbles: true,
    cancelable: true,
    metaKey: opts.metaKey ?? true,
    ctrlKey: opts.ctrlKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    altKey: opts.altKey ?? false,
  });
  target.dispatchEvent(event);
  return event;
}

describe("isTextEditableContext", () => {
  it("treats an input element as editable", () => {
    const el = document.createElement("input");
    expect(isTextEditableContext(el)).toBe(true);
  });

  it("treats a textarea as editable", () => {
    const el = document.createElement("textarea");
    expect(isTextEditableContext(el)).toBe(true);
  });

  it("treats a contentEditable host as editable", () => {
    const el = document.createElement("div");
    el.setAttribute("contenteditable", "true");
    document.body.appendChild(el);
    try {
      // jsdom respects contentEditable for isContentEditable
      expect(isTextEditableContext(el)).toBe(true);
    } finally {
      el.remove();
    }
  });

  it("treats a child of .cm-editor as editable", () => {
    const editor = document.createElement("div");
    editor.className = "cm-editor";
    const child = document.createElement("span");
    editor.appendChild(child);
    document.body.appendChild(editor);
    try {
      expect(isTextEditableContext(child)).toBe(true);
    } finally {
      editor.remove();
    }
  });

  it("treats a child of .xterm as editable", () => {
    const terminal = document.createElement("div");
    terminal.className = "xterm";
    const child = document.createElement("span");
    terminal.appendChild(child);
    document.body.appendChild(terminal);
    try {
      expect(isTextEditableContext(child)).toBe(true);
    } finally {
      terminal.remove();
    }
  });

  it("rejects plain divs (sidebar / status bar / body)", () => {
    const el = document.createElement("div");
    el.className = "sidebar";
    expect(isTextEditableContext(el)).toBe(false);
  });

  it("rejects null", () => {
    expect(isTextEditableContext(null)).toBe(false);
  });
});

describe("useSelectAllScope", () => {
  let teardown: (() => void) | null = null;

  beforeEach(() => {
    document.body.innerHTML = "";
    const { unmount } = renderHook(() => useSelectAllScope());
    teardown = unmount;
  });

  afterEach(() => {
    teardown?.();
    teardown = null;
    document.body.innerHTML = "";
  });

  it("prevents the browser select-all when target is a sidebar div", () => {
    const sidebar = document.createElement("div");
    sidebar.setAttribute("aria-label", "sidebar");
    document.body.appendChild(sidebar);

    const event = fireSelectAll(sidebar);
    expect(event.defaultPrevented).toBe(true);
  });

  it("does NOT prevent default when target is inside the editor (.cm-editor)", () => {
    const editor = document.createElement("div");
    editor.className = "cm-editor";
    const content = document.createElement("div");
    editor.appendChild(content);
    document.body.appendChild(editor);

    const event = fireSelectAll(content);
    expect(event.defaultPrevented).toBe(false);
  });

  it("does NOT prevent default when target is inside the terminal (.xterm)", () => {
    const term = document.createElement("div");
    term.className = "xterm";
    const content = document.createElement("div");
    term.appendChild(content);
    document.body.appendChild(term);

    const event = fireSelectAll(content);
    expect(event.defaultPrevented).toBe(false);
  });

  it("does NOT prevent default when target is an input", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);

    const event = fireSelectAll(input);
    expect(event.defaultPrevented).toBe(false);
  });

  it("ignores Cmd+Shift+A (lets other handlers process it)", () => {
    const div = document.createElement("div");
    document.body.appendChild(div);

    const event = fireSelectAll(div, { shiftKey: true });
    expect(event.defaultPrevented).toBe(false);
  });

  it("ignores plain 'A' without a modifier", () => {
    const div = document.createElement("div");
    document.body.appendChild(div);

    const event = fireSelectAll(div, { metaKey: false, ctrlKey: false });
    expect(event.defaultPrevented).toBe(false);
  });

  it("treats Ctrl+A the same as Cmd+A (Windows/Linux equivalence)", () => {
    const sidebar = document.createElement("div");
    document.body.appendChild(sidebar);

    const event = fireSelectAll(sidebar, { metaKey: false, ctrlKey: true });
    expect(event.defaultPrevented).toBe(true);
  });

  it("removes the listener on unmount", () => {
    teardown?.();
    teardown = null;

    const sidebar = document.createElement("div");
    document.body.appendChild(sidebar);
    const event = fireSelectAll(sidebar);
    // With the listener torn down, the hook no longer intercepts the event.
    expect(event.defaultPrevented).toBe(false);
  });
});
