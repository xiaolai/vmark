/**
 * TerminalPanel — wiring tests (#856)
 *
 * Focused on the panel→context-menu→resetDisplay path. The audit
 * (cc-suite:audit-fix) flagged this wiring as untested critical:
 * a regression here would silently remove the #856 fix in real usage.
 *
 * The panel's own collaborators run for real — the session hook (which builds
 * real terminal instances), the resize hook and the tab bar. Only xterm.js,
 * its addons, the PTY and Tauri `invoke` are replaced, so "Reset Display" is
 * observed where it lands: a repaint of the terminal xterm drew.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, fireEvent, screen } from "@testing-library/react";

const xterm = vi.hoisted(() => ({
  failOpen: false,
  refreshes: 0,
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    element = document.createElement("div");
    textarea: HTMLTextAreaElement | undefined = undefined;
    parser = { registerOscHandler: vi.fn(), registerEscHandler: vi.fn(() => ({ dispose: vi.fn() })), registerCsiHandler: vi.fn(() => ({ dispose: vi.fn() })) };
    // Floating-prompt subscriptions (setupFloatingPrompt).
    onScroll = vi.fn(() => ({ dispose: vi.fn() }));
    onWriteParsed = vi.fn(() => ({ dispose: vi.fn() }));
    onCursorMove = vi.fn(() => ({ dispose: vi.fn() }));
    onResize = vi.fn(() => ({ dispose: vi.fn() }));
    unicode = { activeVersion: "6" };
    buffer = { active: { viewportY: 0, length: 0, getLine: () => undefined }, onBufferChange: vi.fn(() => ({ dispose: vi.fn() })) };
    modes = { bracketedPasteMode: false };
    options = {};
    cols = 80;
    rows = 24;
    open = vi.fn((container: HTMLElement) => {
      if (xterm.failOpen) throw new Error("terminal parent was disposed");
      const textarea = document.createElement("textarea");
      container.appendChild(textarea);
      this.textarea = textarea;
    });
    refresh = vi.fn(() => {
      xterm.refreshes += 1;
    });
    loadAddon = vi.fn();
    dispose = vi.fn();
    focus = vi.fn();
    write = vi.fn();
    writeln = vi.fn();
    clear = vi.fn();
    resize = vi.fn();
    scrollToBottom = vi.fn();
    hasSelection = vi.fn(() => false);
    getSelection = vi.fn(() => "");
    clearSelection = vi.fn();
    selectAll = vi.fn();
    onData = vi.fn(() => ({ dispose: vi.fn() }));
    onBell = vi.fn(() => ({ dispose: vi.fn() }));
    onTitleChange = vi.fn(() => ({ dispose: vi.fn() }));
    onSelectionChange = vi.fn(() => ({ dispose: vi.fn() }));
    attachCustomKeyEventHandler = vi.fn();
    registerLinkProvider = vi.fn();
    registerMarker = vi.fn(() => undefined);
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = vi.fn();
    proposeDimensions = vi.fn(() => ({ cols: 80, rows: 24 }));
  },
}));
vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class {
    findNext = vi.fn();
    findPrevious = vi.fn();
    clearDecorations = vi.fn();
  },
}));
vi.mock("@xterm/addon-unicode11", () => ({ Unicode11Addon: class {} }));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    onContextLoss = vi.fn();
    clearTextureAtlas = vi.fn();
    dispose = vi.fn();
  },
}));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) =>
    Promise.resolve(
      cmd === "get_default_shell" ? "/bin/zsh" : cmd === "terminal_transcript_prepare" ? "tok" : null,
    ),
  ),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn().mockResolvedValue(""),
  writeText: vi.fn().mockResolvedValue(undefined),
}));

import { TerminalPanel } from "./TerminalPanel";
import { TERMINAL_SURFACE_SELECTOR } from "@/utils/terminalSurface";
import { useUIStore } from "@/stores/uiStore";
import { resetTerminalSessionStore, useTerminalStore } from "@/stores/terminalStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import {
  createWorkspaceInstance,
  createWorkspaceRootIdentity,
} from "@/utils/workspaceIdentity";

function showPanel() {
  useUIStore.setState({
    terminalVisible: true,
    terminalHeight: 200,
    terminalWidth: 300,
    effectiveTerminalPosition: "bottom",
  } as Partial<ReturnType<typeof useUIStore.getState>> as never);
}

const closeButton = () =>
  document.querySelector<HTMLButtonElement>('[data-terminal-action="close"]')!;

beforeEach(() => {
  vi.clearAllMocks();
  xterm.failOpen = false;
  xterm.refreshes = 0;
  resetTerminalSessionStore();
});

describe("TerminalPanel — resetDisplay wiring (#856)", () => {
  it("passes the active terminal's resetDisplay to the context menu, which repaints on click", () => {
    showPanel();
    useTerminalStore.getState().terminalCreateSession();
    const { container } = render(<TerminalPanel />);

    // Trigger context menu via right-click on the terminal container
    const termContainer = container.querySelector(".terminal-container");
    expect(termContainer).toBeTruthy();
    fireEvent.contextMenu(termContainer!, { clientX: 10, clientY: 10 });

    const before = xterm.refreshes;
    fireEvent.click(screen.getByText("Reset Display"));

    expect(xterm.refreshes).toBe(before + 1);
  });

  it("does not render the menu when there is no active terminal", () => {
    // The terminal cannot be built, so its session is dropped and nothing is
    // active.
    xterm.failOpen = true;
    showPanel();
    useTerminalStore.getState().terminalCreateSession();

    const { container } = render(<TerminalPanel />);
    expect(useTerminalStore.getState().activeSessionId).toBeNull();

    const termContainer = container.querySelector(".terminal-container");
    fireEvent.contextMenu(termContainer!, { clientX: 10, clientY: 10 });

    expect(screen.queryByText("Reset Display")).not.toBeInTheDocument();
  });
});

describe("TerminalPanel — closing the last VISIBLE session (WI-TS3.3)", () => {
  it("hides the panel when the last visible session closes", () => {
    useUIStore.setState({ terminalVisible: true });
    useTerminalStore.getState().terminalCreateSession();
    render(<TerminalPanel />);

    fireEvent.click(closeButton());

    expect(useTerminalStore.getState().sessions).toHaveLength(0);
    expect(useUIStore.getState().terminalVisible).toBe(false);
  });

  it("never TOGGLES an already-hidden panel back to visible (the journey-35 resurrect)", () => {
    useUIStore.setState({ terminalVisible: true });
    useTerminalStore.getState().terminalCreateSession();
    render(<TerminalPanel />);
    // Automation teardown: the panel goes hidden, the session outlives it.
    act(() => {
      useUIStore.setState({ terminalVisible: false });
    });

    fireEvent.click(closeButton());

    expect(useTerminalStore.getState().sessions).toHaveLength(0);
    // The old blind toggle flipped this back to true — and the panel's
    // auto-create then spawned a shell nobody asked for.
    expect(useUIStore.getState().terminalVisible).toBe(false);
  });
});

describe("TerminalPanel — rail-mode toggle realigns and auto-creates (R2-15)", () => {
  beforeEach(() => {
    useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
    setRail(false);
  });

  afterEach(() => {
    setRail(false);
    useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
  });

  function addWorkspace(id: string, rootPath: string): void {
    const root = createWorkspaceRootIdentity(rootPath, { platform: "macos" });
    if (!root.ok) throw new Error("bad test root");
    useWorkspaceInstancesStore.getState().addWorkspaceInstance(
      createWorkspaceInstance({
        workspaceInstanceId: id,
        root: root.root,
        ownerWindowLabel: "main",
        createdFrom: "open",
      }),
    );
  }

  function setRail(enabled: boolean): void {
    useSettingsStore.setState({
      general: {
        ...useSettingsStore.getState().general,
        workspaceRailMode: enabled,
      },
    });
  }

  it("toggling the rail ON realigns a newly-hidden active onto a visible session", () => {
    addWorkspace("wsi-a", "/repo-a");
    addWorkspace("wsi-b", "/repo-b");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance("main", "wsi-a");
    const sA = useTerminalStore.getState().terminalCreateSession({ ownerInstanceId: "wsi-a" })!;
    const sB = useTerminalStore.getState().terminalCreateSession({ ownerInstanceId: "wsi-b" })!;
    useTerminalStore.getState().terminalSetActiveSession(sB.id);
    useUIStore.setState({ terminalVisible: true });
    render(<TerminalPanel />);
    // Rail off: sB is visible (stamps inert) and legitimately active.
    expect(useTerminalStore.getState().activeSessionId).toBe(sB.id);

    act(() => setRail(true)); // sB hides — wsi-a is the active scope

    // Before R2-15 nothing re-ran: the hidden sB stayed "active" over a tab
    // bar that no longer shows it.
    expect(useTerminalStore.getState().activeSessionId).toBe(sA.id);
    // No phantom session: the visible population was non-empty.
    expect(useTerminalStore.getState().sessions).toHaveLength(2);
  });

  it("toggling the rail ON over an EMPTY visible scope auto-creates its first session", () => {
    addWorkspace("wsi-a", "/repo-a");
    addWorkspace("wsi-b", "/repo-b");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance("main", "wsi-a");
    const sB = useTerminalStore.getState().terminalCreateSession({ ownerInstanceId: "wsi-b" })!;
    useUIStore.setState({ terminalVisible: true });
    render(<TerminalPanel />);
    expect(useTerminalStore.getState().activeSessionId).toBe(sB.id);

    act(() => setRail(true)); // wsi-a's visible population is empty

    const terminal = useTerminalStore.getState();
    const created = terminal.sessions.find((s) => s.workspaceInstanceId === "wsi-a");
    expect(created).toBeDefined();
    expect(terminal.activeSessionId).toBe(created?.id);
  });

  /**
   * `TERMINAL_SURFACE_SELECTOR` is a STRING, and two layers steer off it: the
   * keybinding scope resolver (which turns it into the `terminal` scope) and
   * the editor⇄terminal focus toggle. Rename this container and both go
   * silently blind — every terminal-scoped binding starts behaving like a
   * window binding, and the focus toggle always believes focus is in the
   * editor. Nothing fails; it just stops working.
   *
   * Every other test of that selector builds its own `<div class="…">` and so
   * only proves the string equals itself. This one asks the REAL panel. The
   * `.xterm` half is asked of the REAL xterm.js in
   * `browserTier.smoke.webkit.test.ts`, because jsdom mocks that library.
   */
  it("renders a container the terminal-surface selector actually matches", () => {
    useUIStore.setState({ terminalVisible: true });
    const { container } = render(<TerminalPanel />);
    expect(container.querySelector(TERMINAL_SURFACE_SELECTOR)).not.toBeNull();
  });
});
