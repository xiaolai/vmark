// WI-1A.5 — Format registry bootstrap.
//
// Single side-effect-free entry point that registers every adapter at
// app start. Imported once from src/main.tsx; tests register what they
// need à la carte via the per-adapter `registerXFormat()` exports.

import { registerMarkdownFormat } from "./adapters/markdown";
import { registerTxtFormat } from "./adapters/txt";
import { registerJsonFormat } from "./adapters/json";
import { registerYamlFormat } from "./adapters/yaml";
import { registerTomlFormat } from "./adapters/toml";
import { registerMermaidFormat } from "./adapters/mermaid";
import { registerSvgFormat } from "./adapters/svg";
import { registerHtmlFormat } from "./adapters/html";
import { registerCodeFormats } from "./adapters/code";

let bootstrapped = false;

export function bootstrapFormats(): void {
  if (bootstrapped) return;
  // Phase 1A — markdown + txt
  registerMarkdownFormat();
  registerTxtFormat();
  // Phase 2 — full data-format adapters
  registerJsonFormat();
  registerYamlFormat();
  registerTomlFormat();
  // Phase 3 — visual-render adapters (mermaid + svg fully verified;
  // HTML adapter ships in code but the iframe-sandbox + DOMPurify
  // defense-in-depth requires manual XSS sign-off per WI-3.4 — see
  // dev-docs/grills/multi-format/security-review-html.md).
  registerMermaidFormat();
  registerSvgFormat();
  registerHtmlFormat();
  // Phase 4 — code-viewer adapters (read-only-default per ADR-3,
  // editing toggle via WI-4.3, "Open in external editor" via WI-4.4).
  registerCodeFormats();
  bootstrapped = true;
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
