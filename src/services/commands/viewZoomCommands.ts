/**
 * Editor zoom commands — split out of `viewCommands.ts` (audit #942), which was
 * one 229-line builder against a file sitting 14 lines under the size cap.
 *
 * Zoom is the one view command family with real ARITHMETIC in it, and the
 * arithmetic is the part that has already been wrong: the step must be
 * MONOTONIC. Keeping it here puts the rule, its bounds and its reasoning in one
 * readable unit rather than three paragraphs inside a list of toggles.
 *
 * @coordinates-with src/services/commands/viewCommands.ts — registers these in its batch
 * @coordinates-with src/stores/settingsStore — `appearance.fontSize`, clamped to [8, 48]
 * @module services/commands/viewZoomCommands
 */
import i18n from "@/i18n";
import type { CommandDefinition } from "./CommandBus";
import { useSettingsStore } from "@/stores/settingsStore";

const DEFAULT_FONT_SIZE = 18;
export const MIN_FONT_SIZE = 12;
export const MAX_FONT_SIZE = 32;
export const FONT_SIZE_STEP = 2;

/**
 * One zoom step, clamped so it can STOP at the bound but never reverse
 * (audit #941).
 *
 * The zoom bounds are narrower than the store's valid range for
 * `appearance.fontSize` (`clamp.ts`: [8, 48]), so a font size can legitimately
 * sit outside them — set by another surface, or restored from a session. A
 * bare `Math.min(current + step, MAX)` then SHRANK the text on Zoom In above
 * MAX, and `Math.max(current - step, MIN)` GREW it on Zoom Out below MIN.
 */
export function zoomStep(current: number, step: number, bound: number): number {
  const stepped = step > 0
    ? Math.min(current + step, bound)
    : Math.max(current + step, bound);
  return step > 0 ? Math.max(current, stepped) : Math.min(current, stepped);
}

function setFontSize(size: number): void {
  useSettingsStore.getState().updateAppearanceSetting("fontSize", size);
}

/** The zoom command specs (pure — no registration). */
export function zoomCommandSpecs(): CommandDefinition[] {
  return [
    {
      id: "view.zoomActual",
      title: () => i18n.t("commands:view.zoomActual"),
      category: "view",
      run: () => setFontSize(DEFAULT_FONT_SIZE),
    },
    {
      id: "view.zoomIn",
      title: () => i18n.t("commands:view.zoomIn"),
      category: "view",
      run: () =>
        setFontSize(
          zoomStep(useSettingsStore.getState().appearance.fontSize, FONT_SIZE_STEP, MAX_FONT_SIZE),
        ),
    },
    {
      id: "view.zoomOut",
      title: () => i18n.t("commands:view.zoomOut"),
      category: "view",
      run: () =>
        setFontSize(
          zoomStep(useSettingsStore.getState().appearance.fontSize, -FONT_SIZE_STEP, MIN_FONT_SIZE),
        ),
    },
  ];
}
