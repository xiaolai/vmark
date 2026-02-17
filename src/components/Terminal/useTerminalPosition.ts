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
 * multiplied by the available container dimension, clamped to min/max.
 *
 * Exports a pure `computeTerminalPosition()` for testing and a React hook
 * `useTerminalPosition()` that wires it to window resize events and settings.
 *
 * @coordinates-with settingsStore — reads terminal.position and terminal.panelRatio
 * @coordinates-with uiStore — writes effectiveTerminalPosition, terminalHeight, terminalWidth
 * @module components/Terminal/useTerminalPosition
 */

import { useEffect, useRef } from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  useUIStore,
  type EffectiveTerminalPosition,
  TERMINAL_MIN_HEIGHT,
  TERMINAL_MAX_HEIGHT,
  TERMINAL_MIN_WIDTH,
  TERMINAL_MAX_WIDTH,
} from "@/stores/uiStore";

// Width threshold for the ambiguous aspect-ratio zone
const WIDTH_THRESHOLD = 1440;
const HYSTERESIS_PX = 50;

// Layout constants — must match App.tsx TITLEBAR_HEIGHT and bottom bar height
const TITLEBAR_HEIGHT = 40;
const STATUSBAR_HEIGHT = 40;

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
 * Compute pixel dimension from ratio, clamped to min/max.
 */
function ratioToPixels(
  ratio: number,
  availableDimension: number,
  min: number,
  max: number
): number {
  return Math.round(Math.min(max, Math.max(min, availableDimension * ratio)));
}

/**
 * Compute ratio from pixel dimension.
 */
export function pixelsToRatio(pixels: number, availableDimension: number): number {
  if (availableDimension <= 0) return 0.4;
  // Clamp ratio to 0.1–0.8
  return Math.min(0.8, Math.max(0.1, pixels / availableDimension));
}

/**
 * Pure function: compute available dimension for the terminal panel.
 * - Bottom: windowHeight minus titlebar and statusbar
 * - Right: windowWidth minus sidebar (if visible)
 */
export function getAvailableDimension(
  pos: EffectiveTerminalPosition,
  windowW: number,
  windowH: number,
  sidebarVisible: boolean,
  sidebarW: number
): number {
  if (pos === "right") {
    const offset = sidebarVisible ? sidebarW : 0;
    return windowW - offset;
  }
  return windowH - TITLEBAR_HEIGHT - STATUSBAR_HEIGHT;
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
  const currentRef = useRef<EffectiveTerminalPosition>(
    useUIStore.getState().effectiveTerminalPosition
  );

  useEffect(() => {
    const updateAll = () => {
      // 1. Resolve effective position
      let pos: EffectiveTerminalPosition;
      if (position === "bottom" || position === "right") {
        pos = position;
      } else {
        pos = computeTerminalPosition(
          window.innerWidth,
          window.innerHeight,
          currentRef.current
        );
      }

      // 2. Compute pixel dimensions from ratio
      const available = getAvailableDimension(pos, window.innerWidth, window.innerHeight, sidebarVisible, sidebarWidth);
      const height = ratioToPixels(panelRatio, available, TERMINAL_MIN_HEIGHT, TERMINAL_MAX_HEIGHT);
      const width = ratioToPixels(panelRatio, available, TERMINAL_MIN_WIDTH, TERMINAL_MAX_WIDTH);

      // 3. Batch update uiStore
      const store = useUIStore.getState();
      if (pos !== currentRef.current) {
        currentRef.current = pos;
        store.setEffectiveTerminalPosition(pos);
      }
      if (pos === "right") {
        store.setTerminalWidth(width);
      } else {
        store.setTerminalHeight(height);
      }
    };

    updateAll();

    window.addEventListener("resize", updateAll);
    return () => window.removeEventListener("resize", updateAll);
  }, [position, panelRatio, sidebarVisible, sidebarWidth]);
}
