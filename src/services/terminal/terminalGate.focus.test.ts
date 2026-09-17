/**
 * The gate's focus half — split out because `terminalGate.test.ts` runs under
 * `node` (it only ever asserted the workspace gating) and focus needs a DOM.
 *
 * What it pins: asking for the terminal HANDS IT THE CARET, and dismissing it
 * gives the caret back. Before this, `Ctrl+\`` opened a panel you then had to
 * click into, and closing it dropped focus on `<body>` — the next keystroke
 * went nowhere.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useUIStore } from "@/stores/uiStore";
import { useEditorStore } from "@/stores/editorStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { registerTerminalResolver } from "./activeTerminal";

vi.mock("sonner", () => ({ toast: { info: vi.fn() } }));
vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));

import { requestToggleTerminal, toggleTerminalFocus } from "./terminalGate";

const unregisters: Array<() => void> = [];
let terminalFocus: ReturnType<typeof vi.fn>;
let editorFocus: ReturnType<typeof vi.fn>;

/** Let the deferred (rAF) focus land. */
const settle = () => new Promise((r) => requestAnimationFrame(() => r(null)));

beforeEach(() => {
  terminalFocus = vi.fn();
  editorFocus = vi.fn();
  unregisters.push(
    registerTerminalResolver((id) =>
      id === "s1" ? ({ focus: terminalFocus, paste: vi.fn(), modes: {} } as never) : null,
    ),
  );
  useEditorStore.setState({
    tiptap: { ...useEditorStore.getState().tiptap, editorView: { focus: editorFocus } as never },
  });
  useWorkspaceStore.setState({ isWorkspaceMode: true });
  useUIStore.setState({
    terminalVisible: false,
    sourceMode: false,
    terminal: { ...useUIStore.getState().terminal, activeSessionId: "s1" },
  });
  document.body.innerHTML = "";
});

afterEach(() => {
  while (unregisters.length) unregisters.pop()?.();
  useEditorStore.setState({
    tiptap: { ...useEditorStore.getState().tiptap, editorView: null },
  });
});

/** Put the caret inside a terminal surface. */
function focusTerminalSurface(): void {
  const host = document.createElement("div");
  host.className = "xterm";
  const area = document.createElement("textarea");
  host.appendChild(area);
  document.body.appendChild(host);
  area.focus();
}

describe("requestToggleTerminal — focus", () => {
  it("hands the caret to the terminal when it opens", async () => {
    requestToggleTerminal();
    expect(useUIStore.getState().terminalVisible).toBe(true);
    await settle();
    expect(terminalFocus).toHaveBeenCalledOnce();
  });

  it("gives the caret back to the editor when it closes", () => {
    useUIStore.setState({ terminalVisible: true });
    focusTerminalSurface();
    requestToggleTerminal();
    expect(useUIStore.getState().terminalVisible).toBe(false);
    expect(editorFocus).toHaveBeenCalledOnce();
  });

  it("touches no focus when the gate refuses to open", async () => {
    useWorkspaceStore.setState({ isWorkspaceMode: false });
    requestToggleTerminal();
    expect(useUIStore.getState().terminalVisible).toBe(false);
    await settle();
    expect(terminalFocus).not.toHaveBeenCalled();
    expect(editorFocus).not.toHaveBeenCalled();
  });
});

describe("toggleTerminalFocus", () => {
  it("opens the terminal when it is hidden, rather than doing nothing", async () => {
    toggleTerminalFocus();
    expect(useUIStore.getState().terminalVisible).toBe(true);
    await settle();
    expect(terminalFocus).toHaveBeenCalledOnce();
  });

  it("moves the caret to the terminal when the panel is open but unfocused", () => {
    useUIStore.setState({ terminalVisible: true });
    toggleTerminalFocus();
    expect(terminalFocus).toHaveBeenCalledOnce();
    expect(editorFocus).not.toHaveBeenCalled();
  });

  it("moves the caret back to the editor when the terminal holds it", () => {
    useUIStore.setState({ terminalVisible: true });
    focusTerminalSurface();
    toggleTerminalFocus();
    expect(editorFocus).toHaveBeenCalledOnce();
    expect(terminalFocus).not.toHaveBeenCalled();
  });

  // Leaving the panel OPEN is the point: the toggle is about focus, not
  // visibility — the user still wants to see the shell they just left.
  it("never hides the panel", () => {
    useUIStore.setState({ terminalVisible: true });
    focusTerminalSurface();
    toggleTerminalFocus();
    expect(useUIStore.getState().terminalVisible).toBe(true);
  });

  it("still opens the panel when the session is not mounted yet", async () => {
    useUIStore.setState({ terminal: { ...useUIStore.getState().terminal, activeSessionId: null } });
    toggleTerminalFocus();
    expect(useUIStore.getState().terminalVisible).toBe(true);
    await settle();
    expect(terminalFocus).not.toHaveBeenCalled();
  });
});
