import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ContextMenu, type ContextMenuType } from "./ContextMenu";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "contextMenu.open": "Open",
        "contextMenu.rename": "Rename",
        "contextMenu.duplicate": "Duplicate",
        "contextMenu.moveTo": "Move to...",
        "contextMenu.delete": "Delete",
        "contextMenu.copyPath": "Copy Path",
        "contextMenu.revealInFinder": "Reveal in Finder",
        "contextMenu.showInExplorer": "Show in Explorer",
        "contextMenu.showInFileManager": "Show in File Manager",
        "contextMenu.ariaLabel": "File actions",
        newFile: "New File",
        newFolder: "New Folder",
      };
      return map[key] ?? key;
    },
  }),
}));

function renderMenu(
  type: ContextMenuType = "file",
  onAction = vi.fn(),
  onClose = vi.fn()
) {
  return {
    onAction,
    onClose,
    ...render(
      <ContextMenu
        type={type}
        position={{ x: 100, y: 100 }}
        onAction={onAction}
        onClose={onClose}
      />
    ),
  };
}

describe("ContextMenu ARIA and keyboard", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders with role='menu' and aria-label", () => {
    renderMenu("file");
    const menu = screen.getByRole("menu");
    expect(menu).toBeInTheDocument();
    expect(menu).toHaveAttribute("aria-label", "File actions");
  });

  it("renders items with role='menuitem'", () => {
    renderMenu("file");
    const items = screen.getAllByRole("menuitem");
    expect(items.length).toBe(7); // file menu has 7 items
  });

  it("renders empty menu items with role='menuitem'", () => {
    renderMenu("empty");
    const items = screen.getAllByRole("menuitem");
    expect(items.length).toBe(2);
  });

  it("auto-focuses first item on mount", () => {
    renderMenu("file");
    const items = screen.getAllByRole("menuitem");
    expect(items[0]).toHaveFocus();
  });

  it("navigates down with ArrowDown", async () => {
    const user = userEvent.setup();
    renderMenu("file");
    const items = screen.getAllByRole("menuitem");

    await user.keyboard("{ArrowDown}");
    expect(items[1]).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(items[2]).toHaveFocus();
  });

  it("navigates up with ArrowUp", async () => {
    const user = userEvent.setup();
    renderMenu("file");
    const items = screen.getAllByRole("menuitem");

    // First item is focused, ArrowUp wraps to last
    await user.keyboard("{ArrowUp}");
    expect(items[items.length - 1]).toHaveFocus();
  });

  it("wraps ArrowDown from last to first", async () => {
    const user = userEvent.setup();
    renderMenu("empty"); // 2 items: New File, New Folder
    const items = screen.getAllByRole("menuitem");

    await user.keyboard("{ArrowDown}"); // -> second
    await user.keyboard("{ArrowDown}"); // -> wraps to first
    expect(items[0]).toHaveFocus();
  });

  it("activates item on Enter", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const onClose = vi.fn();
    renderMenu("file", onAction, onClose);

    await user.keyboard("{Enter}");
    expect(onAction).toHaveBeenCalledWith("open");
    expect(onClose).toHaveBeenCalled();
  });

  it("activates item on Space", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const onClose = vi.fn();
    renderMenu("file", onAction, onClose);

    await user.keyboard("{ArrowDown}"); // move to "Rename"
    await user.keyboard(" ");
    expect(onAction).toHaveBeenCalledWith("rename");
  });

  it("closes on Tab", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderMenu("file", vi.fn(), onClose);

    await user.keyboard("{Tab}");
    expect(onClose).toHaveBeenCalled();
  });

  it("jumps to first item on Home", async () => {
    const user = userEvent.setup();
    renderMenu("file");
    const items = screen.getAllByRole("menuitem");

    await user.keyboard("{ArrowDown}{ArrowDown}{Home}");
    expect(items[0]).toHaveFocus();
  });

  it("jumps to last item on End", async () => {
    const user = userEvent.setup();
    renderMenu("file");
    const items = screen.getAllByRole("menuitem");

    await user.keyboard("{End}");
    expect(items[items.length - 1]).toHaveFocus();
  });

  it("uses roving tabindex — focused item has tabIndex 0, others -1", () => {
    renderMenu("file");
    const items = screen.getAllByRole("menuitem");
    expect(items[0]).toHaveAttribute("tabindex", "0");
    for (let i = 1; i < items.length; i++) {
      expect(items[i]).toHaveAttribute("tabindex", "-1");
    }
  });

  it("executes action on click", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const onClose = vi.fn();
    renderMenu("file", onAction, onClose);

    const items = screen.getAllByRole("menuitem");
    await user.click(items[2]); // "Duplicate"
    expect(onAction).toHaveBeenCalledWith("duplicate");
    expect(onClose).toHaveBeenCalled();
  });

  it("renders folder menu items correctly", () => {
    renderMenu("folder");
    const items = screen.getAllByRole("menuitem");
    expect(items.length).toBe(6); // folder menu has 6 items
  });
});
