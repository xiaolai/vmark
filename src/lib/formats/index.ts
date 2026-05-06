// WI-1A.5 — Format registry bootstrap.
//
// Single side-effect-free entry point that registers every adapter at
// app start. Imported once from src/main.tsx; tests register what they
// need à la carte via the per-adapter `registerXFormat()` exports.

import { registerMarkdownFormat } from "./adapters/markdown";
import { registerTxtFormat } from "./adapters/txt";
import { registerStubFormats } from "./adapters/stubs";

let bootstrapped = false;

export function bootstrapFormats(): void {
  if (bootstrapped) return;
  registerMarkdownFormat();
  registerTxtFormat();
  registerStubFormats();
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
