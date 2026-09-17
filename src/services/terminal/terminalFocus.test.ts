/**
 * Focus across the editor⇄terminal boundary.
 *
 * Nothing modelled this before: opening the panel focused the terminal only
 * when the ACTIVE SESSION changed (the focus call lives in `switchVisibility`),
 * so re-opening an existing session left the caret where it was; and hiding the
 * panel set `display: none` on the focused xterm textarea, dropping focus onto
 * `<body>` with nothing to pick it up.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useUIStore } from "@/stores/uiStore";
import { useEditorStore } from "@/stores/editorStore";
import { registerTerminalResolver } from "./activeTerminal";
import {
  focusActiveTerminal,
  focusActiveTerminalSoon,
  focusEditorNow,
  restoreEditorFocusIfOrphaned,
} from "./terminalFocus";

const unregisters: Array<() => void> = [];

/** A stand-in for the live xterm, registered through the REAL resolver seam. */
function registerTerminal(sessionId: string) {
  const focus = vi.fn();
  unregisters.push(
    registerTerminalResolver((id) =>
      id === sessionId ? ({ focus, paste: vi.fn(), modes: {} } as never) : null,
    ),
  );
  return focus;
}

/** A stand-in editor view — only `focus()` is exercised. */
function registerEditors() {
  const tiptap = vi.fn();
  const source = vi.fn();
  useEditorStore.setState({
    tiptap: { ...useEditorStore.getState().tiptap, editorView: { focus: tiptap } as never },
    source: { ...useEditorStore.getState().source, editorView: { focus: source } as never },
  });
  return { tiptap, source };
}

beforeEach(() => {
  useUIStore.setState({
    terminalVisible: false,
    sourceMode: false,
    terminal: { ...useUIStore.getState().terminal, activeSessionId: null },
  });
  document.body.innerHTML = "";
});

afterEach(() => {
  while (unregisters.length) unregisters.pop()?.();
  useEditorStore.setState({
    tiptap: { ...useEditorStore.getState().tiptap, editorView: null },
    source: { ...useEditorStore.getState().source, editorView: null },
  });
});

describe("focusActiveTerminal", () => {
  it("focuses the live terminal for the active session", () => {
    const focus = registerTerminal("s1");
    useUIStore.setState({ terminal: { ...useUIStore.getState().terminal, activeSessionId: "s1" } });
    expect(focusActiveTerminal()).toBe(true);
    expect(focus).toHaveBeenCalledOnce();
  });

  it("reports failure when there is no active session", () => {
    registerTerminal("s1");
    expect(focusActiveTerminal()).toBe(false);
  });

  it("reports failure when the session has no mounted terminal yet", () => {
    useUIStore.setState({ terminal: { ...useUIStore.getState().terminal, activeSessionId: "ghost" } });
    expect(focusActiveTerminal()).toBe(false);
  });
});

describe("focusActiveTerminalSoon", () => {
  it("defers, because the panel is still display:none in the commit that showed it", async () => {
    const focus = registerTerminal("s1");
    useUIStore.setState({ terminal: { ...useUIStore.getState().terminal, activeSessionId: "s1" } });
    focusActiveTerminalSoon();
    expect(focus).not.toHaveBeenCalled();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(focus).toHaveBeenCalledOnce();
  });
});

describe("focusEditorNow", () => {
  it("focuses the WYSIWYG surface", () => {
    const { tiptap, source } = registerEditors();
    focusEditorNow();
    expect(tiptap).toHaveBeenCalledOnce();
    expect(source).not.toHaveBeenCalled();
  });

  it("focuses the Source surface in source mode", () => {
    const { tiptap, source } = registerEditors();
    useUIStore.setState({ sourceMode: true });
    focusEditorNow();
    expect(source).toHaveBeenCalledOnce();
    expect(tiptap).not.toHaveBeenCalled();
  });
});

describe("restoreEditorFocusIfOrphaned", () => {
  it("picks focus up off <body> after the panel hid the caret's element", () => {
    const { tiptap } = registerEditors();
    restoreEditorFocusIfOrphaned();
    expect(tiptap).toHaveBeenCalledOnce();
  });

  it("claims focus still sitting on the now-hidden terminal", () => {
    const { tiptap } = registerEditors();
    const host = document.createElement("div");
    host.className = "xterm";
    const area = document.createElement("textarea");
    host.appendChild(area);
    document.body.appendChild(host);
    area.focus();
    restoreEditorFocusIfOrphaned();
    expect(tiptap).toHaveBeenCalledOnce();
  });

  // The whole point of "if orphaned": closing the terminal must not yank the
  // caret out of a sidebar filter the user is typing into.
  it("leaves a real focus owner alone", () => {
    const { tiptap } = registerEditors();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    restoreEditorFocusIfOrphaned();
    expect(tiptap).not.toHaveBeenCalled();
  });

  it("is a no-op when no editor is mounted", () => {
    expect(() => restoreEditorFocusIfOrphaned()).not.toThrow();
  });
});
