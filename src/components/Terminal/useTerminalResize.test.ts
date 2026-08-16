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
import { useUIStore, TERMINAL_MAX_RATIO } from "@/stores/uiStore";
import type { EffectiveTerminalPosition } from "@/stores/uiStore";

// Persisting the ratio on mouseup is a side effect the drag tests don't care
// about; the maximize tests DO need to read panelRatio, so the mock is stateful.
const { settingsState } = vi.hoisted(() => {
  const state = {
    terminal: { panelRatio: 0.4 },
    // currentShellSideWidth() reads the rail setting (audit fix).
    general: { workspaceRailMode: false },
    // Writes through, so a test that persists a ratio really changes what a
    // later read sees — otherwise "restore" would pass even while the stored
    // ratio was being clobbered.
    updateTerminalSetting: vi.fn((key: string, value: unknown) => {
      if (key === "panelRatio") state.terminal.panelRatio = value as number;
    }),
  };
  return { settingsState: state };
});
vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: { getState: () => settingsState },
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
  result.current.handleResizeStart({
    preventDefault() {},
    clientX: start[0],
    clientY: start[1],
  } as React.MouseEvent);
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

describe("toggleMaximize (WI-4.5 / F6)", () => {
  const WINDOW_H = 1000;
  const WINDOW_W = 1600;
  // getAvailableDimension subtracts the 40px titlebar + 40px statusbar on the
  // vertical axis, and the sidebar width on the horizontal axis.
  const AVAILABLE_V = WINDOW_H - 80;
  const AVAILABLE_H = WINDOW_W;

  beforeEach(() => {
    settingsState.terminal.panelRatio = 0.4;
    settingsState.updateTerminalSetting.mockClear();
    window.innerWidth = WINDOW_W;
    window.innerHeight = WINDOW_H;
    useUIStore.setState({ sidebarVisible: false, sidebarWidth: 0 });
  });

  function mount(position: EffectiveTerminalPosition) {
    useUIStore.getState().setEffectiveTerminalPosition(position);
    return renderHook(() => useTerminalResize(position));
  }

  it("snaps a bottom panel to the cap", () => {
    useUIStore.getState().setTerminalHeight(Math.round(AVAILABLE_V * 0.4));
    const { result } = mount("bottom");

    result.current.toggleMaximize();

    expect(useUIStore.getState().terminalHeight).toBe(Math.round(AVAILABLE_V * TERMINAL_MAX_RATIO));
  });

  it("restores the STORED ratio on a second toggle", () => {
    useUIStore.getState().setTerminalHeight(Math.round(AVAILABLE_V * 0.4));
    const { result } = mount("bottom");

    result.current.toggleMaximize();
    result.current.toggleMaximize();

    expect(useUIStore.getState().terminalHeight).toBe(Math.round(AVAILABLE_V * 0.4));
  });

  it("restores the stored ratio even when the pre-toggle size differed from it", () => {
    // A drag that was never persisted must not become the restore target —
    // the persisted ratio is the source of truth.
    settingsState.terminal.panelRatio = 0.25;
    useUIStore.getState().setTerminalHeight(Math.round(AVAILABLE_V * 0.33));
    const { result } = mount("bottom");

    result.current.toggleMaximize();
    result.current.toggleMaximize();

    expect(useUIStore.getState().terminalHeight).toBe(Math.round(AVAILABLE_V * 0.25));
  });

  it("never rewrites the persisted panelRatio", () => {
    // The whole point of a toggle rather than a setting (D2): maximizing is
    // temporary and must not become the user's new default.
    useUIStore.getState().setTerminalHeight(Math.round(AVAILABLE_V * 0.4));
    const { result } = mount("bottom");

    result.current.toggleMaximize();
    result.current.toggleMaximize();

    expect(settingsState.updateTerminalSetting).not.toHaveBeenCalled();
    expect(settingsState.terminal.panelRatio).toBe(0.4);
  });

  it("works on the horizontal axis (right panel resizes width)", () => {
    useUIStore.getState().setTerminalWidth(Math.round(AVAILABLE_H * 0.4));
    const { result } = mount("right");

    result.current.toggleMaximize();
    expect(useUIStore.getState().terminalWidth).toBe(Math.round(AVAILABLE_H * TERMINAL_MAX_RATIO));

    result.current.toggleMaximize();
    expect(useUIStore.getState().terminalWidth).toBe(Math.round(AVAILABLE_H * 0.4));
  });

  it("does not touch the other axis's dimension", () => {
    useUIStore.getState().setTerminalHeight(Math.round(AVAILABLE_V * 0.4));
    useUIStore.getState().setTerminalWidth(400);
    const { result } = mount("bottom");

    result.current.toggleMaximize();

    expect(useUIStore.getState().terminalWidth).toBe(400);
  });

  it("does NOT call onResize — the store write already drives the refit", () => {
    // Calling it too would schedule the same fit twice for one toggle: once
    // here and once from TerminalPanel's width/height effect.
    const onResize = vi.fn();
    // Set the starting size explicitly: leaving it to whatever a previous test
    // left behind decides whether this toggle maximizes or restores.
    useUIStore.getState().setTerminalHeight(Math.round(AVAILABLE_V * 0.4));
    useUIStore.getState().setEffectiveTerminalPosition("bottom");
    const { result } = renderHook(() => useTerminalResize("bottom", onResize));

    result.current.toggleMaximize();

    expect(onResize).not.toHaveBeenCalled();
    // …but the geometry really did change, so the effect has something to react to.
    expect(useUIStore.getState().terminalHeight).toBe(Math.round(AVAILABLE_V * TERMINAL_MAX_RATIO));
  });

  it("clamps a legacy over-cap stored ratio when restoring", () => {
    // Restoring to a ratio above the cap would exceed what the layout enforces
    // everywhere else. Stated relative to the cap: written as the literal 0.8
    // it silently became a no-op the moment #1279 raised the cap to 0.8.
    settingsState.terminal.panelRatio = TERMINAL_MAX_RATIO + 0.15;
    useUIStore.getState().setTerminalHeight(Math.round(AVAILABLE_V * TERMINAL_MAX_RATIO));
    const { result } = mount("bottom");

    // Already at the cap → this toggle RESTORES.
    result.current.toggleMaximize();

    expect(useUIStore.getState().terminalHeight).toBe(Math.round(AVAILABLE_V * TERMINAL_MAX_RATIO));
  });

  it("does nothing when the available dimension is zero", () => {
    window.innerHeight = 0;
    useUIStore.getState().setTerminalHeight(250);
    const { result } = mount("bottom");

    result.current.toggleMaximize();

    expect(useUIStore.getState().terminalHeight).toBe(250);
  });
});

