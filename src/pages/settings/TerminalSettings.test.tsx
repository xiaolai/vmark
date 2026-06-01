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
