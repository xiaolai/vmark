/**
 * Mermaid Plugin
 *
 * Adds mermaid diagram support to the editor.
 * Renders ```mermaid code blocks as diagrams.
 */

import mermaid from "mermaid";

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
 * Update Mermaid theme when app theme changes.
 * Call this when theme switches to trigger re-render.
 */
export function updateMermaidTheme(isDark: boolean): boolean {
  const newTheme = isDark ? "dark" : "default";
  if (newTheme !== currentTheme) {
    currentTheme = newTheme;
    mermaid.initialize({
      startOnLoad: false,
      theme: newTheme,
      securityLevel: "strict",
      fontFamily: "inherit",
    });
    return true; // Theme changed
  }
  return false; // No change
}

function initMermaid() {
  if (mermaidInitialized) return;

  currentTheme = isDarkMode() ? "dark" : "default";
  mermaid.initialize({
    startOnLoad: false,
    theme: currentTheme,
    securityLevel: "strict",
    fontFamily: "inherit",
  });

  mermaidInitialized = true;
}

/**
 * Render mermaid diagram content to SVG HTML.
 * Returns null if rendering fails.
 */
export async function renderMermaid(
  content: string,
  id?: string
): Promise<string | null> {
  initMermaid();

  const diagramId = id ?? `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  try {
    const { svg } = await mermaid.render(diagramId, content);
    return svg;
  } catch (error) {
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
