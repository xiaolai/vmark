/**
 * Mermaid Export
 *
 * Adds a PNG export button to mermaid diagram containers.
 * Thin wrapper binding the mermaid export renderer to the shared
 * render → PNG → save flow in shared/diagramExportPng.ts.
 */

import { renderMermaidForExport } from "./index";
import { setupPngDiagramExport } from "@/plugins/shared/diagramExportPng";
import type { ExportInstance } from "@/plugins/shared/diagramExport";

export function setupMermaidExport(
  container: HTMLElement,
  mermaidSource: string,
): ExportInstance {
  return setupPngDiagramExport(container, mermaidSource, renderMermaidForExport);
}
