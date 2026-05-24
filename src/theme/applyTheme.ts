/**
 * applyTheme — writes ThemeTokens to CSS custom properties at runtime.
 *
 * ADR-014: tokens are typed data; CSS variables are the runtime delivery
 * mechanism. This helper walks the ThemeTokens structure and emits
 * `--{path-in-kebab-case}` CSS vars on the target element (default:
 * documentElement).
 *
 * Adoption is incremental — `useTheme.ts` continues to set legacy CSS
 * vars; this helper is consumed by code that wants the typed pathway.
 *
 * @module theme/applyTheme
 */

import type { ThemeTokens } from "./tokens";

type Entries = Array<[string, string]>;

function flatten(prefix: string, obj: Record<string, unknown>, out: Entries) {
  for (const [key, value] of Object.entries(obj)) {
    const cssName = `${prefix}-${key.replace(/([A-Z])/g, "-$1").toLowerCase()}`;
    if (typeof value === "string" || typeof value === "number") {
      out.push([cssName, String(value)]);
    } else if (value && typeof value === "object") {
      flatten(cssName, value as Record<string, unknown>, out);
    }
  }
}

/** Convert a ThemeTokens object into an array of [cssVarName, value] pairs. */
export function tokensToCssEntries(theme: ThemeTokens): Entries {
  const out: Entries = [];
  flatten("--", theme as unknown as Record<string, unknown>, out);
  // strip the leading "--" added by the prefix machinery + the joining hyphen
  return out.map(([k, v]) => [k.replace(/^---/, "--"), v]);
}

/** Write theme tokens to CSS custom properties on the target element. */
export function applyTheme(theme: ThemeTokens, target: HTMLElement = document.documentElement) {
  for (const [name, value] of tokensToCssEntries(theme)) {
    target.style.setProperty(name, value);
  }
}
