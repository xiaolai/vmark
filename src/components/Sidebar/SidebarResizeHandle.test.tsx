/**
 * SidebarResizeHandle component tests.
 *
 * Locks ONLY the wiring extracted from App.tsx: role="separator",
 * the ARIA attributes (including aria-valuenow from the live `width`
 * prop), tabIndex, and the fact that onMouseDown / onKeyDown are bound
 * to the hook's handlers.
 *
 * Step/clamp/Home/End semantics belong to the hook itself and are
 * exhaustively covered in src/hooks/useSidebarResize.test.tsx — this
 * suite mocks the hook so re-asserting those rules here would only
 * create DRY debt and couple the view test to hook internals.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { mockHandleResizeStart, mockHandleResizeKeyDown } = vi.hoisted(() => ({
  mockHandleResizeStart: vi.fn(),
  mockHandleResizeKeyDown: vi.fn(),
}));

vi.mock("@/hooks/useSidebarResize", async () => {
  // Pass-through MIN/MAX so the component still renders the real
  // constants on `aria-valuemin` / `aria-valuemax`. The hook itself
  // is replaced with a no-op pair we can spy on.
  const actual =
    await vi.importActual<typeof import("@/hooks/useSidebarResize")>(
      "@/hooks/useSidebarResize",
    );
  return {
    ...actual,
    useSidebarResize: () => ({
      handleResizeStart: mockHandleResizeStart,
      handleResizeKeyDown: mockHandleResizeKeyDown,
    }),
  };
});

import { SidebarResizeHandle } from "./SidebarResizeHandle";

beforeEach(() => {
  mockHandleResizeStart.mockReset();
  mockHandleResizeKeyDown.mockReset();
});

describe("SidebarResizeHandle", () => {
  it("renders a focusable separator with ARIA wiring", () => {
    render(<SidebarResizeHandle width={260} />);

    const handle = screen.getByRole("separator");
    expect(handle.getAttribute("aria-orientation")).toBe("vertical");
    expect(handle.getAttribute("aria-valuenow")).toBe("260");
    // MIN_SIDEBAR_WIDTH (150) / MAX_SIDEBAR_WIDTH (500) come from the
    // real module — we kept the actual constants in the mock above so
    // a future bump in the source values surfaces here.
    expect(handle.getAttribute("aria-valuemin")).toBe("150");
    expect(handle.getAttribute("aria-valuemax")).toBe("500");
    expect(handle.getAttribute("tabindex")).toBe("0");
  });

  it("exposes an accessible name from t('aria.sidebarResize')", () => {
    render(<SidebarResizeHandle width={260} />);

    // The t() mock in src/test/setup.ts resolves missing keys to the key
    // itself, so we assert the key is wired through aria-label without
    // depending on a specific translated string.
    const handle = screen.getByRole("separator");
    expect(handle.getAttribute("aria-label")).toMatch(/sidebarResize|resize/i);
  });

  it("reflects the live width prop in aria-valuenow", () => {
    const { rerender } = render(<SidebarResizeHandle width={200} />);
    expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe(
      "200",
    );

    rerender(<SidebarResizeHandle width={420} />);
    expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe(
      "420",
    );
  });

  it("binds onMouseDown to the hook's handleResizeStart", () => {
    render(<SidebarResizeHandle width={260} />);

    fireEvent.mouseDown(screen.getByRole("separator"), { clientX: 100 });

    expect(mockHandleResizeStart).toHaveBeenCalledTimes(1);
    expect(mockHandleResizeKeyDown).not.toHaveBeenCalled();
  });

  it("binds onKeyDown to the hook's handleResizeKeyDown", () => {
    render(<SidebarResizeHandle width={260} />);

    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowRight" });

    expect(mockHandleResizeKeyDown).toHaveBeenCalledTimes(1);
    expect(mockHandleResizeStart).not.toHaveBeenCalled();
  });
});
