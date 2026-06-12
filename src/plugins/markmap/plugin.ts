/**
 * Markmap Plugin
 *
 * Adds markmap mindmap support to the editor.
 * Renders ```markmap code blocks as interactive SVG mindmap trees.
 * Lazy-loads markmap-lib + markmap-view on first render.
 *
 * Unlike Mermaid (which renders to an SVG string), Markmap renders to a live
 * SVG DOM element with built-in D3 pan/zoom/collapse. This means:
 * - WYSIWYG preview: mount a live Markmap instance for interactivity
 * - Export: serialize the SVG element to string, then convert to PNG
 * - No @panzoom/panzoom needed — Markmap has its own pan/zoom
 */

import type { Transformer } from "markmap-lib";
import type { Markmap, IMarkmapOptions } from "markmap-view";
import type { INode } from "markmap-common";
import { registerCleanup } from "@/plugins/shared/diagramCleanup";
import { diagramWarn } from "@/utils/debug";
import "./markmap.css";

// Lazy-loaded module references
let transformerInstance: Transformer | null = null;
let markmapViewModule: typeof import("markmap-view") | null = null;
let loadPromise: Promise<void> | null = null;

// Track active markmap instances for theme re-rendering
const activeInstances = new Map<SVGElement, { mm: Markmap; content: string }>();

// Current theme state
let currentIsDark = false;

/**
 * Detect if dark mode is active by checking document class
 */
function isDarkMode(): boolean {
  const cl = document.documentElement.classList;
  return cl.contains("dark-theme") || cl.contains("dark");
}

/**
 * Get color options for the current theme
 */
function getColorOptions(dark: boolean): Partial<IMarkmapOptions> {
  const lightColors = ["#0969da", "#1a7f37", "#8250df", "#9a6700", "#cf222e", "#0550ae"];
  const darkColors = ["#58a6ff", "#3fb950", "#a371f7", "#d29922", "#f85149", "#79c0ff"];
  const palette = dark ? darkColors : lightColors;

  return {
    color: (node: INode) => {
      const depth = (node.state?.path || "").split(".").length - 1;
      return palette[depth % palette.length];
    },
  };
}

/**
 * Lazy-load markmap-lib and markmap-view
 */
async function loadMarkmap(): Promise<void> {
  if (transformerInstance && markmapViewModule) return;
  if (loadPromise) return loadPromise;

  loadPromise = Promise.all([
    import("markmap-lib"),
    import("markmap-view"),
  ]).then(([lib, view]) => {
    transformerInstance = new lib.Transformer();
    markmapViewModule = view;
  }).catch((err) => {
    loadPromise = null;
    throw err;
  });

  return loadPromise;
}

/**
 * Render markmap content into a live SVG element.
 * Self-registers cleanup via diagramCleanup so callers don't need to
 * track destroy manually.
 *
 * @param svgEl  An SVG element to mount into (must be attached to DOM)
 * @param content  Markdown content with headings
 * @returns Object with fit method, or null on failure
 */
export async function renderMarkmapToElement(
  svgEl: SVGSVGElement,
  content: string,
): Promise<{ fit: () => void } | null> {
  await loadMarkmap();
  if (!transformerInstance || !markmapViewModule) return null;

  const trimmed = content.trim();
  if (!trimmed) return null;

  try {
    const { root } = transformerInstance.transform(trimmed);
    currentIsDark = isDarkMode();
    const options: Partial<IMarkmapOptions> = {
      ...getColorOptions(currentIsDark),
      scrollForPan: true,  // zoom filter rejects plain scroll
      pan: false,          // don't bind wheel→handlePan
    };

    const mm = markmapViewModule.Markmap.create(svgEl, options, root);

    // Disable D3's dblclick-to-zoom so the wrapper's dblclick handler
    // (enter edit mode) can fire without the graph zooming in.
    mm.svg.on("dblclick.zoom", null);

    const existing = activeInstances.get(svgEl);
    if (existing) existing.mm.destroy();
    activeInstances.set(svgEl, { mm, content: trimmed });

    // Self-register cleanup so sweepDetached / cleanupDescendants handle it
    registerCleanup(svgEl, () => {
      activeInstances.delete(svgEl);
      mm.destroy();
    });

    return {
      fit: () => {
        mm.fit();
      },
    };
  } catch (error) {
    diagramWarn("Failed to render mindmap:", error);
    return null;
  }
}

/**
 * Render markmap to an SVG string for export.
 * Creates an off-screen SVG, renders, serializes, then cleans up.
 */
export async function renderMarkmapToSvgString(
  content: string,
  theme: "light" | "dark",
): Promise<string | null> {
  await loadMarkmap();
  if (!transformerInstance || !markmapViewModule) return null;

  const trimmed = content.trim();
  if (!trimmed) return null;

  // Create off-screen container
  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "-9999px";
  container.style.top = "-9999px";
  container.style.width = "800px";
  container.style.height = "600px";
  document.body.appendChild(container);

  const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svgEl.setAttribute("width", "800");
  svgEl.setAttribute("height", "600");
  container.appendChild(svgEl);

  try {
    const { root } = transformerInstance.transform(trimmed);
    const dark = theme === "dark";
    const options: Partial<IMarkmapOptions> = {
      ...getColorOptions(dark),
      duration: 0, // no animation — serialize immediately
    };

    const mm = markmapViewModule.Markmap.create(svgEl, options, root);
    mm.fit();

    // One frame for D3 synchronous layout to apply
    await new Promise((r) => requestAnimationFrame(r));

    // Set background for export
    const bgColor = dark ? "#1e1e1e" : "#ffffff";
    const textColor = dark ? "#e6e6e6" : "#1a1a1a";
    svgEl.style.backgroundColor = bgColor;
    svgEl.style.color = textColor;

    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svgEl);

    mm.destroy();
    return svgString;
  } catch (error) {
    diagramWarn("Failed to render for export:", error);
    return null;
  } finally {
    container.remove();
  }
}

/**
 * Update markmap theme when app theme changes.
 * Re-renders all active instances with new colors.
 * Returns true if theme changed.
 */
export async function updateMarkmapTheme(isDark: boolean): Promise<boolean> {
  if (isDark === currentIsDark) return false;
  currentIsDark = isDark;

  if (!transformerInstance) return false;

  // Re-render all active instances
  for (const [, { mm, content }] of activeInstances) {
    try {
      const { root } = transformerInstance.transform(content);
      const options = getColorOptions(isDark);
      mm.setOptions(options);
      mm.setData(root);
      mm.fit();
    } catch (error) {
      // Keep the instance so future theme changes can retry
      diagramWarn("Failed to update theme for instance:", error);
    }
  }

  return true;
}
