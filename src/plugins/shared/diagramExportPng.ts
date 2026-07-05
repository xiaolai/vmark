/**
 * PNG Diagram Export (shared)
 *
 * Purpose: the render-to-PNG-and-save flow shared by the mermaid and
 * graphviz export buttons. Renders the diagram source with an explicit
 * light/dark theme, converts the SVG to a 2x PNG, and saves it via the
 * Tauri dialog. Sits on top of setupDiagramExport (button + theme menu).
 *
 * @coordinates-with mermaid/mermaidExport.ts — mermaid wrapper
 * @coordinates-with graphviz/graphvizExport.ts — graphviz wrapper
 * @module plugins/shared/diagramExportPng
 */

import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { svgToPngBytes } from "@/utils/svgToPng";
import { diagramWarn } from "@/utils/debug";
import {
  setupDiagramExport,
  LIGHT_BG,
  DARK_BG,
  type ExportInstance,
  type ExportTheme,
} from "@/plugins/shared/diagramExport";

/** Renders diagram source for export; null/undefined means "no SVG". */
export type RenderForExport = (
  source: string,
  theme: ExportTheme,
) => Promise<string | null | undefined>;

/**
 * Set up a PNG export button on a diagram container.
 *
 * @param container        The diagram preview wrapper element
 * @param source           The diagram source text (mermaid / DOT / …)
 * @param renderForExport  Theme-explicit SVG renderer for this diagram type
 */
export function setupPngDiagramExport(
  container: HTMLElement,
  source: string,
  renderForExport: RenderForExport,
): ExportInstance {
  return setupDiagramExport(container, async (theme) => {
    const svg = await renderForExport(source, theme);
    if (!svg) {
      diagramWarn("render returned no SVG");
      return;
    }

    const bgColor = theme === "dark" ? DARK_BG : LIGHT_BG;

    let pngData: Uint8Array;
    try {
      pngData = await svgToPngBytes(svg, 2, bgColor);
    } catch (e) {
      diagramWarn("SVG→PNG conversion failed", e);
      return;
    }

    const filePath = await save({
      defaultPath: "diagram.png",
      filters: [{ name: "PNG Image", extensions: ["png"] }],
    });
    if (!filePath) return;

    try {
      await writeFile(filePath, pngData);
    } catch (e) {
      diagramWarn("failed to write file", e);
    }
  });
}
