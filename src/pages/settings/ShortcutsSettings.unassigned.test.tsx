// WI-FL3.13 — an UNBOUND shortcut stays in the Shortcuts pane as "Unassigned"
// and can be bound from there. The pane used to filter out every definition
// whose effective key was "", so a shortcut that ships unbound (D12's
// reopenClosedTab, graphvizDiagram, …) or that the user had cleared could never
// be given a key again without a JSON import.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("@/services/dialogs/confirmAction", () => ({ confirmAction: vi.fn() }));

import { ShortcutsSettings } from "./ShortcutsSettings";
import { useShortcutsStore, DEFAULT_SHORTCUTS } from "@/stores/settingsStore";

/** The row (label + key button) for a shortcut, found by its English label. */
function rowFor(label: string): HTMLElement {
  const labelEl = screen.getByText(label);
  const row = labelEl.closest("div.flex.items-center.justify-between");
  if (!(row instanceof HTMLElement)) throw new Error(`no row for ${label}`);
  return row;
}

beforeEach(() => {
  useShortcutsStore.setState({ customBindings: {} });
});

describe("unbound shortcuts in the Shortcuts pane (WI-FL3.13)", () => {
  it("ships at least one definition with an empty default (the case under test)", () => {
    expect(DEFAULT_SHORTCUTS.some((s) => s.defaultKey === "")).toBe(true);
  });

  it("renders a definition whose default is empty as Unassigned instead of hiding it", () => {
    render(<ShortcutsSettings />);
    // graphvizDiagram ships with defaultKey "" and a menuId.
    const row = rowFor("Insert Graphviz Diagram");
    expect(within(row).getByRole("button", { name: /unassigned/i })).toBeInTheDocument();
  });

  it("keeps a shortcut the user cleared visible as Unassigned, with its reset affordance", () => {
    useShortcutsStore.getState().setShortcut("bold", "");
    render(<ShortcutsSettings />);
    const row = rowFor("Bold");
    expect(within(row).getByRole("button", { name: /unassigned/i })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Reset to default" })).toBeInTheDocument();
  });

  it("lets an unbound shortcut be bound: click Unassigned, press a chord, Assign", () => {
    render(<ShortcutsSettings />);
    fireEvent.click(within(rowFor("Insert Graphviz Diagram")).getByRole("button", { name: /unassigned/i }));
    expect(screen.getByText("Set Shortcut")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "g", metaKey: true, altKey: true, shiftKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));

    expect(useShortcutsStore.getState().getShortcut("graphvizDiagram")).toBe("Mod-Alt-Shift-g");
    // The row now shows the chord, not the Unassigned state.
    const row = rowFor("Insert Graphviz Diagram");
    expect(within(row).queryByRole("button", { name: /unassigned/i })).toBeNull();
  });

  it("finds unbound rows when searching for the Unassigned state", () => {
    render(<ShortcutsSettings />);
    fireEvent.change(screen.getByPlaceholderText("Search shortcuts…"), {
      target: { value: "unassigned" },
    });
    expect(screen.getByText("Insert Graphviz Diagram")).toBeInTheDocument();
    expect(screen.queryByText("Bold")).toBeNull();
  });
});
