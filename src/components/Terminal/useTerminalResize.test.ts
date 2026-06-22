/**
 * useTerminalResize — grow-direction (sign) tests.
 *
 * The handle sits on the editor-adjacent edge, so the drag direction that
 * grows the panel flips per side. These tests lock in that inversion (the
 * core regression risk when adding top/left positions).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTerminalResize } from "./useTerminalResize";
import { useUIStore } from "@/stores/uiStore";
import type { EffectiveTerminalPosition } from "@/stores/uiStore";

// Persisting the ratio on mouseup is a side effect we don't care about here.
vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({ updateTerminalSetting: vi.fn() }),
  },
}));

function mouseEvent(type: string, x: number, y: number) {
  return new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
}

/** Start a drag at (x,y), move to (x2,y2), end it; return the resulting size. */
function drag(
  position: EffectiveTerminalPosition,
  start: [number, number],
  end: [number, number],
  read: () => number
) {
  const { result } = renderHook(() => useTerminalResize(position));
  result.current({ preventDefault() {}, clientX: start[0], clientY: start[1] } as React.MouseEvent);
  document.dispatchEvent(mouseEvent("mousemove", end[0], end[1]));
  const size = read();
  document.dispatchEvent(mouseEvent("mouseup", end[0], end[1]));
  return size;
}

describe("useTerminalResize grow direction", () => {
  beforeEach(() => {
    const ui = useUIStore.getState();
    ui.setTerminalHeight(300);
    ui.setTerminalWidth(300);
  });

  it("bottom panel: dragging UP grows height", () => {
    useUIStore.getState().setEffectiveTerminalPosition("bottom");
    const size = drag("bottom", [0, 500], [0, 460], () => useUIStore.getState().terminalHeight);
    expect(size).toBeGreaterThan(300);
  });

  it("top panel: dragging UP shrinks height (inverted vs bottom)", () => {
    useUIStore.getState().setEffectiveTerminalPosition("top");
    const size = drag("top", [0, 500], [0, 460], () => useUIStore.getState().terminalHeight);
    expect(size).toBeLessThan(300);
  });

  it("right panel: dragging LEFT grows width", () => {
    useUIStore.getState().setEffectiveTerminalPosition("right");
    const size = drag("right", [500, 0], [460, 0], () => useUIStore.getState().terminalWidth);
    expect(size).toBeGreaterThan(300);
  });

  it("left panel: dragging LEFT shrinks width (inverted vs right)", () => {
    useUIStore.getState().setEffectiveTerminalPosition("left");
    const size = drag("left", [500, 0], [460, 0], () => useUIStore.getState().terminalWidth);
    expect(size).toBeLessThan(300);
  });
});
