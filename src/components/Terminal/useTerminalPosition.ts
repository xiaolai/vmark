/**
 * useTerminalPosition
 *
 * Purpose: Auto-reposition the terminal panel based on window aspect ratio
 * and compute pixel dimensions from the persisted panelRatio.
 *
 * Landscape windows (ratio >= 1.5) place the terminal on the right;
 * portrait windows (ratio <= 0.85) keep it at the bottom. In the ambiguous
 * zone a width threshold with 50px hysteresis prevents oscillation.
 *
 * Pixel dimensions are derived from `settingsStore.terminal.panelRatio`
 * multiplied by the available container dimension, clamped to the absolute
 * pixel floor and a proportional ceiling of TERMINAL_MAX_RATIO (80%). The
 * available dimension subtracts the shell's whole side chrome — workspace rail
 * INCLUDED; omitting it sized the panel against 30px the editor did not have.
 *
 * Exports a pure `computeTerminalPosition()` for testing and a React hook
 * `useTerminalPosition()` that wires it to window resize events and settings.
 * Also exports the position-axis helpers (`isHorizontalTerminalAxis`,
 * `oppositeTerminalPosition`) used by the panel layout and the swap control;
 * explicit top/bottom/left/right are honored, while "auto" resolves to
 * bottom/right by aspect ratio.
 *
 * @coordinates-with settingsStore — reads terminal.position and terminal.panelRatio
 * @coordinates-with uiStore — writes effectiveTerminalPosition, terminalHeight, terminalWidth
 * @module components/Terminal/useTerminalPosition
 */

import { useEffect, useRef } from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import { BAR_HEIGHT, shellSideWidth } from "@/shell/shellChrome";
import { usesOverlayTitleBar } from "@/utils/platform";
import {
  useUIStore,
  type EffectiveTerminalPosition,
  TERMINAL_MIN_HEIGHT,
  TERMINAL_MIN_WIDTH,
  TERMINAL_MAX_RATIO,
} from "@/stores/uiStore";

// Width threshold for the ambiguous aspect-ratio zone
const WIDTH_THRESHOLD = 1440;
const HYSTERESIS_PX = 50;

// Layout constants — one owner (R11): shellChrome.BAR_HEIGHT. The top strip
// exists only where the app overlays the native title bar (macOS); elsewhere
// the OS draws its own outside the webview and there is nothing to subtract.
const TITLEBAR_HEIGHT = usesOverlayTitleBar() ? BAR_HEIGHT : 0;
const STATUSBAR_HEIGHT = BAR_HEIGHT;

/**
 * Pure function: decide terminal position from window dimensions.
 *
 * Algorithm:
 *   ratio >= 1.5  → right  (definite landscape)
 *   ratio <= 0.85 → bottom (definite portrait)
 *   else          → width tiebreaker with hysteresis
 */
export function computeTerminalPosition(
  windowWidth: number,
  windowHeight: number,
  currentPosition: EffectiveTerminalPosition
): EffectiveTerminalPosition {
  // Guard against zero, negative, or non-finite dimensions
  if (!Number.isFinite(windowWidth) || !Number.isFinite(windowHeight) || windowWidth <= 0 || windowHeight <= 0) {
    return currentPosition;
  }

  const ratio = windowWidth / windowHeight;

  if (ratio >= 1.5) return "right";
  if (ratio <= 0.85) return "bottom";

  // Ambiguous zone: use width tiebreaker with hysteresis
  const threshold =
    currentPosition === "right"
      ? WIDTH_THRESHOLD - HYSTERESIS_PX
      : WIDTH_THRESHOLD;

  return windowWidth >= threshold ? "right" : "bottom";
}

/**
 * Compute pixel dimension from ratio, clamped to the absolute pixel floor and
 * a proportional ceiling of TERMINAL_MAX_RATIO (80% of the available space).
 * Exported so the settings dropdown's options can be proven un-clamped
 * (WI-1.2) against the real layout function rather than a restatement of it.
 */
export function ratioToPixels(
  ratio: number,
  availableDimension: number,
  min: number
): number {
  const max = availableDimension * TERMINAL_MAX_RATIO;
  return Math.round(Math.min(max, Math.max(min, availableDimension * ratio)));
}

/**
 * Compute ratio from pixel dimension.
 */
export function pixelsToRatio(pixels: number, availableDimension: number): number {
  if (availableDimension <= 0) return 0.4;
  // Clamp ratio to 0.1–0.8 (TERMINAL_MAX_RATIO)
  return Math.min(TERMINAL_MAX_RATIO, Math.max(0.1, pixels / availableDimension));
}

