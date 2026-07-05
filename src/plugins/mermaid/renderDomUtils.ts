/**
 * Pure DOM helpers for the mermaid render pipeline.
 *
 * Purpose: keep plugin.ts focused on load/lock/config/render orchestration;
 * these helpers read or clean the document without touching mermaid state.
 *
 * @coordinates-with plugin.ts — sole consumer
 */

/**
 * Get the current mono font size from CSS variable.
 * Falls back to 14px if not set.
 */
export function getMonoFontSize(): number {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--editor-font-size-mono")
    .trim();
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 14 : parsed;
}

/**
 * Clean up the temporary render container Mermaid creates in document.body
 * (on error it leaves error displays there too). Must run after every
 * render to prevent DOM pollution.
 */
export function cleanupMermaidContainer(diagramId: string): void {
  const container = document.getElementById(`d${diagramId}`);
  if (container) {
    container.remove();
  }
}
