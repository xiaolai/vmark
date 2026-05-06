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
import { registerStubFormats } from "./adapters/stubs";

let bootstrapped = false;

export function bootstrapFormats(): void {
  if (bootstrapped) return;
  // Phase 1A — markdown + txt
  registerMarkdownFormat();
  registerTxtFormat();
  // Phase 2 — full data-format adapters (replaces the stubs that
  // Phase 1A registered for these ids; stubs.ts now only registers
  // the Phase 3 + Phase 4 formats).
  registerJsonFormat();
  registerYamlFormat();
  registerTomlFormat();
  // Phase 3 + 4 stubs — remaining formats not yet implemented.
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
