// WI-1A.5 — Format registry bootstrap.
//
// Single side-effect entry point that registers every adapter at app
// start. Markdown, plain text, and YAML/YML are ALWAYS registered
// (markdown is the core product; YAML shipped on by default in the
// previous release with the GHA workflow viewer — reverting that
// breaks the contract). Every other adapter is gated by a per-category
// toggle in `settings.formats.*`.
//
// Default behavior with no toggles argument: register everything.
// Production main.tsx passes the user's settings explicitly so
// upgraders see a calm experience (only md/txt/yaml on first launch).
// Tests typically need every format and call `bootstrapFormats()` (no
// args) for the all-on shape.

import { registerMarkdownFormat } from "./adapters/markdown";
import { registerTxtFormat } from "./adapters/txt";
import { registerJsonFormat } from "./adapters/json";
import { registerYamlFormat } from "./adapters/yaml";
import { registerTomlFormat } from "./adapters/toml";
import { registerMermaidFormat } from "./adapters/mermaid";
import { registerSvgFormat } from "./adapters/svg";
import { registerHtmlFormat } from "./adapters/html";
import { registerCodeFormats } from "./adapters/code";
import { __resetRegistry } from "./registry";

/** Per-category toggles for opt-in format registration. Markdown, txt,
 *  and yaml are always on; everything else is opt-in. */
export interface FormatsToggles {
  /** `.json` / `.jsonl` / `.toml` — split-pane source + tree. */
  dataFormats: boolean;
  /** `.mmd` / `.svg` — source + sanitized render. */
  diagrams: boolean;
  /** `.html` / `.htm` — sandboxed iframe + DOMPurify + CSP. */
  htmlPreview: boolean;
  /** Code viewers (read-only): 9 adapters covering 12 extensions
   *  (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`, `.go`, `.css`, `.sh`,
   *  `.bash`, `.rb`, `.lua`). */
  codeViewers: boolean;
}

let bootstrapped = false;

/**
 * Register format adapters. Markdown, txt, and yaml always register;
 * data/diagrams/html/code categories are opt-in via `toggles`. When
 * `toggles` is undefined, every category defaults to ON (preserves
 * pre-rebrand behavior for tests + any caller that doesn't pass
 * settings). Production callers should always pass real settings so
 * the user's opt-in choices take effect.
 */
export function bootstrapFormats(toggles?: Partial<FormatsToggles>): void {
  if (bootstrapped) return;
  const t: FormatsToggles = {
    dataFormats: toggles?.dataFormats ?? true,
    diagrams: toggles?.diagrams ?? true,
    htmlPreview: toggles?.htmlPreview ?? true,
    codeViewers: toggles?.codeViewers ?? true,
  };

  // Always-on core trio.
  registerMarkdownFormat();
  registerTxtFormat();
  registerYamlFormat();

  // Phase 2 — data formats (json + jsonl + toml). YAML is in the
  // always-on set so the GHA workflow viewer keeps working regardless.
  if (t.dataFormats) {
    registerJsonFormat();
    registerTomlFormat();
  }

  // Phase 3 — visual-render adapters (mermaid + svg).
  if (t.diagrams) {
    registerMermaidFormat();
    registerSvgFormat();
  }

  // Phase 3 — HTML adapter (sandboxed; OWASP-verified per WI-3.4 / 2026-05-07).
  if (t.htmlPreview) {
    registerHtmlFormat();
  }

  // Phase 4 — code viewers (read-only-default per ADR-3, editing
  // toggle via WI-4.3, "Open in external editor" via WI-4.4).
  if (t.codeViewers) {
    registerCodeFormats();
  }

  bootstrapped = true;
}

/**
 * Reset and re-bootstrap with new toggles. Used when the user flips
 * a Format-support setting at runtime; the registry must be rebuilt
 * because each adapter's category-level "register" call is the only
 * place that touches the byId / byExt maps.
 *
 * Existing tabs whose extension matches a newly-disabled format will
 * fall back to the plain-text adapter (`txt` is in the always-on set,
 * which is what `dispatchEditor()` uses as the unknown-extension
 * fallback). The Editor.tsx remount key (`${tabId}-${formatId}`) picks
 * up the change automatically once each tab's `formatId` is recomputed
 * via `useTabStore.getState().recomputeAllFormatIds()`.
 */
export function rebootstrapFormats(toggles?: Partial<FormatsToggles>): void {
  __resetRegistry();
  bootstrapped = false;
  bootstrapFormats(toggles);
}

/** Test-only — never call from production code. */
export function __resetBootstrap(): void {
  bootstrapped = false;
}

// Re-export the registry surface for callers that just want the lookups.
export {
  dispatchEditor,
  getFormatById,
  listFormats,
  getSupportedExtensions,
  registerFormat,
} from "./registry";
export type {
  FormatConfig,
  FormatKind,
  FormatAdapters,
  ValidationDiagnostic,
  Validator,
  SchemaDetector,
  PreviewRenderer,
  PreviewRendererProps,
  TabFormatState,
} from "./types";
