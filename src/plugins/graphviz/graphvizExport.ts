/**
 * Graphviz Export
 *
 * Adds a PNG export button to Graphviz diagram containers.
 * Thin wrapper binding the graphviz export renderer to the shared
 * render → PNG → save flow in shared/diagramExportPng.ts.
 */

import { renderGraphvizForExport } from "./index";
import { setupPngDiagramExport } from "@/plugins/shared/diagramExportPng";
import type { ExportInstance } from "@/plugins/shared/diagramExport";

export function setupGraphvizExport(
  container: HTMLElement,
  dotSource: string,
): ExportInstance {
  return setupPngDiagramExport(container, dotSource, renderGraphvizForExport);
}
