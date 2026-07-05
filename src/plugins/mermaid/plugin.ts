/**
 * Mermaid Plugin
 *
 * Adds mermaid diagram support to the editor.
 * Renders ```mermaid code blocks as diagrams.
 * Lazy-loads mermaid library (~2MB) only when first diagram is rendered.
 */

import "./mermaid.css";
import { diagramWarn } from "@/utils/debug";
import {
  readDiagramThemeTokens,
  serializeDiagramThemeTokens,
} from "@/plugins/shared/diagramThemeTokens";
import { buildMermaidThemeVariables, exportThemeVariables } from "./themeConfig";
import { cleanupMermaidContainer, getMonoFontSize } from "./renderDomUtils";

// Lazy-loaded mermaid instance
let mermaidModule: typeof import("mermaid") | null = null;
let mermaidLoadPromise: Promise<typeof import("mermaid")> | null = null;

// Track the applied config (token snapshot + font size) for re-initialization
let mermaidInitialized = false;
let currentFontSize: number = 14; // Default fallback
let appliedConfigKey: string | null = null;
/** Change-detection twin of appliedConfigKey for the (lock-free) observer path. */
let observedConfigKey: string | null = null;

/**
 * Lazy-load mermaid library.
 * A failed load is not cached: the promise is cleared so a later render
 * can retry (e.g. after a transient chunk-load/network failure).
 */
async function loadMermaid(): Promise<typeof import("mermaid")> {
  if (mermaidModule) return mermaidModule;
  if (mermaidLoadPromise) return mermaidLoadPromise;

  const promise: Promise<typeof import("mermaid")> = import("mermaid").then(
    (mod) => {
      mermaidModule = mod;
      return mod;
    },
    (error) => {
      if (mermaidLoadPromise === promise) mermaidLoadPromise = null;
      throw error;
    }
  );
  mermaidLoadPromise = promise;

  return mermaidLoadPromise;
}

/**
 * Serializes renders that depend on Mermaid's GLOBAL config
 * (`mermaid.initialize` mutates shared library state). Export renders
 * temporarily switch that config, so a live render running concurrently
 * could otherwise pick up the export theme mid-flight.
 */
let renderLock: Promise<unknown> = Promise.resolve();

