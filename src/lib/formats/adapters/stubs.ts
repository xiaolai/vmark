// WI-1A.11 — Phase 2-4 format stubs.
//
// Each stub registers extensions, kind, nameI18nKey, and minimum
// adapters so that:
//
//   - getSupportedExtensions() returns the full Phase 1B set
//   - dispatchEditor() routes correctly to a known FormatConfig
//   - Phase 2-4 implementations only have to fill in loadLanguage,
//     validator, genericPreview, schemaDetector, schemaRenderers
//
// Stubs render with raw CodeMirror — full editing/find/undo/save still
// work, but no syntax highlighting, validator gutter, or preview.
//
// Per registry.ts invariant 4 (plan rev 5): non-wysiwyg stubs may omit
// loadLanguage; the SplitPaneEditor renders raw text via SourcePane.

import { registerFormat } from "../registry";
import type { FormatConfig } from "../types";

const dataMenuPolicy = {
  sourceWysiwygToggle: false,
  cjkFormatActions: false,
  insertBlockActions: false,
  paragraphFormatting: false,
} as const;

function makeCodeStub(
  id: string,
  nameI18nKey: string,
  extensions: string[],
  filterName: string,
): FormatConfig {
  return {
    id,
    nameI18nKey,
    extensions,
    kind: "viewer",
    adapters: {
      saveDialogFilters: [{ name: filterName, extensions }],
      untitledExtension: extensions[0],
      exportEnabled: false,
      findEnabled: true,
      searchAdapter: "codemirror",
      contentSearchIndexed: false,
      readOnlyDefault: true,
      reloadPolicy: "reload",
      menuPolicy: dataMenuPolicy,
      closeSavePolicy: "markdown-default",
    },
  };
}

// Phase 2 data formats (json, yaml, toml) graduated to full adapters.
// See src/lib/formats/adapters/{json,yaml,toml}.tsx. The bootstrap in
// src/lib/formats/index.ts registers them before invoking this module.

// Phase 3 visual-render formats (mermaid, svg, html) graduated to
// full adapters. See src/lib/formats/adapters/{mermaid,svg,html}.tsx.
// HTML is marked UNVERIFIED until WI-3.4 sign-off, but the adapter
// ships and dispatches normally.

// Phase 4 — code viewers
export const codeTypescriptStub = makeCodeStub(
  "code-typescript",
  "format.codeTypescript",
  ["ts", "tsx"],
  "TypeScript",
);
export const codeJavascriptStub = makeCodeStub(
  "code-javascript",
  "format.codeJavascript",
  ["js", "jsx"],
  "JavaScript",
);
export const codePythonStub = makeCodeStub(
  "code-python",
  "format.codePython",
  ["py"],
  "Python",
);
export const codeRustStub = makeCodeStub(
  "code-rust",
  "format.codeRust",
  ["rs"],
  "Rust",
);
export const codeGoStub = makeCodeStub(
  "code-go",
  "format.codeGo",
  ["go"],
  "Go",
);
export const codeCssStub = makeCodeStub(
  "code-css",
  "format.codeCss",
  ["css"],
  "CSS",
);
export const codeShellStub = makeCodeStub(
  "code-shell",
  "format.codeShell",
  ["sh", "bash"],
  "Shell",
);
export const codeRubyStub = makeCodeStub(
  "code-ruby",
  "format.codeRuby",
  ["rb"],
  "Ruby",
);
export const codeLuaStub = makeCodeStub(
  "code-lua",
  "format.codeLua",
  ["lua"],
  "Lua",
);

const ALL_STUBS: FormatConfig[] = [
  // Phase 4 — code viewers (still stubs)
  codeTypescriptStub,
  codeJavascriptStub,
  codePythonStub,
  codeRustStub,
  codeGoStub,
  codeCssStub,
  codeShellStub,
  codeRubyStub,
  codeLuaStub,
];

export function registerStubFormats(): void {
  for (const stub of ALL_STUBS) registerFormat(stub);
}
