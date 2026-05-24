/**
 * Tests for useSidebarResize.
 *
 * Covers width clamping (150-500), listener registration and cleanup on
 * mouseup/blur/unmount, and body style restoration. Regression here leaks
 * mousemove listeners and traps the cursor in `col-resize`.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

const { mockSetSidebarWidth, uiState } = vi.hoisted(() => ({
  mockSetSidebarWidth: vi.fn(),
  uiState: { sidebarWidth: 250 },
}));

vi.mock("@/stores/uiStore", () => ({
  useUIStore: {
    getState: () => ({
      sidebarWidth: uiState.sidebarWidth,
      setSidebarWidth: mockSetSidebarWidth,
    }),
  },
}));

import { useSidebarResize } from "./useSidebarResize";

function fireMouseDown(clientX: number): React.MouseEvent {
  // The handler only reads `preventDefault` and `clientX`. Build a minimal
  // event-like object — a real React synthetic event isn't reachable from
  // a hook test without rendering an actual handle element.
  return {
    preventDefault: vi.fn(),
    clientX,
  } as unknown as React.MouseEvent;
}

function fireMouseMove(clientX: number): void {
  document.dispatchEvent(new MouseEvent("mousemove", { clientX }));
}

function fireMouseUp(): void {
  document.dispatchEvent(new MouseEvent("mouseup"));
}

function fireBlur(): void {
  window.dispatchEvent(new Event("blur"));
}

beforeEach(() => {
  mockSetSidebarWidth.mockReset();
  uiState.sidebarWidth = 250;
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
});

describe("useSidebarResize", () => {
  it("clamps width to MIN (150) when delta pushes below the floor", () => {
    const { result } = renderHook(() => useSidebarResize());
    act(() => result.current.handleResizeStart(fireMouseDown(500)));

    // Drag far to the left — delta = -400, start was 250 → 250-400 = -150,
    // clamped to 150.
    act(() => fireMouseMove(100));

    expect(mockSetSidebarWidth).toHaveBeenLastCalledWith(150);
    act(() => fireMouseUp());
  });

  it("clamps width to MAX (500) when delta pushes above the ceiling", () => {
    const { result } = renderHook(() => useSidebarResize());
    act(() => result.current.handleResizeStart(fireMouseDown(0)));

    // Drag far right — delta = +1000, 250+1000 = 1250, clamped to 500.
    act(() => fireMouseMove(1000));

    expect(mockSetSidebarWidth).toHaveBeenLastCalledWith(500);
    act(() => fireMouseUp());
  });

  it("passes unclamped widths inside [150, 500] through unchanged", () => {
    const { result } = renderHook(() => useSidebarResize());
    act(() => result.current.handleResizeStart(fireMouseDown(100)));

    // delta = +50, start 250 → 300 (within range)
    act(() => fireMouseMove(150));

    expect(mockSetSidebarWidth).toHaveBeenLastCalledWith(300);
    act(() => fireMouseUp());
  });

  it("sets body cursor and userSelect on drag start", () => {
    const { result } = renderHook(() => useSidebarResize());
    act(() => result.current.handleResizeStart(fireMouseDown(0)));

    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");

    act(() => fireMouseUp());
  });

  it("resets body styles and removes listeners on mouseup", () => {
    const { result } = renderHook(() => useSidebarResize());
    act(() => result.current.handleResizeStart(fireMouseDown(0)));
    act(() => fireMouseUp());

    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");

    // Further mousemove must not produce store writes.
    const callsBefore = mockSetSidebarWidth.mock.calls.length;
    act(() => fireMouseMove(500));
    expect(mockSetSidebarWidth.mock.calls.length).toBe(callsBefore);
  });

  it("window blur triggers the same cleanup as mouseup", () => {
    const { result } = renderHook(() => useSidebarResize());
    act(() => result.current.handleResizeStart(fireMouseDown(0)));
    act(() => fireBlur());

    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");

    const callsBefore = mockSetSidebarWidth.mock.calls.length;
    act(() => fireMouseMove(500));
    expect(mockSetSidebarWidth.mock.calls.length).toBe(callsBefore);
  });

  it("unmount mid-drag runs cleanup", () => {
    const { result, unmount } = renderHook(() => useSidebarResize());
    act(() => result.current.handleResizeStart(fireMouseDown(0)));

    unmount();

    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");

    const callsBefore = mockSetSidebarWidth.mock.calls.length;
    act(() => fireMouseMove(500));
    expect(mockSetSidebarWidth.mock.calls.length).toBe(callsBefore);
  });

  // ─── WI-2.2 — keyboard resize (a11y) ──────────────────────────────────
  //
  // Verifies the arrow-key resize handler clamps to MIN/MAX, supports the
  // Shift modifier for larger steps, and routes Home/End to MIN/MAX. The
  // hook reads the current width from the mocked uiStore on each call —
  // tests adjust `uiState.sidebarWidth` between presses to simulate a
  // sequence (since the mock is a getter, not a true reactive store).

  function fireKeyDown(
    key: string,
    opts: { shiftKey?: boolean } = {},
  ): React.KeyboardEvent {
    return {
      key,
      shiftKey: !!opts.shiftKey,
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent;
  }

  describe("handleResizeKeyDown (a11y)", () => {
    it("ArrowRight increments width by KEYBOARD_RESIZE_STEP (8)", () => {
      uiState.sidebarWidth = 250;
      const { result } = renderHook(() => useSidebarResize());

      act(() => result.current.handleResizeKeyDown(fireKeyDown("ArrowRight")));

      expect(mockSetSidebarWidth).toHaveBeenLastCalledWith(258);
    });

    it("ArrowLeft decrements width by KEYBOARD_RESIZE_STEP (8)", () => {
      uiState.sidebarWidth = 250;
      const { result } = renderHook(() => useSidebarResize());

      act(() => result.current.handleResizeKeyDown(fireKeyDown("ArrowLeft")));

      expect(mockSetSidebarWidth).toHaveBeenLastCalledWith(242);
    });

    it("Shift+ArrowRight uses LARGE step (32)", () => {
      uiState.sidebarWidth = 250;
      const { result } = renderHook(() => useSidebarResize());

      act(() =>
        result.current.handleResizeKeyDown(
          fireKeyDown("ArrowRight", { shiftKey: true }),
        ),
      );

      expect(mockSetSidebarWidth).toHaveBeenLastCalledWith(282);
    });

    it("ArrowLeft clamps to MIN (150) when already at floor", () => {
      uiState.sidebarWidth = 152;
      const { result } = renderHook(() => useSidebarResize());

      act(() => result.current.handleResizeKeyDown(fireKeyDown("ArrowLeft")));

      expect(mockSetSidebarWidth).toHaveBeenLastCalledWith(150);
    });

    it("ArrowRight clamps to MAX (500) when already at ceiling", () => {
      uiState.sidebarWidth = 495;
      const { result } = renderHook(() => useSidebarResize());

      act(() => result.current.handleResizeKeyDown(fireKeyDown("ArrowRight")));

      expect(mockSetSidebarWidth).toHaveBeenLastCalledWith(500);
    });

    it("Home jumps directly to MIN (150)", () => {
      uiState.sidebarWidth = 350;
      const { result } = renderHook(() => useSidebarResize());

      act(() => result.current.handleResizeKeyDown(fireKeyDown("Home")));

      expect(mockSetSidebarWidth).toHaveBeenLastCalledWith(150);
    });

    it("End jumps directly to MAX (500)", () => {
      uiState.sidebarWidth = 350;
      const { result } = renderHook(() => useSidebarResize());

      act(() => result.current.handleResizeKeyDown(fireKeyDown("End")));

      expect(mockSetSidebarWidth).toHaveBeenLastCalledWith(500);
    });

    it("ignores non-resize keys (no store write, no preventDefault)", () => {
      uiState.sidebarWidth = 250;
      const { result } = renderHook(() => useSidebarResize());
      const evt = fireKeyDown("Tab");

      act(() => result.current.handleResizeKeyDown(evt));

      expect(mockSetSidebarWidth).not.toHaveBeenCalled();
      expect(evt.preventDefault).not.toHaveBeenCalled();
    });

    it("calls preventDefault on resize keys to prevent default scroll behavior", () => {
      uiState.sidebarWidth = 250;
      const { result } = renderHook(() => useSidebarResize());
      const evt = fireKeyDown("ArrowRight");

      act(() => result.current.handleResizeKeyDown(evt));

      expect(evt.preventDefault).toHaveBeenCalledTimes(1);
    });
  });
});
