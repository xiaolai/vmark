// WI-S0.7 — the palette dispatches with the INVOKING window's label; without it a
//           window-scoped command (browser.newTab) always acted on "main".
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
  searchCommands: (...args: unknown[]) => mockSearchCommands(...args),
  resolveLocalizedString: (v: unknown) =>
    typeof v === "function" ? (v as () => string)() : String(v),
}));

// A sentinel resolved context so we can prove the palette supplies it (WI-2.1).
// The resolver echoes the invoking window label so tests can drive a
// context change (windowLabel is already "main", so this deep-equals SENTINEL_CTX
// for the default case the WI-S0.7 test asserts on).
const SENTINEL_CTX = { windowLabel: "main", mode: "wysiwyg", isDocument: true } as const;
vi.mock("@/services/commands/commandContext", () => ({
  resolveCommandContext: (windowLabel: string) => ({ ...SENTINEL_CTX, windowLabel }),
}));

vi.mock("@/utils/imeGuard", () => ({
  isImeKeyEvent: vi.fn(() => false),
}));

// Mutable window label so a test can simulate the invoking window changing
// (which recomputes the ranked results under an unchanged query).
const windowLabelRef = vi.hoisted(() => ({ current: "main" }));
vi.mock("@/contexts/WindowContext", () => ({
  useWindowLabel: () => windowLabelRef.current,
  useIsDocumentWindow: () => true,
}));

import { CommandPalette } from "./CommandPalette";
import { useCommandPaletteStore } from "./commandPaletteStore";

function makeCommand(id: string, title: string): RankedCommand {
  return { command: { id, title, run: vi.fn() }, score: 1 };
}

function makeCategorized(id: string, title: string, category: string): RankedCommand {
  return { command: { id, title, category, run: vi.fn() }, score: 1 };
}

beforeEach(() => {
  vi.clearAllMocks();
  windowLabelRef.current = "main";
  mockSearchCommands.mockImplementation(() => mockRanked);
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

    // Context carries the invoking window (WI-S0.7): without it a window-scoped
    // command like `browser.newTab` falls back to "main" and acts on the wrong window.
    // The palette supplies the full resolved command context (WI-2.1) — the
    // exact object from resolveCommandContext, not just { windowLabel }.
    expect(mockExecuteCommand).toHaveBeenCalledWith("cmd.two", null, SENTINEL_CTX);
    // And search was performed with that same resolved context.
    expect(mockSearchCommands).toHaveBeenCalledWith(expect.any(String), SENTINEL_CTX);
    expect(useCommandPaletteStore.getState().isOpen).toBe(false);
  });
});

// WI-4.2 / WI-4.3 — browse-mode grouping into localized labelled sections, and
// the active row scrolling into view on keyboard navigation.
describe("CommandPalette — grouping + a11y (Phase 4)", () => {
  it("browse mode renders labelled groups with LOCALIZED category headers (not raw ids)", () => {
    mockRanked = [
      makeCategorized("view.a", "Toggle Source Mode", "view"),
      makeCategorized("editor.bold", "Bold", "formatting"),
      makeCategorized("editor.italic", "Italic", "formatting"),
    ];
    useCommandPaletteStore.setState({ isOpen: true });
    render(<CommandPalette />);

    const groups = screen.getAllByRole("group");
    const labels = groups.map((g) => g.getAttribute("aria-label"));
    // Localized labels from en/commands.json category.* — never the raw ids.
    expect(labels).toEqual(["View", "Formatting"]);
    expect(labels).not.toContain("view");
    expect(labels).not.toContain("formatting");

    // Options remain flat-indexed in visual order (view first per curated order).
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.id)).toEqual([
      "command-palette-item-0",
      "command-palette-item-1",
      "command-palette-item-2",
    ]);
    expect(options[0]).toHaveTextContent("Toggle Source Mode");
  });

  it("search mode (non-empty query) renders a flat list with NO group wrappers", () => {
    mockRanked = [
      makeCategorized("view.a", "Toggle Source Mode", "view"),
      makeCategorized("editor.bold", "Bold", "formatting"),
    ];
    useCommandPaletteStore.setState({ isOpen: true });
    render(<CommandPalette />);
    const input = screen.getByRole("combobox");

    // Typing switches to search mode → flat ranked list, no sections.
    fireEvent.change(input, { target: { value: "bo" } });
    expect(screen.queryAllByRole("group")).toHaveLength(0);
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("clamps the caret when same-query results shrink under a context change (round 2)", async () => {
    // 3 rows in window "main", 1 row in "w2" — the query stays empty throughout.
    mockSearchCommands.mockImplementation(
      (_q: string, ctx: { windowLabel: string }) =>
        ctx.windowLabel === "main"
          ? [
              makeCommand("a", "Alpha"),
              makeCommand("b", "Beta"),
              makeCommand("c", "Gamma"),
            ]
          : [makeCommand("a", "Alpha")],
    );
    useCommandPaletteStore.setState({ isOpen: true });
    const { rerender } = render(<CommandPalette />);
    const input = screen.getByRole("combobox");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" }); // caret → last of 3
    expect(input).toHaveAttribute("aria-activedescendant", "command-palette-item-2");

    // Invoking window changes → ranked recomputes to a single row, SAME query.
    windowLabelRef.current = "w2";
    rerender(<CommandPalette />);

    expect(screen.getAllByRole("option")).toHaveLength(1);
    // Caret clamped back into range; aria points at the surviving row, not a ghost.
    expect(input).toHaveAttribute("aria-activedescendant", "command-palette-item-0");

    // Enter runs the surviving command, not a stranded/undefined one.
    fireEvent.keyDown(input, { key: "Enter" });
    await Promise.resolve();
    expect(mockExecuteCommand).toHaveBeenCalledWith(
      "a",
      null,
      expect.objectContaining({ windowLabel: "w2" }),
    );
  });

  it("scrolls the active row into view on ArrowDown (WI-4.3)", () => {
    const scrollSpy = vi.fn();
    // jsdom has no scrollIntoView — install a spy on the prototype.
    Element.prototype.scrollIntoView = scrollSpy;
    mockRanked = [
      makeCategorized("view.a", "A", "view"),
      makeCategorized("view.b", "B", "view"),
    ];
    useCommandPaletteStore.setState({ isOpen: true });
    render(<CommandPalette />);
    const input = screen.getByRole("combobox");

    scrollSpy.mockClear(); // ignore the mount-time scroll of item 0
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(scrollSpy).toHaveBeenCalledWith({ block: "nearest" });
  });
});

// WI-S0.7 — the palette ran commands with NO context, so `browser.newTab` fell back to
// `ctx.windowLabel ?? "main"` and always opened its tab in the MAIN window — wrong when
// the palette is invoked from a second document window.
describe("CommandPalette — window context (WI-S0.7)", () => {
  it("dispatches the picked command with the invoking window's label", () => {
    useCommandPaletteStore.setState({ isOpen: true });
    render(<CommandPalette />);
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(mockExecuteCommand).toHaveBeenCalledWith(
      expect.any(String),
      null,
      expect.objectContaining({ windowLabel: expect.any(String) }),
    );
  });
});
