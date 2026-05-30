/**
 * CommandPalette tests — a11y (WI-4.7, A3) + behavior.
 *
 * Covers: dialog/aria-modal semantics, combobox + aria-activedescendant
 * wiring updated by arrow navigation, focus restoration to the
 * previously-focused element on close, and command execution.
 */

import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RankedCommand } from "@/services/commands";

// Controllable ranked-command list returned by searchCommands.
let mockRanked: RankedCommand[] = [];
const mockExecuteCommand = vi.fn(async () => {});
const mockSearchCommands = vi.fn(() => mockRanked);

vi.mock("@/services/commands", () => ({
  executeCommand: (...args: unknown[]) => mockExecuteCommand(...args),
  searchCommands: () => mockSearchCommands(),
  resolveLocalizedString: (v: unknown) =>
    typeof v === "function" ? (v as () => string)() : String(v),
}));

vi.mock("@/utils/imeGuard", () => ({
  isImeKeyEvent: vi.fn(() => false),
}));

import { CommandPalette } from "./CommandPalette";
import { useCommandPaletteStore } from "./commandPaletteStore";

function makeCommand(id: string, title: string): RankedCommand {
  return { command: { id, title, run: vi.fn() }, score: 1 };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRanked = [
    makeCommand("cmd.one", "Command One"),
    makeCommand("cmd.two", "Command Two"),
    makeCommand("cmd.three", "Command Three"),
  ];
  useCommandPaletteStore.setState({ isOpen: false });
});

afterEach(() => {
  cleanup();
});

describe("CommandPalette", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<CommandPalette />);
    expect(container.firstChild).toBeNull();
  });

  it("exposes a modal dialog (role=dialog, aria-modal=true)", () => {
    useCommandPaletteStore.setState({ isOpen: true });
    render(<CommandPalette />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("exposes combobox semantics on the input", () => {
    useCommandPaletteStore.setState({ isOpen: true });
    render(<CommandPalette />);
    const input = screen.getByRole("combobox");
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-controls", "command-palette-list");
    // Initial active option is the first row.
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      "command-palette-item-0",
    );
    // The active option's id matches.
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("id", "command-palette-item-0");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
  });

  it("aria-activedescendant updates with ArrowDown navigation", () => {
    useCommandPaletteStore.setState({ isOpen: true });
    render(<CommandPalette />);
    const input = screen.getByRole("combobox");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      "command-palette-item-1",
    );

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      "command-palette-item-2",
    );

    // ArrowUp moves back.
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      "command-palette-item-1",
    );
  });

  it("collapses combobox and drops activedescendant when no results", () => {
    mockRanked = [];
    useCommandPaletteStore.setState({ isOpen: true });
    render(<CommandPalette />);
    const input = screen.getByRole("combobox");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).not.toHaveAttribute("aria-activedescendant");
  });

  it("restores focus to the previously-focused element on close", () => {
    // An element focused before the palette opens.
    const trigger = document.createElement("button");
    trigger.textContent = "trigger";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { rerender } = render(<CommandPalette />);

    // Open: focus moves into the palette input.
    act(() => {
      useCommandPaletteStore.setState({ isOpen: true });
    });
    rerender(<CommandPalette />);

    // Close: focus should return to the trigger.
    act(() => {
      useCommandPaletteStore.setState({ isOpen: false });
    });
    rerender(<CommandPalette />);

    expect(document.activeElement).toBe(trigger);
    document.body.removeChild(trigger);
  });

  it("Escape closes the palette", () => {
    useCommandPaletteStore.setState({ isOpen: true });
    render(<CommandPalette />);
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(useCommandPaletteStore.getState().isOpen).toBe(false);
  });

  it("Enter executes the selected command and closes", async () => {
    useCommandPaletteStore.setState({ isOpen: true });
    render(<CommandPalette />);
    const input = screen.getByRole("combobox");

    fireEvent.keyDown(input, { key: "ArrowDown" }); // select index 1
    fireEvent.keyDown(input, { key: "Enter" });

    // Flush the microtask in runCommand.
    await Promise.resolve();

    expect(mockExecuteCommand).toHaveBeenCalledWith("cmd.two");
    expect(useCommandPaletteStore.getState().isOpen).toBe(false);
  });
});
