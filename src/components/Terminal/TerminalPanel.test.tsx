/**
 * TerminalPanel — wiring tests (#856)
 *
 * Focused on the panel→context-menu→resetDisplay path. The audit
 * (cc-suite:audit-fix) flagged this wiring as untested critical:
 * a regression here would silently remove the #856 fix in real usage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, fireEvent, screen } from "@testing-library/react";
import type { Terminal } from "@xterm/xterm";
import type { IPty } from "@/lib/pty";

// --- Hoisted mock state ---

const { mockResetDisplay, mockGetActiveTerminal, mockUseTerminalSessions, mockFit, mockUseTerminalResize } = vi.hoisted(() => ({
  mockResetDisplay: vi.fn(),
  mockGetActiveTerminal: vi.fn<() => null | {
    term: Terminal;
    ptyRef: React.RefObject<IPty | null>;
    resetDisplay: () => void;
  }>(),
  mockUseTerminalSessions: vi.fn(),
  mockFit: vi.fn(),
  mockUseTerminalResize: vi.fn(() => ({
    isResizing: false,
    handleResizeStart: vi.fn(),
  })),
}));

vi.mock("./useTerminalSessions", () => ({
  useTerminalSessions: (...args: unknown[]) => mockUseTerminalSessions(...args),
}));

vi.mock("./useTerminalResize", () => ({
  useTerminalResize: (...args: unknown[]) => mockUseTerminalResize(...args),
}));

vi.mock("./TerminalTabBar", () => ({
  // Expose onClose so the close path (WI-TS3.3) is reachable from tests.
  TerminalTabBar: (props: { onClose: () => void }) => (
    <button data-testid="tab-bar" onClick={props.onClose} />
  ),
}));

vi.mock("./TerminalSearchBar", () => ({
  TerminalSearchBar: () => <div data-testid="search-bar" />,
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn().mockResolvedValue(""),
  writeText: vi.fn().mockResolvedValue(undefined),
}));

import { TerminalPanel } from "./TerminalPanel";
import { resetTerminalSessionStore, useUIStore } from "@/stores/uiStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import {
  createWorkspaceInstance,
  createWorkspaceRootIdentity,
} from "@/utils/workspaceIdentity";

function makeFakeTerm(): Terminal {
  return {
    hasSelection: vi.fn(() => false),
    getSelection: vi.fn(() => ""),
    clearSelection: vi.fn(),
    selectAll: vi.fn(),
    clear: vi.fn(),
    focus: vi.fn(),
  } as unknown as Terminal;
}

describe("TerminalPanel — resetDisplay wiring (#856)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Show the panel so it activates xterm
    useUIStore.setState({
      terminalVisible: true,
      terminalHeight: 200,
      terminalWidth: 300,
      effectiveTerminalPosition: "bottom",
    } as Partial<ReturnType<typeof useUIStore.getState>> as never);

    // Ensure a session exists
    useUIStore.setState({
      sessions: [{ id: "s1", number: 1, status: "alive", revision: 0 }],
      activeSessionId: "s1",
    } as Partial<ReturnType<typeof useUIStore.getState>> as never);

    mockUseTerminalSessions.mockReturnValue({
      fit: mockFit,
      getActiveTerminal: mockGetActiveTerminal,
      getActiveSearchAddon: vi.fn(() => null),
      restartActiveSession: vi.fn(),
    });

    const fakeTerm = makeFakeTerm();
    mockGetActiveTerminal.mockReturnValue({
      term: fakeTerm,
      ptyRef: { current: null },
      resetDisplay: mockResetDisplay,
    });
  });

  it("passes resetDisplay from active terminal to context menu, which invokes it on click", () => {
    const { container } = render(<TerminalPanel />);

    // Trigger context menu via right-click on the terminal container
    const termContainer = container.querySelector(".terminal-container");
    expect(termContainer).toBeTruthy();
    fireEvent.contextMenu(termContainer!, { clientX: 10, clientY: 10 });

    // Click "Reset Display" menu item
    fireEvent.click(screen.getByText("Reset Display"));

    expect(mockResetDisplay).toHaveBeenCalledTimes(1);
  });

  it("does not render Reset Display when getActiveTerminal returns null", () => {
    mockGetActiveTerminal.mockReturnValue(null);

    const { container } = render(<TerminalPanel />);

    const termContainer = container.querySelector(".terminal-container");
    fireEvent.contextMenu(termContainer!, { clientX: 10, clientY: 10 });

    // Menu should not render at all when there's no active terminal
    expect(screen.queryByText("Reset Display")).not.toBeInTheDocument();
  });
});

describe("TerminalPanel — closing the last VISIBLE session (WI-TS3.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTerminalSessionStore();
    mockUseTerminalSessions.mockReturnValue({
      fit: mockFit,
      getActiveTerminal: mockGetActiveTerminal,
      getActiveSearchAddon: vi.fn(() => null),
      restartActiveSession: vi.fn(),
    });
    mockGetActiveTerminal.mockReturnValue(null);
  });

  it("hides the panel when the last visible session closes", () => {
    useUIStore.setState({ terminalVisible: true });
    useUIStore.getState().terminalCreateSession();
    render(<TerminalPanel />);

    fireEvent.click(screen.getByTestId("tab-bar"));

    expect(useUIStore.getState().terminal.sessions).toHaveLength(0);
    expect(useUIStore.getState().terminalVisible).toBe(false);
  });

  it("never TOGGLES an already-hidden panel back to visible (the journey-35 resurrect)", () => {
    useUIStore.setState({ terminalVisible: true });
    useUIStore.getState().terminalCreateSession();
    render(<TerminalPanel />);
    // Automation teardown: the panel goes hidden, the session outlives it.
    act(() => {
      useUIStore.setState({ terminalVisible: false });
    });

    fireEvent.click(screen.getByTestId("tab-bar"));

    expect(useUIStore.getState().terminal.sessions).toHaveLength(0);
    // The old blind toggle flipped this back to true — and the panel's
    // auto-create then spawned a shell nobody asked for.
    expect(useUIStore.getState().terminalVisible).toBe(false);
  });
});

describe("TerminalPanel — rail-mode toggle realigns and auto-creates (R2-15)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTerminalSessionStore();
    useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
    setRail(false);
    mockUseTerminalSessions.mockReturnValue({
      fit: mockFit,
      getActiveTerminal: mockGetActiveTerminal,
      getActiveSearchAddon: vi.fn(() => null),
      restartActiveSession: vi.fn(),
    });
    mockGetActiveTerminal.mockReturnValue(null);
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
    const sA = useUIStore.getState().terminalCreateSession({ ownerInstanceId: "wsi-a" })!;
    const sB = useUIStore.getState().terminalCreateSession({ ownerInstanceId: "wsi-b" })!;
    useUIStore.getState().terminalSetActiveSession(sB.id);
    useUIStore.setState({ terminalVisible: true });
    render(<TerminalPanel />);
    // Rail off: sB is visible (stamps inert) and legitimately active.
    expect(useUIStore.getState().terminal.activeSessionId).toBe(sB.id);

    act(() => setRail(true)); // sB hides — wsi-a is the active scope

    // Before R2-15 nothing re-ran: the hidden sB stayed "active" over a tab
    // bar that no longer shows it.
    expect(useUIStore.getState().terminal.activeSessionId).toBe(sA.id);
    // No phantom session: the visible population was non-empty.
    expect(useUIStore.getState().terminal.sessions).toHaveLength(2);
  });

  it("toggling the rail ON over an EMPTY visible scope auto-creates its first session", () => {
    addWorkspace("wsi-a", "/repo-a");
    addWorkspace("wsi-b", "/repo-b");
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance("main", "wsi-a");
    const sB = useUIStore.getState().terminalCreateSession({ ownerInstanceId: "wsi-b" })!;
    useUIStore.setState({ terminalVisible: true });
    render(<TerminalPanel />);
    expect(useUIStore.getState().terminal.activeSessionId).toBe(sB.id);

    act(() => setRail(true)); // wsi-a's visible population is empty

    const terminal = useUIStore.getState().terminal;
    const created = terminal.sessions.find((s) => s.workspaceInstanceId === "wsi-a");
    expect(created).toBeDefined();
    expect(terminal.activeSessionId).toBe(created?.id);
  });
});
