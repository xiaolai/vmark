import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TerminalTabBar } from "./TerminalTabBar";
import {
  useTerminalSessionStore,
  resetTerminalSessionStore,
} from "@/stores/terminalSessionStore";

describe("TerminalTabBar", () => {
  let onClose: () => void;
  let onRestart: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    resetTerminalSessionStore();
    onClose = vi.fn<() => void>();
    onRestart = vi.fn<() => void>();
  });

  function renderWithSession() {
    useTerminalSessionStore.getState().createSession();
    return render(<TerminalTabBar onClose={onClose} onRestart={onRestart} />);
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
    expect(useTerminalSessionStore.getState().sessions).toHaveLength(2);
  });

  it("switches active session on tab click", () => {
    useTerminalSessionStore.getState().createSession();
    useTerminalSessionStore.getState().createSession();

    render(<TerminalTabBar onClose={onClose} onRestart={onRestart} />);

    const tab1 = screen.getByTitle("Terminal 1");
    fireEvent.click(tab1);
    expect(useTerminalSessionStore.getState().activeSessionId).toBe(
      useTerminalSessionStore.getState().sessions[0].id,
    );
  });

  it("disables + button at 5 sessions", () => {
    for (let i = 0; i < 5; i++) {
      useTerminalSessionStore.getState().createSession();
    }
    render(<TerminalTabBar onClose={onClose} onRestart={onRestart} />);

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
    const session = useTerminalSessionStore.getState().createSession()!;
    useTerminalSessionStore.getState().renameSession(session.id, "My Shell");
    render(<TerminalTabBar onClose={onClose} onRestart={onRestart} />);
    expect(screen.getByText("M")).toBeInTheDocument();
  });

  it("displays '?' for empty-label sessions", () => {
    const session = useTerminalSessionStore.getState().createSession()!;
    useTerminalSessionStore.getState().renameSession(session.id, "");
    render(<TerminalTabBar onClose={onClose} onRestart={onRestart} />);
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("applies horizontal class when orientation is horizontal", () => {
    useTerminalSessionStore.getState().createSession();
    const { container } = render(
      <TerminalTabBar onClose={onClose} onRestart={onRestart} orientation="horizontal" />,
    );
    expect(container.querySelector(".terminal-tab-bar--horizontal")).toBeTruthy();
  });

  it("does not apply horizontal class for vertical orientation (default)", () => {
    useTerminalSessionStore.getState().createSession();
    const { container } = render(
      <TerminalTabBar onClose={onClose} onRestart={onRestart} />,
    );
    expect(container.querySelector(".terminal-tab-bar--horizontal")).toBeFalsy();
  });

  it("applies dead class to dead sessions", () => {
    const session = useTerminalSessionStore.getState().createSession()!;
    useTerminalSessionStore.getState().markSessionDead(session.id);
    const { container } = render(
      <TerminalTabBar onClose={onClose} onRestart={onRestart} />,
    );
    expect(container.querySelector(".terminal-tab-dead")).toBeTruthy();
  });

  it("applies active class to active session", () => {
    useTerminalSessionStore.getState().createSession();
    const { container } = render(
      <TerminalTabBar onClose={onClose} onRestart={onRestart} />,
    );
    expect(container.querySelector(".terminal-tab-active")).toBeTruthy();
  });
});
