// Audit 20260907 (#425): the capture modal received the shortcut's EXISTING
// binding as its conflict, not the chord the user just pressed — so pressing a
// chord another shortcut already owns showed no warning (or a stale one), and
// "Assign" silently created a collision.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("@/services/dialogs/confirmAction", () => ({ confirmAction: vi.fn() }));

import { ShortcutsSettings } from "./ShortcutsSettings";
import { useShortcutsStore } from "@/stores/settingsStore";

function rowFor(label: string): HTMLElement {
  const row = screen.getByText(label).closest("div.flex.items-center.justify-between");
  if (!(row instanceof HTMLElement)) throw new Error(`no row for ${label}`);
  return row;
}

beforeEach(() => {
  useShortcutsStore.setState({ customBindings: {} });
});

describe("clearing a binding from the pane", () => {
  it("Remove Shortcut unassigns the row's chord", () => {
    render(<ShortcutsSettings />);
    fireEvent.click(within(rowFor("Bold")).getByTitle("Click to change"));
    fireEvent.click(screen.getByRole("button", { name: "Remove Shortcut" }));

    expect(useShortcutsStore.getState().getShortcut("bold")).toBe("");
    expect(screen.queryByText("Set Shortcut")).toBeNull();
    expect(within(rowFor("Bold")).getByText("Unassigned")).toBeInTheDocument();
  });

  it("offers no Remove Shortcut for a row that is already unassigned", () => {
    useShortcutsStore.getState().setShortcut("bold", "");
    render(<ShortcutsSettings />);
    fireEvent.click(within(rowFor("Bold")).getByTitle("Click to change"));
    expect(screen.queryByRole("button", { name: "Remove Shortcut" })).toBeNull();
  });
});

describe("conflict warning follows the captured chord (#425)", () => {
  it("warns with the OTHER shortcut's name when the pressed chord is already bound to it", () => {
    render(<ShortcutsSettings />);
    fireEvent.click(within(rowFor("Bold")).getByTitle("Click to change"));
    expect(screen.getByText("Set Shortcut")).toBeInTheDocument();
    // Italic's default is Mod-i; press exactly that while capturing for Bold.
    expect(useShortcutsStore.getState().getShortcut("italic")).toBe("Mod-i");
    fireEvent.keyDown(window, { key: "i", code: "KeyI", metaKey: true });

    expect(screen.getByText(/already used by/i)).toBeInTheDocument();
    expect(screen.getByText("Italic", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reassign" })).toBeInTheDocument();
    expect(screen.getByText(/leaves it unassigned/i)).toBeInTheDocument();
  });

  it("Reassign moves the chord: the previous owner is left unassigned, not sharing it", () => {
    render(<ShortcutsSettings />);
    fireEvent.click(within(rowFor("Bold")).getByTitle("Click to change"));
    fireEvent.keyDown(window, { key: "i", code: "KeyI", metaKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Reassign" }));

    const store = useShortcutsStore.getState();
    expect(store.getShortcut("bold")).toBe("Mod-i");
    expect(store.getShortcut("italic")).toBe("");
    expect(within(rowFor("Italic")).getByText("Unassigned")).toBeInTheDocument();
  });

  it("shows no conflict for a chord nobody owns, even when the shortcut's OLD key collided", () => {
    // Bold currently sits on Italic's chord (a collision the user made earlier).
    useShortcutsStore.getState().setShortcut("bold", "Mod-i");
    render(<ShortcutsSettings />);
    fireEvent.click(within(rowFor("Bold")).getByTitle("Click to change"));
    fireEvent.keyDown(window, { key: "9", code: "Digit9", metaKey: true, altKey: true, shiftKey: true });

    expect(screen.queryByText(/already used by/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Assign" })).toBeInTheDocument();
  });
});
