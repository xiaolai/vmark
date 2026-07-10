import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockIsImeKeyEvent = vi.fn(() => false);
vi.mock("@/utils/imeGuard", () => ({
  isImeKeyEvent: (...args: unknown[]) => mockIsImeKeyEvent(...args),
}));

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
    mockIsImeKeyEvent.mockReturnValue(false);
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

  it("closes on Escape (owned by the roving hook)", () => {
    const onClose = vi.fn();
    renderMenu("file", vi.fn(), onClose);

    // Escape is handled on the menu (focus is seeded inside it on open),
    // not via a document-level listener.
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("does not close on IME key events during Escape handling", () => {
    mockIsImeKeyEvent.mockReturnValue(true);

    const onClose = vi.fn();
    renderMenu("file", vi.fn(), onClose);

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape", isComposing: true });
    expect(onClose).not.toHaveBeenCalled();

    mockIsImeKeyEvent.mockReturnValue(false);
  });

  it("closes on click outside the menu", () => {
    const onClose = vi.fn();
    renderMenu("file", vi.fn(), onClose);

    // mousedown on document body (outside menu) via capture
    const event = new MouseEvent("mousedown", { bubbles: true });
    document.dispatchEvent(event);
    expect(onClose).toHaveBeenCalled();
  });

  it("does not close on click inside the menu", async () => {
    const onClose = vi.fn();
    renderMenu("file", vi.fn(), onClose);

    const menu = screen.getByRole("menu");
    // mousedown inside the menu should not trigger close
    const event = new MouseEvent("mousedown", { bubbles: true });
    menu.dispatchEvent(event);
    // onClose may be called from the menu item click, but not from handleClickOutside
    // We verify handleClickOutside specifically did NOT fire
    expect(onClose).not.toHaveBeenCalled();
  });

  it("adjusts horizontal position when menu overflows viewport", () => {
    const onAction = vi.fn();
    const onClose = vi.fn();

    // Set viewport to 200px wide
    Object.defineProperty(window, "innerWidth", { value: 200, writable: true, configurable: true });

    // Mock getBoundingClientRect to return a menu that is 150px wide
    const originalGetBCR = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      if (this.getAttribute("role") === "menu") {
        return { x: 180, y: 100, width: 150, height: 100, top: 100, left: 180, right: 330, bottom: 200 } as DOMRect;
      }
      return originalGetBCR.call(this);
    };

    render(
      <ContextMenu
        type="file"
        position={{ x: 180, y: 100 }}
        onAction={onAction}
        onClose={onClose}
      />
    );

    const menu = screen.getByRole("menu");
    // position.x (180) + rect.width (150) = 330 > viewport (200) - 10 = 190
    // So adjustedX = 200 - 150 - 10 = 40
    expect(menu.style.left).toBe("40px");

    Element.prototype.getBoundingClientRect = originalGetBCR;
    Object.defineProperty(window, "innerWidth", { value: 1024, writable: true, configurable: true });
  });

  it("adjusts vertical position when menu overflows viewport", () => {
    const onAction = vi.fn();
    const onClose = vi.fn();

    // Set viewport to 200px tall
    Object.defineProperty(window, "innerHeight", { value: 200, writable: true, configurable: true });

    const originalGetBCR = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      if (this.getAttribute("role") === "menu") {
        return { x: 100, y: 180, width: 100, height: 150, top: 180, left: 100, right: 200, bottom: 330 } as DOMRect;
      }
      return originalGetBCR.call(this);
    };

    render(
      <ContextMenu
        type="file"
        position={{ x: 100, y: 180 }}
        onAction={onAction}
        onClose={onClose}
      />
    );

    const menu = screen.getByRole("menu");
    // position.y (180) + rect.height (150) = 330 > viewport (200) - 10 = 190
    // So adjustedY = 200 - 150 - 10 = 40
    expect(menu.style.top).toBe("40px");

    Element.prototype.getBoundingClientRect = originalGetBCR;
    Object.defineProperty(window, "innerHeight", { value: 768, writable: true, configurable: true });
  });
});
