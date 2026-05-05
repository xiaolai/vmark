// WI-4.2 — IR → SVG / PNG via html-to-image.
//
// Plan §6 Phase 4 + ADR-8. Wrapper over `html-to-image`'s toSvg/toPng,
// applied to the live `@xyflow/react` viewport DOM element.
//
// Behavior verified in Spike B (probes/spike-b-runner.mjs) with 44-75 ms
// timings on a 20-node graph in Chromium, light + dark themes, CSS
// vars resolved correctly. Lossy notes (foreignObject SVG) documented
// in spike-b-export.md.

import { toPng, toSvg } from "html-to-image";

export type ExportFormat = "svg" | "png";

export interface ExportCanvasOptions {
  /**
   * Override the element to capture. Default is `document.querySelector(".react-flow__viewport")`.
   * Useful when exporting from an off-screen mount or a custom canvas.
   */
  element?: HTMLElement | null;
  /** Background color for transparent regions. Defaults to white. */
  backgroundColor?: string;
  /** PNG only: output resolution multiplier. Default 2 (retina). */
  pixelRatio?: number;
  /** Cache-bust the image-src lookups. Default true. */
  cacheBust?: boolean;
}

/**
 * Export the live React Flow canvas to a data URI string.
 *
 *   const url = await exportCanvas("svg");
 *   const url = await exportCanvas("png", { pixelRatio: 3 });
 *
 * Throws a descriptive Error when no viewport element can be found —
 * caller should display a user-readable message rather than crashing.
 */
export async function exportCanvas(
  format: ExportFormat,
  options: ExportCanvasOptions = {},
): Promise<string> {
  const target = resolveTarget(options.element);

  const commonOpts = {
    cacheBust: options.cacheBust ?? true,
    backgroundColor: options.backgroundColor ?? "#ffffff",
  };

  if (format === "svg") {
    return toSvg(target, commonOpts);
  }
  return toPng(target, {
    ...commonOpts,
    pixelRatio: options.pixelRatio ?? 2,
  });
}

function resolveTarget(override: HTMLElement | null | undefined): HTMLElement {
  if (override) return override;
  const el = document.querySelector(".react-flow__viewport");
  if (!el) {
    throw new Error(
      "exportCanvas: no .react-flow__viewport element found. " +
        "Either mount the workflow canvas first, or pass `options.element`.",
    );
  }
  return el as HTMLElement;
}
