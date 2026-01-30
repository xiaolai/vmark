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

// Track current theme and font size for re-initialization
let mermaidInitialized = false;
let currentTheme: "default" | "dark" = "default";
let currentFontSize: number = 14; // Default fallback

/**
 * Detect if dark mode is active by checking document class
 */
function isDarkMode(): boolean {
  return document.documentElement.classList.contains("dark");
}

/**
 * Get the current mono font size from CSS variable.
 * Falls back to 14px if not set.
 */
function getMonoFontSize(): number {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--editor-font-size-mono")
    .trim();
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 14 : parsed;
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
 * Theme-specific fill and styling variables.
 * These ensure nodes and subgraphs have proper fills in both light and dark modes.
 * Note: fontSize is added dynamically in applyMermaidConfig() from currentFontSize.
 */
const lightThemeVariables = {
  // Node fills
  primaryColor: "#f0f4f8",
  secondaryColor: "#e8f0fe",
  tertiaryColor: "#fff",
  // Subgraph fills
  clusterBkg: "#f5f5f5",
  clusterBorder: "#d5d5d5",
  // Node borders
  nodeBorder: "#9ca3af",
  // Text
  primaryTextColor: "#1a1a1a",
  secondaryTextColor: "#4b5563",
  lineColor: "#6b7280",
};

const darkThemeVariables = {
  // Node fills for dark mode
  primaryColor: "#374151",
  secondaryColor: "#1f2937",
  tertiaryColor: "#111827",
  // Subgraph fills
  clusterBkg: "#1f2937",
  clusterBorder: "#4b5563",
  // Node borders
  nodeBorder: "#6b7280",
  // Text
  primaryTextColor: "#f3f4f6",
  secondaryTextColor: "#d1d5db",
  lineColor: "#9ca3af",
};

/**
 * Initialize Mermaid with current settings.
 * Used internally to apply theme and font size.
 */
function applyMermaidConfig(): void {
  if (!mermaidModule) return;

  const themeVariables = currentTheme === "dark"
    ? { ...darkThemeVariables, fontSize: `${currentFontSize}px` }
    : { ...lightThemeVariables, fontSize: `${currentFontSize}px` };

  mermaidModule.default.initialize({
    startOnLoad: false,
    theme: currentTheme,
    // Use "antiscript" (mermaid's default) to allow inline styles from `style` directives
    // while still sanitizing scripts. "strict" would strip all custom styling.
    securityLevel: "antiscript",
    fontFamily: "inherit",
    fontSize: currentFontSize,
    themeVariables,
  });
}

/**
 * Update Mermaid theme when app theme changes.
 * Call this when theme switches to trigger re-render.
 */
export async function updateMermaidTheme(isDark: boolean): Promise<boolean> {
  const newTheme = isDark ? "dark" : "default";
  if (newTheme !== currentTheme) {
    currentTheme = newTheme;
    applyMermaidConfig();
    return true; // Theme changed
  }
  return false; // No change
}

/**
 * Update Mermaid font size from CSS variable.
 * Call this when editor font size changes to trigger re-render.
 * Returns true if font size changed.
 */
export function updateMermaidFontSize(): boolean {
  const newFontSize = getMonoFontSize();
  if (Math.abs(newFontSize - currentFontSize) > 0.1) {
    currentFontSize = newFontSize;
    applyMermaidConfig();
    return true; // Font size changed
  }
  return false; // No change
}

async function initMermaid(): Promise<void> {
  await loadMermaid();

  if (mermaidInitialized) return;

  currentTheme = isDarkMode() ? "dark" : "default";
  currentFontSize = getMonoFontSize();
  applyMermaidConfig();

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
 * Always syncs font size before rendering to respect current settings.
 */
export async function renderMermaid(
  content: string,
  id?: string
): Promise<string | null> {
  await initMermaid();

  // Always sync font size before rendering to respect current editor settings
  const newFontSize = getMonoFontSize();
  if (Math.abs(newFontSize - currentFontSize) > 0.1) {
    currentFontSize = newFontSize;
    applyMermaidConfig();
  }

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
