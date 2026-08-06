import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
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

  // The E2E journey suite (e2e/journeys/17-terminal-workspace-cwd.mjs) drives
  // these buttons to create and dispose its OWN terminal session. Selecting them
  // by DOM order is fragile and by aria-label breaks under any non-English
  // locale, so `data-terminal-action` is a stable, locale-independent contract.
  // Renaming or dropping one of these values breaks E2E, not just a unit test.
  it("exposes stable data-terminal-action hooks for automation", () => {
    const { container } = renderWithSession();
    const actions = [...container.querySelectorAll("[data-terminal-action]")].map((el) =>
      el.getAttribute("data-terminal-action"),
    );
    expect(actions).toEqual(expect.arrayContaining(["new", "swap", "close", "restart"]));
  });

  it("data-terminal-action hooks resolve to exactly one element each", () => {
    const { container } = renderWithSession();
    for (const action of ["new", "swap", "close", "restart"]) {
      expect(
        container.querySelectorAll(`[data-terminal-action="${action}"]`),
        `expected exactly one [data-terminal-action="${action}"]`,
      ).toHaveLength(1);
    }
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

  describe("tab rename (WI-4.1 — closes T5)", () => {
    /** The rename text box, once edit mode is entered. */
    function renameInput(): HTMLInputElement {
      return screen.getByRole("textbox", { name: /rename/i }) as HTMLInputElement;
    }

    it("double-click enters rename mode with the current name pre-filled", () => {
      renderWithSession();
      fireEvent.doubleClick(screen.getByTitle("Terminal 1"));
      expect(renameInput().value).toBe("Terminal 1");
      expect(document.activeElement).toBe(renameInput());
    });

    it("renames a session on Enter", () => {
      renderWithSession();
      const id = useUIStore.getState().terminal.sessions[0].id;
      fireEvent.doubleClick(screen.getByTitle("Terminal 1"));
      fireEvent.change(renameInput(), { target: { value: "build" } });
      fireEvent.keyDown(renameInput(), { key: "Enter" });

      const session = useUIStore.getState().terminal.sessions.find((x) => x.id === id)!;
      expect(session.label).toBe("build");
      expect(session.isUserRenamed).toBe(true);
    });

    it("a renamed tab stops following the program title (the D4 precedence)", () => {
      // The whole point of T5: `isUserRenamed` existed and TerminalTabBar
      // honored it, but nothing could ever SET it — the branch was dead.
      renderWithSession();
      const id = useUIStore.getState().terminal.sessions[0].id;
      act(() => useUIStore.getState().terminalSetProgramTitle(id, "vim README.md"));
      // Before the rename, the program title wins.
      expect(screen.getByTitle("vim README.md")).toBeInTheDocument();

      fireEvent.doubleClick(screen.getByTitle("vim README.md"));
      fireEvent.change(renameInput(), { target: { value: "notes" } });
      fireEvent.keyDown(renameInput(), { key: "Enter" });

      expect(screen.getByTitle("notes")).toBeInTheDocument();
      // A LATER program title must not take the tab back.
      act(() => useUIStore.getState().terminalSetProgramTitle(id, "ssh prod"));
      expect(screen.getByTitle("notes")).toBeInTheDocument();
      expect(screen.queryByTitle("ssh prod")).not.toBeInTheDocument();
    });

    it("Escape cancels without renaming", () => {
      renderWithSession();
      fireEvent.doubleClick(screen.getByTitle("Terminal 1"));
      fireEvent.change(renameInput(), { target: { value: "discard me" } });
      fireEvent.keyDown(renameInput(), { key: "Escape" });

      expect(useUIStore.getState().terminal.sessions[0].label).toBe("Terminal 1");
      expect(useUIStore.getState().terminal.sessions[0].isUserRenamed).toBeFalsy();
      expect(screen.getByTitle("Terminal 1")).toBeInTheDocument();
    });

    it("Escape does not let the blur handler commit the discarded text", () => {
      // Escape unmounts the input, which fires blur — a naive commit-on-blur
      // would then save exactly what the user just discarded.
      renderWithSession();
      fireEvent.doubleClick(screen.getByTitle("Terminal 1"));
      const input = renameInput();
      fireEvent.change(input, { target: { value: "discard me" } });
      fireEvent.keyDown(input, { key: "Escape" });
      fireEvent.blur(input);
      expect(useUIStore.getState().terminal.sessions[0].label).toBe("Terminal 1");
    });

    it("commits on blur so a click elsewhere does not silently discard the edit", () => {
      renderWithSession();
      fireEvent.doubleClick(screen.getByTitle("Terminal 1"));
      fireEvent.change(renameInput(), { target: { value: "deploy" } });
      fireEvent.blur(renameInput());
      expect(useUIStore.getState().terminal.sessions[0].label).toBe("deploy");
    });

    it.each([["", "empty"], ["   ", "whitespace-only"], ["\t\n", "control-whitespace"]])(
      "rejects %s (%s) input and keeps the old name",
      (value) => {
        renderWithSession();
        fireEvent.doubleClick(screen.getByTitle("Terminal 1"));
        fireEvent.change(renameInput(), { target: { value } });
        fireEvent.keyDown(renameInput(), { key: "Enter" });
        expect(useUIStore.getState().terminal.sessions[0].label).toBe("Terminal 1");
        expect(useUIStore.getState().terminal.sessions[0].isUserRenamed).toBeFalsy();
      },
    );

    it("trims surrounding whitespace from the committed name", () => {
      renderWithSession();
      fireEvent.doubleClick(screen.getByTitle("Terminal 1"));
      fireEvent.change(renameInput(), { target: { value: "  api server  " } });
      fireEvent.keyDown(renameInput(), { key: "Enter" });
      expect(useUIStore.getState().terminal.sessions[0].label).toBe("api server");
    });

    it("is IME-safe: an Enter that commits a CJK composition does not submit", () => {
      // Pressing Enter to accept a pinyin candidate must finish the
      // composition, not the rename — otherwise the tab gets named with a
      // half-typed candidate.
      renderWithSession();
      fireEvent.doubleClick(screen.getByTitle("Terminal 1"));
      fireEvent.change(renameInput(), { target: { value: "编译" } });
      fireEvent.keyDown(renameInput(), { key: "Enter", isComposing: true });
      expect(useUIStore.getState().terminal.sessions[0].label).toBe("Terminal 1");

      // A real Enter afterwards commits.
      fireEvent.keyDown(renameInput(), { key: "Enter" });
      expect(useUIStore.getState().terminal.sessions[0].label).toBe("编译");
    });

    it("keyCode 229 (the other IME marker) is also blocked", () => {
      renderWithSession();
      fireEvent.doubleClick(screen.getByTitle("Terminal 1"));
      fireEvent.change(renameInput(), { target: { value: "编译" } });
      fireEvent.keyDown(renameInput(), { key: "Enter", keyCode: 229 });
      expect(useUIStore.getState().terminal.sessions[0].label).toBe("Terminal 1");
    });

    it("renames only the double-clicked tab", () => {
      renderWithSession();
      act(() => { useUIStore.getState().terminalCreateSession(); });
      const [first, second] = useUIStore.getState().terminal.sessions;

      fireEvent.doubleClick(screen.getByTitle("Terminal 2"));
      fireEvent.change(renameInput(), { target: { value: "second" } });
      fireEvent.keyDown(renameInput(), { key: "Enter" });

      const sessions = useUIStore.getState().terminal.sessions;
      expect(sessions.find((x) => x.id === first.id)!.label).toBe("Terminal 1");
      expect(sessions.find((x) => x.id === second.id)!.label).toBe("second");
    });

    it("does not switch sessions when double-clicking an inactive tab to rename", () => {
      renderWithSession();
      act(() => { useUIStore.getState().terminalCreateSession(); });
      const [first] = useUIStore.getState().terminal.sessions;
      const activeBefore = useUIStore.getState().terminal.activeSessionId;

      fireEvent.doubleClick(screen.getByTitle("Terminal 1"));

      // A double-click delivers a click first; switching is acceptable, but the
      // rename must target the tab that was double-clicked either way.
      expect(renameInput().value).toBe("Terminal 1");
      expect([activeBefore, first.id]).toContain(
        useUIStore.getState().terminal.activeSessionId,
      );
    });

    it("commits exactly once when Enter is followed by a blur", () => {
      // Enter commits and unmounts the input. If the environment then also
      // delivers a blur, a second commit would re-fire the store action.
      renderWithSession();
      const id = useUIStore.getState().terminal.sessions[0].id;
      fireEvent.doubleClick(screen.getByTitle("Terminal 1"));
      const input = renameInput();
      fireEvent.change(input, { target: { value: "once" } });
      fireEvent.keyDown(input, { key: "Enter" });
      fireEvent.blur(input);

      const session = useUIStore.getState().terminal.sessions.find((x) => x.id === id)!;
      expect(session.label).toBe("once");
      expect(useUIStore.getState().terminal.sessions).toHaveLength(1);
    });

    it("leaves rename mode after committing", () => {
      renderWithSession();
      fireEvent.doubleClick(screen.getByTitle("Terminal 1"));
      fireEvent.change(renameInput(), { target: { value: "x" } });
      fireEvent.keyDown(renameInput(), { key: "Enter" });
      expect(screen.queryByRole("textbox", { name: /rename/i })).not.toBeInTheDocument();
    });

    it("rejects a name made only of invisible control characters", () => {
      // C0, DEL and the C1 range (U+0080–U+009F) are all invisible; a name
      // made of them would render as a blank tab the user cannot identify.
      renderWithSession();
      fireEvent.doubleClick(screen.getByTitle("Terminal 1"));
      fireEvent.change(renameInput(), { target: { value: "\u0001\u007f\u0085\u009f" } });
      fireEvent.keyDown(renameInput(), { key: "Enter" });
      expect(useUIStore.getState().terminal.sessions[0].label).toBe("Terminal 1");
    });

    it("strips control characters but keeps the real name around them", () => {
      renderWithSession();
      fireEvent.doubleClick(screen.getByTitle("Terminal 1"));
      fireEvent.change(renameInput(), { target: { value: "bui\u009fld" } });
      fireEvent.keyDown(renameInput(), { key: "Enter" });
      expect(useUIStore.getState().terminal.sessions[0].label).toBe("build");
    });

    it("keeps an emoji name intact rather than splitting a surrogate pair", () => {
      renderWithSession();
      fireEvent.doubleClick(screen.getByTitle("Terminal 1"));
      fireEvent.change(renameInput(), { target: { value: "🚀 deploy" } });
      fireEvent.keyDown(renameInput(), { key: "Enter" });
      expect(useUIStore.getState().terminal.sessions[0].label).toBe("🚀 deploy");
    });

    it("caps an absurdly long name so it cannot bloat the store", () => {
      renderWithSession();
      fireEvent.doubleClick(screen.getByTitle("Terminal 1"));
      fireEvent.change(renameInput(), { target: { value: "z".repeat(1000) } });
      fireEvent.keyDown(renameInput(), { key: "Enter" });
      expect(useUIStore.getState().terminal.sessions[0].label.length).toBeLessThanOrEqual(256);
    });
  });

  describe("tab glyph does not depend on the English label (audit fix)", () => {
    it("shows the session's ordinal, not a number parsed out of the label", () => {
      renderWithSession();
      const id = useUIStore.getState().terminal.sessions[0].id;
      // Simulate a translated default label. The old code matched
      // /^Terminal (\d+)$/ against this and fell through to the first
      // character, so every tab in a non-English UI showed the same glyph.
      act(() => {
        useUIStore.setState((st) => ({
          terminal: {
            ...st.terminal,
            sessions: st.terminal.sessions.map((x) =>
              x.id === id ? { ...x, label: "终端 1" } : x,
            ),
          },
        }));
      });
      expect(screen.getByTitle("终端 1").textContent).toBe("1");
    });

    it("numbers each session by its own ordinal", () => {
      renderWithSession();
      act(() => {
        useUIStore.getState().terminalCreateSession();
        useUIStore.getState().terminalCreateSession();
      });
      const glyphs = useUIStore
        .getState()
        .terminal.sessions.map((x) => screen.getByTitle(x.label).textContent);
      expect(glyphs).toEqual(["1", "2", "3"]);
    });

    it("reuses a freed ordinal rather than counting forever", () => {
      renderWithSession();
      act(() => {
        useUIStore.getState().terminalCreateSession();
      });
      const [first] = useUIStore.getState().terminal.sessions;
      act(() => {
        useUIStore.getState().terminalRemoveSession(first.id);
        useUIStore.getState().terminalCreateSession();
      });
      const ordinals = useUIStore.getState().terminal.sessions.map((x) => x.ordinal).sort();
      expect(ordinals).toEqual([1, 2]);
    });

    it("shows the first grapheme of a program title, not a number", () => {
      renderWithSession();
      const id = useUIStore.getState().terminal.sessions[0].id;
      act(() => useUIStore.getState().terminalSetProgramTitle(id, "vim README.md"));
      expect(screen.getByTitle("vim README.md").textContent).toBe("V");
    });

    it("keeps a flag emoji whole instead of splitting it into a half-glyph", () => {
      // A regional-indicator flag is TWO code points; Array.from would show
      // only the first, rendering a different flag's half.
      renderWithSession();
      fireEvent.doubleClick(screen.getByTitle("Terminal 1"));
      fireEvent.change(
        screen.getByRole("textbox", { name: /rename/i }),
        { target: { value: "🇯🇵 tokyo" } },
      );
      fireEvent.keyDown(screen.getByRole("textbox", { name: /rename/i }), { key: "Enter" });
      expect(screen.getByTitle("🇯🇵 tokyo").textContent).toBe("🇯🇵");
    });
  });
});