describe("double-click maximize through the real DOM event sequence (WI-4.5)", () => {
  // REGRESSION (Codex audit): a double-click delivers TWO complete
  // mousedown/mouseup pairs. While mouseup persisted the ratio
  // unconditionally, the second double-click's clicks wrote the maximized 0.5
  // back as the stored ratio BEFORE toggleMaximize() read it — so "restore"
  // restored to the maximized size and the toggle became one-way.
  const WINDOW_H = 1000;
  const AVAILABLE_V = WINDOW_H - 80;

  beforeEach(() => {
    settingsState.terminal.panelRatio = 0.4;
    settingsState.updateTerminalSetting.mockClear();
    window.innerWidth = 1600;
    window.innerHeight = WINDOW_H;
    useUIStore.setState({ sidebarVisible: false, sidebarWidth: 0 });
    useUIStore.getState().setEffectiveTerminalPosition("bottom");
    useUIStore.getState().setTerminalHeight(Math.round(AVAILABLE_V * 0.4));
  });

  /** One full click: mousedown on the handle, then a document mouseup. */
  function click(result: { current: { handleResizeStart: (e: React.MouseEvent) => void } }) {
    result.current.handleResizeStart({
      preventDefault() {},
      clientX: 0,
      clientY: 500,
    } as React.MouseEvent);
    document.dispatchEvent(mouseEvent("mouseup", 0, 500));
  }

  it("a click with no movement never rewrites the persisted ratio", () => {
    const { result } = renderHook(() => useTerminalResize("bottom"));
    click(result);
    expect(settingsState.updateTerminalSetting).not.toHaveBeenCalled();
  });

  it("survives a full double-click → maximize → double-click → restore cycle", () => {
    const { result } = renderHook(() => useTerminalResize("bottom"));
    const stored = Math.round(AVAILABLE_V * 0.4);
    const capped = Math.round(AVAILABLE_V * TERMINAL_MAX_RATIO);

    // First double-click: two clicks, then the dblclick handler.
    click(result);
    click(result);
    result.current.toggleMaximize();
    expect(useUIStore.getState().terminalHeight).toBe(capped);

    // Second double-click: its two clicks must NOT persist the maximized size.
    click(result);
    click(result);
    result.current.toggleMaximize();

    expect(useUIStore.getState().terminalHeight).toBe(stored);
    expect(settingsState.terminal.panelRatio).toBe(0.4);
    expect(settingsState.updateTerminalSetting).not.toHaveBeenCalled();
  });

  it("a real drag still persists the ratio", () => {
    const { result } = renderHook(() => useTerminalResize("bottom"));
    result.current.handleResizeStart({
      preventDefault() {},
      clientX: 0,
      clientY: 500,
    } as React.MouseEvent);
    document.dispatchEvent(mouseEvent("mousemove", 0, 450));
    document.dispatchEvent(mouseEvent("mouseup", 0, 450));

    expect(settingsState.updateTerminalSetting).toHaveBeenCalledWith(
      "panelRatio",
      expect.any(Number),
    );
  });
});
