/**
 * Drop-path filtering and extension utilities.
 *
 * Pipeline: drag-drop event / file explorer / tab title → check by
 * extension → keep or strip.
 *
 * Phase 1B (WI-1B.3) replaced the legacy MARKDOWN_EXTENSIONS blob
 * (which conflated markdown with .txt) with two distinct concepts:
 *
 *   - `MARKDOWN_ONLY_EXTENSIONS`: the five canonical markdown
 *     extensions (.md/.markdown/.mdown/.mkd/.mdx). Use for
 *     markdown-adapter-specific checks.
 *   - `getSupportedExtensionsWithDots()`: every registered format's
 *     extension, sourced from the format registry. Use for "is this
 *     a file VMark can open."
 *
 * @coordinates-with src/lib/formats/registry.ts — getSupportedExtensions
 * @module utils/dropPaths
 */

import { getSupportedExtensions } from "@/lib/formats/registry";

/** The five canonical markdown extensions (markdown adapter only). */
export const MARKDOWN_ONLY_EXTENSIONS = [
  ".md",
  ".markdown",
  ".mdown",
  ".mkd",
  ".mdx",
] as const;

/** Supported YAML file extensions (lowercase). */
export const YAML_EXTENSIONS = [".yml", ".yaml"] as const;

/** Pre-bootstrap fallback so callers running before main.tsx finishes
 *  (tests, early-load races) still recognize markdown-family files. */
const BOOTSTRAP_FALLBACK_EXTENSIONS = [
  ...MARKDOWN_ONLY_EXTENSIONS,
  ".txt",
  ...YAML_EXTENSIONS,
] as const;

/**
 * Every registered format's extension, dot-prefixed and lowercased.
 * Sourced from the format registry; falls back to a markdown-family
 * blob when the registry is empty (pre-bootstrap edge cases).
 */
export function getSupportedExtensionsWithDots(): readonly string[] {
  const registered = getSupportedExtensions();
  /* v8 ignore next 3 -- @preserve registry-empty fallback exercised by an explicit test */
  if (registered.length === 0) {
    return BOOTSTRAP_FALLBACK_EXTENSIONS;
  }
  return registered.map((ext) => `.${ext.toLowerCase()}`);
}

/** True iff `name` ends with a registered format's extension. */
export function isSupportedFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return getSupportedExtensionsWithDots().some((ext) => lower.endsWith(ext));
}

/** True iff `name` ends with one of the strict markdown extensions. */
export function isMarkdownFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return MARKDOWN_ONLY_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** True iff `name` ends with .yml or .yaml. */
export function isYamlFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return YAML_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** True iff `name` is markdown OR YAML — first-class VMark file types. */
export function isVMarkFileName(name: string): boolean {
  return isMarkdownFileName(name) || isYamlFileName(name);
}

/** Strip any registered extension off `name`. */
export function stripSupportedExtension(name: string): string {
  const lower = name.toLowerCase();
  for (const ext of getSupportedExtensionsWithDots()) {
    if (lower.endsWith(ext)) {
      return name.slice(0, -ext.length);
    }
  }
  return name;
}

/**
 * Filter to paths whose extension is registered. Replaces the legacy
 * `filterMarkdownPaths` for callers that want every supported format.
 */
export function filterSupportedPaths(
  paths: string[] | null | undefined,
): string[] {
  /* v8 ignore next -- @preserve null/undefined defensive branch */
  if (!paths || !Array.isArray(paths)) return [];
  const exts = getSupportedExtensionsWithDots();
  return paths.filter((path) => {
    const lower = path.toLowerCase();
    return exts.some((ext) => lower.endsWith(ext));
  });
}

/**
 * Filter to strict markdown-only paths. Used by callers that genuinely
 * mean "markdown editor candidates" (vs. any supported format).
 */
export function filterMarkdownPaths(
  paths: string[] | null | undefined,
): string[] {
  /* v8 ignore next -- @preserve null/undefined defensive branch */
  if (!paths || !Array.isArray(paths)) return [];
  return paths.filter((path) => isMarkdownFileName(path));
}
