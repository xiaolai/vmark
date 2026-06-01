import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TerminalSettings } from "./TerminalSettings";

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
