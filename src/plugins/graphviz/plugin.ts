/**
 * Graphviz Plugin
 *
 * Purpose: Renders ```dot / ```graphviz code blocks as diagrams via the
 * Graphviz WASM build (@viz-js/viz). Lazy-loads the library (~1.5 MB)
 * only when the first diagram is rendered — never on the eager path.
 *
 * Key decisions:
 *   - Theme handling mirrors the mermaid plugin's themeVariables approach,
 *     but through Graphviz *default attributes* (equivalent to -G/-N/-E
 *     CLI flags): defaults are overridable by the document, so diagrams
 *     that set their own colors keep them. Live defaults are derived from
 *     the design tokens (shared/diagramThemeTokens.ts), so every app theme
 *     produces theme-native strokes and text; export keeps fixed palettes.
 *   - `bgcolor=transparent` is always set as a graph default so the
 *     preview container's `--bg-secondary` shows through in both themes.
 *   - Tokens are read fresh on every render call (no module-level theme
 *     state): the codePreview theme observer clears the preview cache on
 *     any theme change, and the next render picks up the new tokens.
 *   - Engine selection is native Graphviz: a `layout=<engine>` graph
 *     attribute in the DOT source overrides the `engine` render option
 *     (verified empirically in graphvizEngines.test.ts), so engine choice
 *     travels with the document and no selection UI is needed.
 *
 * @coordinates-with codePreview/renderers/renderGraphvizPreview.ts — WYSIWYG widgets
 * @coordinates-with mermaidPreview/mermaidPreviewRender.ts — Source-mode floating preview
 * @module plugins/graphviz/plugin
 */

import "./graphviz.css";
import { diagramWarn } from "@/utils/debug";
import { errorMessage } from "@/utils/errorMessage";
import { readDiagramThemeTokens } from "@/plugins/shared/diagramThemeTokens";

type VizModule = typeof import("@viz-js/viz");
type VizInstance = Awaited<ReturnType<VizModule["instance"]>>;
type VizRenderOptions = NonNullable<Parameters<VizInstance["render"]>[1]>;

// Lazy-loaded, cached Graphviz WASM instance
let vizInstance: VizInstance | null = null;
let vizLoadPromise: Promise<VizInstance> | null = null;

/** True when either app language is a Graphviz fence (```dot / ```graphviz). */
export function isGraphvizLanguage(language: string): boolean {
  return language === "dot" || language === "graphviz";
}

/**
 * Fixed export palettes ("light"/"dark" PNG export choice). Deliberately NOT
 * token-driven: exports must look the same regardless of the active theme.
 * Applied as Graphviz *defaults*, so explicit colors in the DOT source win.
 */
const DARK_STROKE = "#9ca3af";
const DARK_TEXT = "#f3f4f6";
const DARK_EDGE_TEXT = "#d1d5db";

function buildRenderOptions(theme: "light" | "dark"): VizRenderOptions {
  if (theme === "dark") {
    return {
      format: "svg",
      engine: "dot",
      graphAttributes: {
        bgcolor: "transparent",
        color: DARK_STROKE,
        fontcolor: DARK_TEXT,
      },
      nodeAttributes: { color: DARK_STROKE, fontcolor: DARK_TEXT },
      edgeAttributes: { color: DARK_STROKE, fontcolor: DARK_EDGE_TEXT },
    };
  }
  return {
    format: "svg",
    engine: "dot",
    graphAttributes: { bgcolor: "transparent" },
  };
}

/**
 * Live render options derived from the current design tokens (read fresh on
 * every call). All values are Graphviz *defaults*, so explicit colors in the
 * user's DOT source always win.
 */
function buildLiveRenderOptions(): VizRenderOptions {
  const tokens = readDiagramThemeTokens();
  return {
    format: "svg",
    engine: "dot",
    graphAttributes: {
      bgcolor: "transparent",
      color: tokens.borderColor,
      fontcolor: tokens.textColor,
    },
    nodeAttributes: { color: tokens.textColor, fontcolor: tokens.textColor },
    edgeAttributes: { color: tokens.textSecondary, fontcolor: tokens.textSecondary },
  };
}

/**
 * Lazy-load the Graphviz WASM instance (cached; one load per session).
 * A failed load is not cached: the promise is cleared so a later render
 * can retry instead of bricking Graphviz until reload.
 */
async function loadViz(): Promise<VizInstance> {
  if (vizInstance) return vizInstance;
  if (!vizLoadPromise) {
    const promise: Promise<VizInstance> = import("@viz-js/viz")
      .then(async (mod) => {
        vizInstance = await mod.instance();
        return vizInstance;
      })
      .catch((error) => {
        if (vizLoadPromise === promise) vizLoadPromise = null;
        throw error;
      });
    vizLoadPromise = promise;
  }
  return vizLoadPromise;
}

/** Render DOT source with explicit options. Returns SVG markup or null. */
async function renderWithOptions(
  content: string,
  options: VizRenderOptions,
): Promise<string | null> {
  try {
    const viz = await loadViz();
    const result = viz.render(content, options);
    if (result.status !== "success") {
      const message = result.errors.map((e) => e.message).join("\n");
      diagramWarn("Failed to render Graphviz diagram:", message);
      return null;
    }
    return result.output;
  } catch (error) {
    diagramWarn("Failed to render Graphviz diagram:", errorMessage(error));
    return null;
  }
}

/**
 * Render Graphviz DOT content to SVG markup for the current app theme.
 * Returns null if rendering fails. Lazy-loads @viz-js/viz on first call.
 */
export async function renderGraphviz(content: string): Promise<string | null> {
  return renderWithOptions(content, buildLiveRenderOptions());
}

/**
 * Render Graphviz DOT content with a specific theme for PNG export,
 * independent of the current app theme.
 */
export async function renderGraphvizForExport(
  content: string,
  theme: "light" | "dark",
): Promise<string | null> {
  return renderWithOptions(content, buildRenderOptions(theme));
}
