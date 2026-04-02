import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TerminalContextMenu } from "./TerminalContextMenu";
import type { Terminal } from "@xterm/xterm";
import type { IPty } from "@/lib/pty";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { isImeKeyEvent } from "@/utils/imeGuard";

vi.mock("@/lib/pty", () => ({ spawn: vi.fn() }));
vi.mock("@/utils/imeGuard", () => ({
  isImeKeyEvent: vi.fn(() => false),
}));

function makeTerm(overrides: Partial<Terminal> = {}): Terminal {
  return {
    hasSelection: vi.fn(() => false),
    getSelection: vi.fn(() => ""),
    clearSelection: vi.fn(),
    selectAll: vi.fn(),
    clear: vi.fn(),
    focus: vi.fn(),
    ...overrides,
  } as unknown as Terminal;
}

describe("TerminalContextMenu", () => {
  let onClose: () => void;
  let ptyRef: React.RefObject<IPty | null>;

  beforeEach(() => {
    vi.clearAllMocks();
    onClose = vi.fn<() => void>();
    ptyRef = { current: { write: vi.fn() } as unknown as IPty };
  });

  it("renders all menu items", () => {
    const term = makeTerm();
    render(
      <TerminalContextMenu
        position={{ x: 100, y: 100 }}
        term={term}
        ptyRef={ptyRef}
        onClose={onClose}
      />,
    );

    expect(screen.getByText("Copy")).toBeInTheDocument();
    expect(screen.getByText("Paste")).toBeInTheDocument();
    expect(screen.getByText("Select All")).toBeInTheDocument();
    expect(screen.getByText("Clear")).toBeInTheDocument();
  });

  it("disables Copy when no selection", () => {
    const term = makeTerm({ hasSelection: vi.fn(() => false) });
    const { container } = render(
      <TerminalContextMenu
        position={{ x: 100, y: 100 }}
        term={term}
        ptyRef={ptyRef}
        onClose={onClose}
      />,
    );

    const copyItem = container.querySelector(".context-menu-item");
    expect(copyItem).toHaveStyle({ opacity: "0.4" });
  });

  it("enables Copy when selection exists", () => {
    const term = makeTerm({ hasSelection: vi.fn(() => true) });
    const { container } = render(
      <TerminalContextMenu
        position={{ x: 100, y: 100 }}
        term={term}
        ptyRef={ptyRef}
        onClose={onClose}
      />,
    );

    const copyItem = container.querySelector(".context-menu-item");
    expect(copyItem).toHaveStyle({ opacity: "1" });
  });

  it("closes on Escape", () => {
    const term = makeTerm();
    render(
      <TerminalContextMenu
        position={{ x: 100, y: 100 }}
        term={term}
        ptyRef={ptyRef}
        onClose={onClose}
      />,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on click outside", () => {
    const term = makeTerm();
    render(
      <TerminalContextMenu
        position={{ x: 100, y: 100 }}
        term={term}
        ptyRef={ptyRef}
        onClose={onClose}
      />,
    );

    fireEvent.mouseDown(document);
    expect(onClose).toHaveBeenCalled();
  });

  it("does not close on click inside menu", () => {
    const term = makeTerm();
    render(
      <TerminalContextMenu
        position={{ x: 100, y: 100 }}
        term={term}
        ptyRef={ptyRef}
        onClose={onClose}
      />,
    );

    const menuItem = screen.getByText("Paste");
    fireEvent.mouseDown(menuItem);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not close on IME keydown event", () => {
    vi.mocked(isImeKeyEvent).mockReturnValueOnce(true);
    const term = makeTerm();
    render(
      <TerminalContextMenu
        position={{ x: 100, y: 100 }}
        term={term}
        ptyRef={ptyRef}
        onClose={onClose}
      />,
    );

    fireEvent.keyDown(document, { key: "Escape", isComposing: true });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders separator before Clear item", () => {
    const term = makeTerm();
    const { container } = render(
      <TerminalContextMenu
        position={{ x: 100, y: 100 }}
        term={term}
        ptyRef={ptyRef}
        onClose={onClose}
      />,
    );

    const separators = container.querySelectorAll(".context-menu-separator");
    expect(separators.length).toBe(1);
  });

  describe("action handlers", () => {
    it("copies selection and clears it on Copy click", async () => {
      const term = makeTerm({
        hasSelection: vi.fn(() => true),
        getSelection: vi.fn(() => "selected text  "),
      });
      render(
        <TerminalContextMenu
          position={{ x: 100, y: 100 }}
          term={term}
          ptyRef={ptyRef}
          onClose={onClose}
        />,
      );

      fireEvent.click(screen.getByText("Copy"));
      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith("selected text");
      });
      expect(term.clearSelection).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
      expect(term.focus).toHaveBeenCalled();
    });

    it("pastes from clipboard to PTY on Paste click", async () => {
      vi.mocked(readText).mockResolvedValue("pasted content");
      const mockWrite = vi.fn();
      const localPtyRef = { current: { write: mockWrite } as unknown as IPty };
      const term = makeTerm();
      render(
        <TerminalContextMenu
          position={{ x: 100, y: 100 }}
          term={term}
          ptyRef={localPtyRef}
          onClose={onClose}
        />,
      );

      fireEvent.click(screen.getByText("Paste"));
      await waitFor(() => {
        expect(mockWrite).toHaveBeenCalledWith("pasted content");
      });
      expect(onClose).toHaveBeenCalled();
    });

    it("does not write to PTY when ptyRef is null on Paste", async () => {
      vi.mocked(readText).mockResolvedValue("text");
      const nullPtyRef = { current: null };
      const term = makeTerm();
      render(
        <TerminalContextMenu
          position={{ x: 100, y: 100 }}
          term={term}
          ptyRef={nullPtyRef}
          onClose={onClose}
        />,
      );

      fireEvent.click(screen.getByText("Paste"));
      await waitFor(() => {
        expect(onClose).toHaveBeenCalled();
      });
    });

    it("does not write to PTY when clipboard is empty on Paste", async () => {
      vi.mocked(readText).mockResolvedValue("");
      const mockWrite = vi.fn();
      const localPtyRef = { current: { write: mockWrite } as unknown as IPty };
      const term = makeTerm();
      render(
        <TerminalContextMenu
          position={{ x: 100, y: 100 }}
          term={term}
          ptyRef={localPtyRef}
          onClose={onClose}
        />,
      );

      fireEvent.click(screen.getByText("Paste"));
      await waitFor(() => {
        expect(onClose).toHaveBeenCalled();
      });
      expect(mockWrite).not.toHaveBeenCalled();
    });

    it("selects all on Select All click", () => {
      const term = makeTerm();
      render(
        <TerminalContextMenu
          position={{ x: 100, y: 100 }}
          term={term}
          ptyRef={ptyRef}
          onClose={onClose}
        />,
      );

      fireEvent.click(screen.getByText("Select All"));
      expect(term.selectAll).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
      expect(term.focus).toHaveBeenCalled();
    });

    it("clears terminal on Clear click", () => {
      const term = makeTerm();
      render(
        <TerminalContextMenu
          position={{ x: 100, y: 100 }}
          term={term}
          ptyRef={ptyRef}
          onClose={onClose}
        />,
      );

      fireEvent.click(screen.getByText("Clear"));
      expect(term.clear).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
      expect(term.focus).toHaveBeenCalled();
    });
  });

  it("does not close on non-Escape key", () => {
    const term = makeTerm();
    render(
      <TerminalContextMenu
        position={{ x: 100, y: 100 }}
        term={term}
        ptyRef={ptyRef}
        onClose={onClose}
      />,
    );

    fireEvent.keyDown(document, { key: "a" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not copy when hasSelection becomes false at action time", async () => {
    // hasSelection returns true initially (for rendering) but false when action runs
    let callCount = 0;
    const term = makeTerm({
      hasSelection: vi.fn(() => {
        callCount++;
        // First call during render → true; second call during action → false
        return callCount <= 1;
      }),
    });

    render(
      <TerminalContextMenu
        position={{ x: 100, y: 100 }}
        term={term}
        ptyRef={ptyRef}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByText("Copy"));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    // writeText should NOT have been called because hasSelection was false at action time
    expect(writeText).not.toHaveBeenCalled();
    expect(term.clearSelection).not.toHaveBeenCalled();
  });

  describe("viewport adjustment", () => {
    it("adjusts position when menu would overflow right edge", () => {
      Object.defineProperty(window, "innerWidth", { value: 500, writable: true });
      Object.defineProperty(window, "innerHeight", { value: 500, writable: true });

      // Mock getBoundingClientRect to simulate a menu with width
      const origProto = HTMLElement.prototype.getBoundingClientRect;
      HTMLElement.prototype.getBoundingClientRect = function () {
        if (this.classList.contains("context-menu")) {
          return { top: 100, left: 480, right: 580, bottom: 200, width: 100, height: 100, x: 480, y: 100, toJSON: () => {} } as DOMRect;
        }
        return origProto.call(this);
      };

      const term = makeTerm();
      const { container } = render(
        <TerminalContextMenu
          position={{ x: 480, y: 100 }}
          term={term}
          ptyRef={ptyRef}
          onClose={onClose}
        />,
      );

      const menu = container.querySelector(".context-menu") as HTMLElement;
      expect(menu).toBeTruthy();
      // x + rect.width (480 + 100 = 580) > innerWidth - 10 (490) → adjusted
      expect(menu.style.left).toBe("390px"); // 500 - 100 - 10

      HTMLElement.prototype.getBoundingClientRect = origProto;
    });

    it("adjusts position when menu would overflow bottom edge", () => {
      Object.defineProperty(window, "innerWidth", { value: 500, writable: true });
      Object.defineProperty(window, "innerHeight", { value: 200, writable: true });

      const origProto = HTMLElement.prototype.getBoundingClientRect;
      HTMLElement.prototype.getBoundingClientRect = function () {
        if (this.classList.contains("context-menu")) {
          return { top: 190, left: 100, right: 200, bottom: 340, width: 100, height: 150, x: 100, y: 190, toJSON: () => {} } as DOMRect;
        }
        return origProto.call(this);
      };

      const term = makeTerm();
      const { container } = render(
        <TerminalContextMenu
          position={{ x: 100, y: 190 }}
          term={term}
          ptyRef={ptyRef}
          onClose={onClose}
        />,
      );

      const menu = container.querySelector(".context-menu") as HTMLElement;
      expect(menu).toBeTruthy();
      // y + rect.height (190 + 150 = 340) > innerHeight - 10 (190) → adjusted
      expect(menu.style.top).toBe("40px"); // 200 - 150 - 10

      HTMLElement.prototype.getBoundingClientRect = origProto;
    });

    it("does not adjust position when menu fits in viewport", () => {
      Object.defineProperty(window, "innerWidth", { value: 1200, writable: true });
      Object.defineProperty(window, "innerHeight", { value: 900, writable: true });

      const origProto = HTMLElement.prototype.getBoundingClientRect;
      HTMLElement.prototype.getBoundingClientRect = function () {
        if (this.classList.contains("context-menu")) {
          return { top: 100, left: 100, right: 200, bottom: 200, width: 100, height: 100, x: 100, y: 100, toJSON: () => {} } as DOMRect;
        }
        return origProto.call(this);
      };

      const term = makeTerm();
      const { container } = render(
        <TerminalContextMenu
          position={{ x: 100, y: 100 }}
          term={term}
          ptyRef={ptyRef}
          onClose={onClose}
        />,
      );

      const menu = container.querySelector(".context-menu") as HTMLElement;
      expect(menu).toBeTruthy();
      // No overflow, positions stay the same
      expect(menu.style.left).toBe("100px");
      expect(menu.style.top).toBe("100px");

      HTMLElement.prototype.getBoundingClientRect = origProto;
    });
  });
});