/**
 * Pure function: compute available dimension for the terminal panel.
 * - Bottom: windowHeight minus titlebar and statusbar
 * - Right/left: windowWidth minus the shell's side chrome (rail + sidebar),
 *   passed in already combined — see shell/shellChrome
 */
export function getAvailableDimension(
  pos: EffectiveTerminalPosition,
  windowW: number,
  windowH: number,
  /** Chrome to the left of the editor — rail + sidebar. See shellChrome. */
  sideWidth: number
): number {
  if (isHorizontalTerminalAxis(pos)) {
    // Takes the ALREADY-COMBINED width rather than re-deriving it from
    // sidebar state: this function used to add up its own answer and forgot
    // the 30px workspace rail, so a rail-enabled window sized the panel (and
    // its ratio cap) against 30px it did not have.
    return windowW - sideWidth;
  }
  return windowH - TITLEBAR_HEIGHT - STATUSBAR_HEIGHT;
}

/**
 * The live shell side width, read from the stores. The terminal panel only
 * exists in a document window, which is the one place the rail can show — so
 * the rail's visibility here is exactly `workspaceRailMode`.
 */
export function currentShellSideWidth(): number {
  const ui = useUIStore.getState();
  return shellSideWidth({
    workspaceRailVisible: useSettingsStore.getState().general.workspaceRailMode,
    sidebarVisible: ui.sidebarVisible,
    sidebarWidth: ui.sidebarWidth,
  });
}

/** True when the terminal sits left/right of the editor (resizes by width). */
export function isHorizontalTerminalAxis(pos: EffectiveTerminalPosition): boolean {
  return pos === "left" || pos === "right";
}

/**
 * The explicit position on the opposite side of the same axis — used by the
 * terminal's swap control. bottom↔top, left↔right. Auto resolves to an
 * effective bottom/right first (caller passes the effective position).
 */
export function oppositeTerminalPosition(
  pos: EffectiveTerminalPosition
): Exclude<EffectiveTerminalPosition, never> {
  switch (pos) {
    case "bottom": return "top";
    case "top": return "bottom";
    case "right": return "left";
    case "left": return "right";
  }
}

/**
 * React hook: watches window resize + settings, updates uiStore with
 * effectiveTerminalPosition and computed pixel dimensions.
 */
export function useTerminalPosition() {
  const position = useSettingsStore((s) => s.terminal.position);
  const panelRatio = useSettingsStore((s) => s.terminal.panelRatio);
  const sidebarVisible = useUIStore((s) => s.sidebarVisible);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  // Subscribed, not read via getState(): the panel must re-size when the rail
  // is toggled, exactly as it does for the sidebar.
  const railVisible = useSettingsStore((s) => s.general.workspaceRailMode);
  const currentRef = useRef<EffectiveTerminalPosition>(
    useUIStore.getState().effectiveTerminalPosition
  );

  useEffect(() => {
    const updateAll = () => {
      // 1. Resolve effective position. Explicit top/bottom/left/right are used
      //    as-is. "auto" picks bottom/right by aspect ratio; "auto-flipped"
      //    keeps that smart axis-switching but lands on the opposite end
      //    (right→left, bottom→top). Any corrupt/unknown value falls back to
      //    plain auto.
      const explicit =
        position === "top" || position === "bottom" || position === "left" || position === "right";
      let pos: EffectiveTerminalPosition;
      if (explicit) {
        pos = position;
      } else {
        const computed = computeTerminalPosition(window.innerWidth, window.innerHeight, currentRef.current);
        pos = position === "auto-flipped" ? oppositeTerminalPosition(computed) : computed;
      }

      // 2. Compute pixel dimensions from ratio
      const available = getAvailableDimension(
        pos,
        window.innerWidth,
        window.innerHeight,
        shellSideWidth({ workspaceRailVisible: railVisible, sidebarVisible, sidebarWidth }),
      );
      const height = ratioToPixels(panelRatio, available, TERMINAL_MIN_HEIGHT);
      const width = ratioToPixels(panelRatio, available, TERMINAL_MIN_WIDTH);

      // 3. Batch update uiStore
      const store = useUIStore.getState();
      if (pos !== currentRef.current) {
        currentRef.current = pos;
        store.setEffectiveTerminalPosition(pos);
      }
      if (isHorizontalTerminalAxis(pos)) {
        store.setTerminalWidth(width);
      } else {
        store.setTerminalHeight(height);
      }
    };

    updateAll();

    window.addEventListener("resize", updateAll);
    return () => window.removeEventListener("resize", updateAll);
  }, [position, panelRatio, sidebarVisible, sidebarWidth, railVisible]);
}
