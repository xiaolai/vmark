// The rail context menu's items carry a stable, locale-independent
// `data-menu-action` — the e2e rail helper closes a workspace by it instead of
// by position or translated label (audit-fix 2026-09-07, finding #5).
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspaceRailContextMenu } from "./WorkspaceRailContextMenu";

function renderMenu(overrides: Partial<React.ComponentProps<typeof WorkspaceRailContextMenu>> = {}) {
  const props = {
    position: { x: 10, y: 10 },
    workspaceName: "foo",
    invoker: null,
    onClose: vi.fn(),
    onCloseWorkspace: vi.fn(),
    onDuplicate: vi.fn(),
    onMoveToNewWindow: vi.fn(),
    ...overrides,
  };
  const view = render(<WorkspaceRailContextMenu {...props} />);
  return { ...props, view };
}

describe("WorkspaceRailContextMenu action hooks", () => {
  it("names every item by a stable action, independent of label and order", () => {
    renderMenu();
    const actions = screen.getAllByRole("menuitem").map((el) => el.getAttribute("data-menu-action"));
    expect(actions).toEqual(["close", "duplicate", "move-to-new-window"]);
  });

  it("the close hook runs the close handler", async () => {
    const props = renderMenu();
    await userEvent.setup().click(screen.getAllByRole("menuitem").find((el) => el.getAttribute("data-menu-action") === "close")!);
    expect(props.onCloseWorkspace).toHaveBeenCalledTimes(1);
    expect(props.onDuplicate).not.toHaveBeenCalled();
  });
});

// Audit R3 #655/#657/#658/#659 — everything that only misbehaves on the SECOND
// opening, or from the keyboard.
describe("WorkspaceRailContextMenu — reopening and keyboard exits", () => {
  it("returns focus to the invoker the parent named, not to whatever had focus", async () => {
    // A right-click does not focus its target in every engine, so capturing
    // `document.activeElement` on mount routinely captured <body>.
    const invoker = document.createElement("button");
    document.body.appendChild(invoker);
    const props = renderMenu({ invoker });
    await userEvent.setup().keyboard("{Escape}");
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(invoker);
    invoker.remove();
  });

  it("does not focus an invoker that has left the document", async () => {
    const invoker = document.createElement("button");
    document.body.appendChild(invoker);
    renderMenu({ invoker });
    invoker.remove();
    await userEvent.setup().keyboard("{Escape}");
    expect(document.activeElement).not.toBe(invoker);
  });

  it("re-focuses the first item when the menu is REOPENED on another entry", async () => {
    // The menu is rendered conditionally without a key, so this is a re-render
    // of the same component, not a remount. A mount-only focus effect left the
    // keyboard on whichever item the previous opening had reached.
    const first = { position: { x: 10, y: 10 }, workspaceName: "a" };
    const { view, ...props } = renderMenu(first);
    await userEvent.setup().keyboard("{ArrowDown}");
    expect(document.activeElement).toHaveAttribute("data-menu-action", "duplicate");

    view.rerender(
      <WorkspaceRailContextMenu
        {...props}
        position={{ x: 40, y: 40 }}
        workspaceName="b"
      />,
    );
    expect(document.activeElement).toHaveAttribute("data-menu-action", "close");
  });

  it("dismisses on Tab instead of letting focus walk out of an open menu", async () => {
    const invoker = document.createElement("button");
    document.body.appendChild(invoker);
    const props = renderMenu({ invoker });
    await userEvent.setup().keyboard("{Tab}");
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(invoker);
    invoker.remove();
  });

  it("catches an action that rejects, rather than leaving an unhandled rejection", async () => {
    // `() => void` accepts an async function, so the type cannot forbid this.
    const onCloseWorkspace = vi.fn(() => Promise.reject(new Error("boom")));
    renderMenu({ onCloseWorkspace });
    const closeItem = screen
      .getAllByRole("menuitem")
      .find((el) => el.getAttribute("data-menu-action") === "close")!;
    await userEvent.setup().click(closeItem);
    await Promise.resolve();
    expect(onCloseWorkspace).toHaveBeenCalledTimes(1);
  });

  it("keys items by their stable action, so a locale change does not remount them", () => {
    const { view, ...props } = renderMenu();
    const before = screen.getAllByRole("menuitem");
    view.rerender(<WorkspaceRailContextMenu {...props} workspaceName="renamed" />);
    const after = screen.getAllByRole("menuitem");
    // Same DOM nodes: a label-based key would have replaced every one of them
    // the moment the translated labels changed, dropping keyboard focus.
    expect(after).toEqual(before);
  });
});
