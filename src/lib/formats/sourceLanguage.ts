/**
 * Source-pane syntax highlighting by filename.
 *
 * This is the highlighting LAYER, deliberately separate from routing. A
 * file routes to the plain-text (`txt`) format via `dispatchEditor`, then
 * the source pane asks here whether it can colorize it. Highlighting can
 * never change which editor a file gets — it only picks a CodeMirror
 * language for an already-decided source pane. So enabling rich colors
 * for `.env` / `Dockerfile` / `.sh` carries zero risk of re-rendering a
 * non-markdown file as markdown.
 *
 * Independent of the code-viewer FORMAT toggle: the npm language packages
 * ship regardless of whether the user enabled the read-only code viewers,
 * so a plain-text tab still gets nice highlighting.
 *
 * @coordinates-with components/Editor/SplitPaneEditor/SourcePane.tsx — applies the loader
 * @coordinates-with lib/formats/registry.ts — formatLookupKeys for key matching
 * @module lib/formats/sourceLanguage
 */

import type { Extension } from "@codemirror/state";
import { formatLookupKeys } from "./registry";

export type SourceLanguageLoader = () => Promise<Extension>;

const loadJavascript: SourceLanguageLoader = async () => {
  const { javascript } = await import("@codemirror/lang-javascript");
  return javascript({ jsx: true });
};
const loadTypescript: SourceLanguageLoader = async () => {
  const { javascript } = await import("@codemirror/lang-javascript");
  return javascript({ jsx: true, typescript: true });
};
const loadPython: SourceLanguageLoader = async () => {
  const { python } = await import("@codemirror/lang-python");
  return python();
};
const loadRust: SourceLanguageLoader = async () => {
  const { rust } = await import("@codemirror/lang-rust");
  return rust();
};
const loadGo: SourceLanguageLoader = async () => {
  const { go } = await import("@codemirror/lang-go");
  return go();
};
const loadCss: SourceLanguageLoader = async () => {
  const { css } = await import("@codemirror/lang-css");
  return css();
};
const loadJson: SourceLanguageLoader = async () => {
  const { json } = await import("@codemirror/lang-json");
  return json();
};
const loadYaml: SourceLanguageLoader = async () => {
  const { yaml } = await import("@codemirror/lang-yaml");
  return yaml();
};

/** Build a StreamLanguage loader from a legacy-mode import. */
function legacy(
  importMode: () => Promise<Record<string, unknown>>,
  modeKey: string,
): SourceLanguageLoader {
  return async () => {
    const [{ StreamLanguage }, mod] = await Promise.all([
      import("@codemirror/language"),
      importMode(),
    ]);
    // Legacy modes export the parser under a named key (e.g. `shell`,
    // `properties`, `dockerFile`). Every mode this module references
    // exports its named key, so the `mod.default` arm is a defensive
    // fallback for a future mode that doesn't — not reachable today.
    /* v8 ignore next -- @preserve defensive fallback; all current modes export their named key */
    const parser = (mod[modeKey] ?? mod.default) as Parameters<
      typeof StreamLanguage.define
    >[0];
    return StreamLanguage.define(parser);
  };
}

const loadShell = legacy(
  () => import("@codemirror/legacy-modes/mode/shell"),
  "shell",
);
const loadRuby = legacy(
  () => import("@codemirror/legacy-modes/mode/ruby"),
  "ruby",
);
const loadLua = legacy(() => import("@codemirror/legacy-modes/mode/lua"), "lua");
const loadToml = legacy(
  () => import("@codemirror/legacy-modes/mode/toml"),
  "toml",
);
const loadProperties = legacy(
  () => import("@codemirror/legacy-modes/mode/properties"),
  "properties",
);
const loadDockerfile = legacy(
  () => import("@codemirror/legacy-modes/mode/dockerfile"),
  "dockerFile",
);
const loadSql = legacy(
  () => import("@codemirror/legacy-modes/mode/sql"),
  "standardSQL",
);
const loadDiff = legacy(
  () => import("@codemirror/legacy-modes/mode/diff"),
  "diff",
);
const loadNginx = legacy(
  () => import("@codemirror/legacy-modes/mode/nginx"),
  "nginx",
);
const loadPowershell = legacy(
  () => import("@codemirror/legacy-modes/mode/powershell"),
  "powerShell",
);
const loadCmake = legacy(
  () => import("@codemirror/legacy-modes/mode/cmake"),
  "cmake",
);

/**
 * Lookup-key → CodeMirror language loader. Keys are matched against
 * `formatLookupKeys` output, so both bare extensions (`sh`, `ts`) and
 * full filenames / dotfile stems (`dockerfile`, `.env`) are valid keys.
 */
const LOADERS: Record<string, SourceLanguageLoader> = {
  // JavaScript / TypeScript family
  js: loadJavascript,
  jsx: loadJavascript,
  mjs: loadJavascript,
  cjs: loadJavascript,
  ts: loadTypescript,
  tsx: loadTypescript,
  mts: loadTypescript,
  cts: loadTypescript,
  // Other compiled / scripting languages
  py: loadPython,
  pyi: loadPython,
  rs: loadRust,
  go: loadGo,
  css: loadCss,
  rb: loadRuby,
  lua: loadLua,
  // Data / config
  json: loadJson,
  jsonl: loadJson,
  jsonc: loadJson,
  yml: loadYaml,
  yaml: loadYaml,
  toml: loadToml,
  // Shells
  sh: loadShell,
  bash: loadShell,
  zsh: loadShell,
  ksh: loadShell,
  ps1: loadPowershell,
  // INI / properties / env-style key=value files
  ini: loadProperties,
  conf: loadProperties,
  cfg: loadProperties,
  properties: loadProperties,
  env: loadProperties,
  // SQL / diff / nginx
  sql: loadSql,
  diff: loadDiff,
  patch: loadDiff,
  // Filename / dotfile keys (no real extension)
  dockerfile: loadDockerfile,
  ".env": loadProperties,
  ".editorconfig": loadProperties,
  ".gitconfig": loadProperties,
  ".npmrc": loadProperties,
  "cmakelists.txt": loadCmake,
  "nginx.conf": loadNginx,
};

/**
 * Resolve a CodeMirror language loader for a file path, or null when no
 * highlighting is known. Matches the most-specific lookup key first
 * (full filename → dotfile stem → bare extension).
 */
export function detectSourceLanguage(
  filePath: string | null,
): SourceLanguageLoader | null {
  if (!filePath) return null;
  for (const key of formatLookupKeys(filePath)) {
    const loader = LOADERS[key];
    if (loader) return loader;
  }
  return null;
}
