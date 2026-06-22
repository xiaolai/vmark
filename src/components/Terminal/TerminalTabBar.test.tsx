import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TerminalTabBar } from "./TerminalTabBar";
import {
  useUIStore,
  resetTerminalSessionStore,
} from "@/stores/uiStore";
import { useSettingsStore } from "@/stores/settingsStore";

describe("TerminalTabBar", () => {
  let onClose: () => void;
  let onRestart: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    resetTerminalSessionStore();
    useSettingsStore.getState().updateTerminalSetting("position", "auto");
    onClose = vi.fn<() => void>();
    onRestart = vi.fn<() => void>();
  });

  function renderWithSession() {
    useUIStore.getState().terminalCreateSession();
    return render(<TerminalTabBar onClose={onClose} onRestart={onRestart} position="bottom" />);
  }

  it("renders session tab with number", () => {
    renderWithSession();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByTitle("Terminal 1")).toBeInTheDocument();
  });

  it("exposes session tab to assistive tech via aria-label", () => {
    renderWithSession();
    expect(
      screen.getByRole("button", { name: /Terminal 1/i }),
    ).toBeInTheDocument();
  });

  it("creates a new session on + click", () => {
    renderWithSession();
    const addBtn = screen.getByTitle("New Terminal");
    fireEvent.click(addBtn);
    expect(useUIStore.getState().terminal.sessions).toHaveLength(2);
  });

  it("switches active session on tab click", () => {
    useUIStore.getState().terminalCreateSession();
    useUIStore.getState().terminalCreateSession();

    render(<TerminalTabBar onClose={onClose} onRestart={onRestart} position="bottom" />);

    const tab1 = screen.getByTitle("Terminal 1");
    fireEvent.click(tab1);
    expect(useUIStore.getState().terminal.activeSessionId).toBe(
      useUIStore.getState().terminal.sessions[0].id,
    );
  });

  it("disables + button at 5 sessions", () => {
    for (let i = 0; i < 5; i++) {
      useUIStore.getState().terminalCreateSession();
    }
    render(<TerminalTabBar onClose={onClose} onRestart={onRestart} position="bottom" />);

    const addBtn = screen.getByTitle("Maximum 5 sessions");
    expect(addBtn).toBeDisabled();
  });

  it("calls onClose and onRestart", () => {
    renderWithSession();
    fireEvent.click(screen.getByTitle("Close"));
    expect(onClose).toHaveBeenCalled();
    fireEvent.click(screen.getByTitle("Restart"));
    expect(onRestart).toHaveBeenCalled();
  });

  it("displays first character for custom-named sessions", () => {
    const session = useUIStore.getState().terminalCreateSession()!;
    useUIStore.getState().terminalRenameSession(session.id, "My Shell");
    render(<TerminalTabBar onClose={onClose} onRestart={onRestart} position="bottom" />);
    expect(screen.getByText("M")).toBeInTheDocument();
  });

  it("displays '?' for empty-label sessions", () => {
    const session = useUIStore.getState().terminalCreateSession()!;
    useUIStore.getState().terminalRenameSession(session.id, "");
    render(<TerminalTabBar onClose={onClose} onRestart={onRestart} position="bottom" />);
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("applies horizontal class when orientation is horizontal", () => {
    useUIStore.getState().terminalCreateSession();
    const { container } = render(
      <TerminalTabBar onClose={onClose} onRestart={onRestart} position="bottom" orientation="horizontal" />,
    );
    expect(container.querySelector(".terminal-tab-bar--horizontal")).toBeTruthy();
  });

  it("does not apply horizontal class for vertical orientation (default)", () => {
    useUIStore.getState().terminalCreateSession();
    const { container } = render(
      <TerminalTabBar onClose={onClose} onRestart={onRestart} position="bottom" />,
    );
    expect(container.querySelector(".terminal-tab-bar--horizontal")).toBeFalsy();
  });

  it("applies dead class to dead sessions", () => {
    const session = useUIStore.getState().terminalCreateSession()!;
    useUIStore.getState().terminalMarkSessionDead(session.id);
    const { container } = render(
      <TerminalTabBar onClose={onClose} onRestart={onRestart} position="bottom" />,
    );
    expect(container.querySelector(".terminal-tab-dead")).toBeTruthy();
  });

  it("applies active class to active session", () => {
    useUIStore.getState().terminalCreateSession();
    const { container } = render(
      <TerminalTabBar onClose={onClose} onRestart={onRestart} position="bottom" />,
    );
    expect(container.querySelector(".terminal-tab-active")).toBeTruthy();
  });

  it("shows the program title (first char) when not renamed (G4/WI-3.2)", () => {
    const s = useUIStore.getState().terminalCreateSession()!;
    useUIStore.getState().terminalSetProgramTitle(s.id, "vim");
    render(<TerminalTabBar onClose={onClose} onRestart={onRestart} position="bottom" />);
    // Program title wins over the default "Terminal 1" label.
    expect(screen.getByText("V")).toBeInTheDocument();
    expect(screen.getByTitle("vim")).toBeInTheDocument();
  });

  it("user-renamed label wins over a later program title (G4/WI-3.2)", () => {
    const s = useUIStore.getState().terminalCreateSession()!;
    useUIStore.getState().terminalRenameSession(s.id, "My Shell");
    useUIStore.getState().terminalSetProgramTitle(s.id, "vim");
    render(<TerminalTabBar onClose={onClose} onRestart={onRestart} position="bottom" />);
    expect(screen.getByText("M")).toBeInTheDocument();
    expect(screen.getByTitle("My Shell")).toBeInTheDocument();
  });

  it("falls back to the default label when there is no program title", () => {
    useUIStore.getState().terminalCreateSession();
    render(<TerminalTabBar onClose={onClose} onRestart={onRestart} position="bottom" />);
    expect(screen.getByTitle("Terminal 1")).toBeInTheDocument();
  });

  it("swap in auto mode toggles auto ↔ auto-flipped (keeps smart switching)", () => {
    useUIStore.getState().terminalCreateSession();
    // beforeEach leaves the setting at "auto"; effective position is "bottom".
    render(<TerminalTabBar onClose={onClose} onRestart={onRestart} position="bottom" />);
    const btn = screen.getByTitle("Swap position");
    fireEvent.click(btn);
    expect(useSettingsStore.getState().terminal.position).toBe("auto-flipped");
    fireEvent.click(btn);
    expect(useSettingsStore.getState().terminal.position).toBe("auto");
  });

  it("swap flips an explicit side to its opposite", () => {
    useUIStore.getState().terminalCreateSession();
    useSettingsStore.getState().updateTerminalSetting("position", "bottom");
    render(<TerminalTabBar onClose={onClose} onRestart={onRestart} position="bottom" />);
    fireEvent.click(screen.getByTitle("Swap position"));
    expect(useSettingsStore.getState().terminal.position).toBe("top");
  });

  it("swap flips an explicit horizontal side left↔right", () => {
    useUIStore.getState().terminalCreateSession();
    useSettingsStore.getState().updateTerminalSetting("position", "right");
    render(<TerminalTabBar onClose={onClose} onRestart={onRestart} position="right" orientation="horizontal" />);
    fireEvent.click(screen.getByTitle("Swap position"));
    expect(useSettingsStore.getState().terminal.position).toBe("left");
  });
});
