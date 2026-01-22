/**
 * Mermaid Plugin
 *
 * Adds mermaid diagram support to the editor.
 * Renders ```mermaid code blocks as diagrams.
 * Lazy-loads mermaid library (~2MB) only when first diagram is rendered.
 */

// Lazy-loaded mermaid instance
let mermaidModule: typeof import("mermaid") | null = null;
let mermaidLoadPromise: Promise<typeof import("mermaid")> | null = null;

// Track current theme for re-initialization
let mermaidInitialized = false;
let currentTheme: "default" | "dark" = "default";

/**
 * Detect if dark mode is active by checking document class
 */
function isDarkMode(): boolean {
  return document.documentElement.classList.contains("dark");
}

/**
 * Lazy-load mermaid library
 */
async function loadMermaid(): Promise<typeof import("mermaid")> {
  if (mermaidModule) return mermaidModule;
  if (mermaidLoadPromise) return mermaidLoadPromise;

  mermaidLoadPromise = import("mermaid").then((mod) => {
    mermaidModule = mod;
    return mod;
  });

  return mermaidLoadPromise;
}

/**
 * Update Mermaid theme when app theme changes.
 * Call this when theme switches to trigger re-render.
 */
export async function updateMermaidTheme(isDark: boolean): Promise<boolean> {
  const newTheme = isDark ? "dark" : "default";
  if (newTheme !== currentTheme) {
    currentTheme = newTheme;
    // Only initialize if mermaid was already loaded
    if (mermaidModule) {
      mermaidModule.default.initialize({
        startOnLoad: false,
        theme: newTheme,
        securityLevel: "strict",
        fontFamily: "inherit",
      });
    }
    return true; // Theme changed
  }
  return false; // No change
}

async function initMermaid(): Promise<void> {
  const mod = await loadMermaid();

  if (mermaidInitialized) return;

  currentTheme = isDarkMode() ? "dark" : "default";
  mod.default.initialize({
    startOnLoad: false,
    theme: currentTheme,
    securityLevel: "strict",
    fontFamily: "inherit",
  });

  mermaidInitialized = true;
}

/**
 * Clean up Mermaid's temporary render container.
 * Mermaid creates a container with ID `d${diagramId}` in document.body.
 * This must be removed after rendering to prevent DOM pollution.
 */
function cleanupMermaidContainer(diagramId: string): void {
  const container = document.getElementById(`d${diagramId}`);
  if (container) {
    container.remove();
  }
}

/**
 * Render mermaid diagram content to SVG HTML.
 * Returns null if rendering fails.
 * Lazy-loads mermaid on first call.
 */
export async function renderMermaid(
  content: string,
  id?: string
): Promise<string | null> {
  await initMermaid();

  const diagramId = id ?? `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  try {
    // mermaidModule is guaranteed non-null after initMermaid()
    const { svg } = await mermaidModule!.default.render(diagramId, content);
    // Clean up the temporary container Mermaid creates in document.body
    cleanupMermaidContainer(diagramId);
    return svg;
  } catch (error) {
    // Clean up even on error - Mermaid leaves error displays in the body
    cleanupMermaidContainer(diagramId);
    console.warn("[Mermaid] Failed to render diagram:", error);
    return null;
  }
}

/**
 * Synchronous check if content looks like valid mermaid syntax.
 * Used for quick validation before attempting render.
 */
export function isMermaidSyntax(content: string): boolean {
  const trimmed = content.trim();
  // Common mermaid diagram types
  const diagramTypes = [
    "graph",
    "flowchart",
    "sequenceDiagram",
    "classDiagram",
    "stateDiagram",
    "erDiagram",
    "gantt",
    "pie",
    "gitGraph",
    "mindmap",
    "timeline",
    "quadrantChart",
    "xychart",
    "block-beta",
    "packet-beta",
    "kanban",
    "architecture-beta",
  ];

  return diagramTypes.some(
    (type) =>
      trimmed.startsWith(type) ||
      trimmed.startsWith(`%%{`) // mermaid directives
  );
}
