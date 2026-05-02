/**
 * TerminalPanel — wiring tests (#856)
 *
 * Focused on the panel→context-menu→resetDisplay path. The audit
 * (codex-toolkit:audit-fix) flagged this wiring as untested critical:
 * a regression here would silently remove the #856 fix in real usage.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
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
  TerminalTabBar: () => <div data-testid="tab-bar" />,
}));

vi.mock("./TerminalSearchBar", () => ({
  TerminalSearchBar: () => <div data-testid="search-bar" />,
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn().mockResolvedValue(""),
  writeText: vi.fn().mockResolvedValue(undefined),
}));

import { TerminalPanel } from "./TerminalPanel";
import { useUIStore } from "@/stores/uiStore";
import { useTerminalSessionStore } from "@/stores/terminalSessionStore";

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
    useTerminalSessionStore.setState({
      sessions: [{ id: "s1", number: 1, status: "alive", revision: 0 }],
      activeSessionId: "s1",
    } as Partial<ReturnType<typeof useTerminalSessionStore.getState>> as never);

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