function withRenderLock<T>(task: () => Promise<T>): Promise<T> {
  const run = renderLock.then(task, task);
  // The lock itself never rejects; callers still see their own errors via `run`.
  renderLock = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/** Current config key: token snapshot + font size. Read fresh per call. */
function computeConfigKey(): string {
  return `${serializeDiagramThemeTokens(readDiagramThemeTokens())}|${currentFontSize}`;
}

/**
 * Initialize Mermaid with the current design tokens and settings.
 *
 * Uses mermaid's "base" theme with themeVariables derived from the app's
 * design tokens (see themeConfig.ts) so diagrams are theme-native in every
 * app theme; dark output is a token-derived outcome, not a special case.
 *
 * fontSize is set to the editor's mono font size so mermaid renders text
 * at the correct size directly. CSS zoom is NOT used (--mermaid-scale is 1)
 * to avoid double-scaling. Mermaid's default flowchart padding/wrapping
 * are left untouched so its node-sizing algorithm stays accurate.
 */
function applyMermaidConfig(): void {
  const key = computeConfigKey();
  if (!mermaidModule) {
    appliedConfigKey = observedConfigKey = key;
    return;
  }

  const tokens = readDiagramThemeTokens();
  const themeVariables = buildMermaidThemeVariables(tokens, currentFontSize);

  mermaidModule.default.initialize({
    startOnLoad: false,
    theme: "base",
    // Use "antiscript" (mermaid's default) to allow inline styles from `style` directives
    // while still sanitizing scripts. "strict" would strip all custom styling.
    securityLevel: "antiscript",
    fontFamily: tokens.fontMono,
    fontSize: currentFontSize,
    themeVariables,
  });
  // Mark applied only AFTER a successful initialize — marking first would
  // make the next render skip the re-apply and run on a broken config.
  // Applied implies "observed" so the theme observer doesn't re-report it.
  appliedConfigKey = observedConfigKey = key;
}

/**
 * Re-read the design tokens and report whether they changed.
 * Called by the theme observer on any theme change (class or token flip).
 *
 * Pure change detection — deliberately does NOT touch mermaid config:
 * `mermaid.initialize` outside the render lock could race an in-flight
 * (export) render. Config is applied lazily by the next locked render,
 * which re-checks `appliedConfigKey` itself.
 */
export async function updateMermaidTheme(): Promise<boolean> {
  const key = computeConfigKey();
  if (key === observedConfigKey) return false; // No change
  observedConfigKey = key;
  return true; // Theme changed
}

/**
 * Update Mermaid font size from CSS variable.
 * Call this when editor font size changes to trigger re-render.
 * Returns true if font size changed. Like updateMermaidTheme, this only
 * records state — the next locked render applies the new config.
 */
export function updateMermaidFontSize(): boolean {
  const newFontSize = getMonoFontSize();
  if (Math.abs(newFontSize - currentFontSize) > 0.1) {
    currentFontSize = newFontSize;
    return true; // Font size changed
  }
  return false; // No change
}

async function initMermaid(): Promise<void> {
  await loadMermaid();

  if (mermaidInitialized) return;

  // No config application here: the first locked render sees the null
  // `appliedConfigKey`, mismatches, and applies config under the lock.
  currentFontSize = getMonoFontSize();
  mermaidInitialized = true;
}

/**
 * Render mermaid diagram content to SVG HTML.
 * Returns null if rendering fails.
 * Lazy-loads mermaid on first call.
 * Syncs font size before rendering to respect current settings.
 */
export async function renderMermaid(
  content: string,
  id?: string
): Promise<string | null> {
  try {
    await initMermaid();
  } catch (error) {
    // Null-on-failure contract: a failed load/init must not throw.
    diagramWarn("Failed to initialize mermaid:", error);
    return null;
  }

  return withRenderLock(async () => {
    // Sync tokens + font size before rendering so every render reflects the
    // current theme and editor settings (tokens are re-read, never captured).
    currentFontSize = getMonoFontSize();

    const diagramId =
      id ?? `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    try {
      if (appliedConfigKey !== computeConfigKey()) {
        applyMermaidConfig();
      }
      // mermaidModule is guaranteed non-null after initMermaid()
      const { svg } = await mermaidModule!.default.render(diagramId, content);
      return svg;
    } catch (error) {
      diagramWarn("Failed to render diagram:", error);
      return null;
    } finally {
      // Clean up the temporary container Mermaid creates in document.body
      // (on error it leaves error displays there too).
      cleanupMermaidContainer(diagramId);
    }
  });
}

/**
 * Render mermaid diagram with a specific theme for PNG export.
 * Uses a concrete font stack (SVG-as-image can't inherit from document).
 * Temporarily switches theme, renders, then restores.
 */
export async function renderMermaidForExport(
  content: string,
  theme: "light" | "dark"
): Promise<string | null> {
  try {
    await initMermaid();
  } catch (error) {
    // Null-on-failure contract: a failed load/init must not throw.
    diagramWarn("Failed to initialize mermaid:", error);
    return null;
  }

  return withRenderLock(async () => {
    const exportTheme = theme === "dark" ? "dark" : "default";
    const themeVars = {
      ...exportThemeVariables[theme === "dark" ? "dark" : "light"],
      fontSize: `${currentFontSize}px`,
    };

    const diagramId = `export-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    try {
      mermaidModule!.default.initialize({
        startOnLoad: false,
        theme: exportTheme,
        securityLevel: "antiscript",
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        fontSize: currentFontSize,
        themeVariables: themeVars,
      });
      const { svg } = await mermaidModule!.default.render(diagramId, content);
      return svg;
    } catch (error) {
      diagramWarn("Failed to render export diagram:", error);
      return null;
    } finally {
      cleanupMermaidContainer(diagramId);
      // ALWAYS restore the live token-driven config for subsequent in-app
      // renders — even when the export initialize/render threw.
      try {
        applyMermaidConfig();
      } catch (error) {
        diagramWarn("Failed to restore mermaid config after export:", error);
      }
    }
  });
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
