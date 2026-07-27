import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TerminalSettings } from "./TerminalSettings";
import { useSettingsStore } from "@/stores/settingsStore";

// list_available_shells / get_default_shell are invoked on mount.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    if (cmd === "list_available_shells") return Promise.resolve([]);
    if (cmd === "get_default_shell") return Promise.resolve("/bin/zsh");
    return Promise.resolve(null);
  },
}));

function setPlatform(value: string) {
  Object.defineProperty(navigator, "platform", { value, configurable: true });
}

const original = navigator.platform;
afterEach(() => setPlatform(original));

describe("TerminalSettings platform gating (D1)", () => {
  it("shows macOptionIsMeta and shellIntegration on macOS", () => {
    setPlatform("MacIntel");
    render(<TerminalSettings />);
    expect(screen.getByText("Option as Meta Key")).toBeInTheDocument();
    expect(screen.getByText("Shell Integration")).toBeInTheDocument();
  });

  it("hides macOptionIsMeta but keeps shellIntegration on Linux", () => {
    setPlatform("Linux x86_64");
    render(<TerminalSettings />);
    expect(screen.queryByText("Option as Meta Key")).not.toBeInTheDocument();
    expect(screen.getByText("Shell Integration")).toBeInTheDocument();
  });

  it("hides both macOptionIsMeta and shellIntegration on Windows", () => {
    setPlatform("Win32");
    render(<TerminalSettings />);
    expect(screen.queryByText("Option as Meta Key")).not.toBeInTheDocument();
    expect(screen.queryByText("Shell Integration")).not.toBeInTheDocument();
  });
});

describe("TerminalSettings accessibility controls (WI-11)", () => {
  afterEach(() => setPlatform(original));

  beforeEach(() => {
    // Ensure a known terminal baseline for the accessibility-control assertions.
    useSettingsStore.setState({
      terminal: {
        ...useSettingsStore.getState().terminal,
        bellMode: "visual",
        minimumContrastRatio: 4.5,
      },
    });
  });

  it("renders bell mode and minimum contrast controls", () => {
    render(<TerminalSettings />);
    expect(screen.getByText("Terminal bell")).toBeInTheDocument();
    expect(screen.getByText("Minimum contrast")).toBeInTheDocument();
  });

  it("changing bell mode updates the store", () => {
    render(<TerminalSettings />);
    const select = screen.getByDisplayValue("Visual (background activity)");
    fireEvent.change(select, { target: { value: "audible" } });
    expect(useSettingsStore.getState().terminal.bellMode).toBe("audible");
  });

  it("changing minimum contrast updates the store", () => {
    render(<TerminalSettings />);
    const select = screen.getByDisplayValue("WCAG AA (4.5:1)");
    fireEvent.change(select, { target: { value: "7" } });
    expect(useSettingsStore.getState().terminal.minimumContrastRatio).toBe(7);
  });

  it("exercises every toggle and select without throwing", () => {
    setPlatform("MacIntel");
    render(<TerminalSettings />);
    expect(() => {
      screen.getAllByRole("switch").forEach((s) => fireEvent.click(s));
      document.querySelectorAll("select").forEach((sel) => {
        const opts = sel.querySelectorAll("option");
        if (opts.length) {
          fireEvent.change(sel, { target: { value: opts[opts.length - 1].value } });
        }
      });
    }).not.toThrow();
  });
});

describe("TerminalSettings font size (WI-1.3)", () => {
  /** The <select> whose options are px labels. */
  function fontSizeSelect(): HTMLSelectElement {
    const select = Array.from(document.querySelectorAll("select")).find((s) =>
      Array.from(s.options).some((o) => /^\d+(\.\d+)?px$/.test(o.textContent ?? "")),
    );
    if (!select) throw new Error("font-size select not found");
    return select;
  }

  function setFontSize(fontSize: number) {
    useSettingsStore.setState({
      terminal: { ...useSettingsStore.getState().terminal, fontSize },
    });
  }

  afterEach(() => setFontSize(13));

  it("shows a zoomed font size not in the preset list", () => {
    // `Mod +` steps by 2 from the default 13 → 15, which is absent from the
    // presets. A native <select> with an unmatched value falls back to its
    // FIRST option ("10px"), and the next interaction writes 10 — silently
    // discarding the zoom.
    setFontSize(15);
    render(<TerminalSettings />);
    const select = fontSizeSelect();
    expect(select.value).toBe("15");
    expect(
      Array.from(select.options).map((o) => o.textContent),
    ).toContain("15px");
  });

  it("does not duplicate a preset value", () => {
    setFontSize(14);
    render(<TerminalSettings />);
    const values = Array.from(fontSizeSelect().options).map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values.filter((v) => v === "14")).toHaveLength(1);
  });

  it("renders both clamp edges (8 and 32) rather than falling back to 10px", () => {
    setFontSize(8);
    const { unmount } = render(<TerminalSettings />);
    expect(fontSizeSelect().value).toBe("8");
    unmount();

    setFontSize(32);
    render(<TerminalSettings />);
    expect(fontSizeSelect().value).toBe("32");
  });
});

describe("TerminalSettings panel size (WI-1.2)", () => {
  /** The <select> whose options are whole-percent labels. */
  function panelSizeSelect(): HTMLSelectElement {
    const select = Array.from(document.querySelectorAll("select")).find((s) =>
      Array.from(s.options).every((o) => /^\d+%$/.test(o.textContent ?? "")),
    );
    if (!select) throw new Error("panel-size select not found");
    return select;
  }

  afterEach(() => {
    useSettingsStore.setState({
      terminal: { ...useSettingsStore.getState().terminal, panelRatio: 0.4 },
    });
  });

  it("offers nothing above 50%", () => {
    render(<TerminalSettings />);
    const labels = Array.from(panelSizeSelect().options).map((o) => o.textContent);
    expect(labels).not.toContain("60%");
    expect(labels).not.toContain("70%");
    expect(labels).not.toContain("80%");
    expect(labels).toContain("50%");
  });

  it("displays a legacy over-cap ratio as the cap, not as the stored number", () => {
    useSettingsStore.setState({
      terminal: { ...useSettingsStore.getState().terminal, panelRatio: 0.8 },
    });
    render(<TerminalSettings />);
    // The panel was already rendering at 50%; the dropdown now agrees.
    expect(panelSizeSelect().value).toBe("0.5");
  });
});
