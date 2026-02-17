/**
 * useTerminalPosition
 *
 * Purpose: Auto-reposition the terminal panel based on window aspect ratio.
 * Landscape windows (ratio >= 1.5) place the terminal on the right;
 * portrait windows (ratio <= 0.85) keep it at the bottom. In the ambiguous
 * zone a width threshold with 50px hysteresis prevents oscillation.
 *
 * Exports a pure `computeTerminalPosition()` for testing and a React hook
 * `useTerminalPosition()` that wires it to window resize events and settings.
 *
 * @coordinates-with settingsStore — reads terminal.position preference
 * @coordinates-with uiStore — writes effectiveTerminalPosition
 * @module components/Terminal/useTerminalPosition
 */

import { useEffect, useRef } from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUIStore, type EffectiveTerminalPosition } from "@/stores/uiStore";

// Width threshold for the ambiguous aspect-ratio zone
const WIDTH_THRESHOLD = 1440;
const HYSTERESIS_PX = 50;

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
 * React hook: watches window resize + settings, updates uiStore.effectiveTerminalPosition.
 */
export function useTerminalPosition() {
  const position = useSettingsStore((s) => s.terminal.position);
  const currentRef = useRef<EffectiveTerminalPosition>(
    useUIStore.getState().effectiveTerminalPosition
  );

  useEffect(() => {
    const setPos = useUIStore.getState().setEffectiveTerminalPosition;

    // Manual override — set directly, no resize listener needed
    if (position === "bottom" || position === "right") {
      currentRef.current = position;
      setPos(position);
      return;
    }

    // Auto mode — compute from window dimensions
    const update = () => {
      const next = computeTerminalPosition(
        window.innerWidth,
        window.innerHeight,
        currentRef.current
      );
      if (next !== currentRef.current) {
        currentRef.current = next;
        setPos(next);
      }
    };

    // Initial computation
    update();

    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [position]);
}
