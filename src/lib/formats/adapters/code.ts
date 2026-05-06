// WI-4.1 — Code-viewer adapters.
//
// Per ADR-3, code formats are READ-ONLY by default. The "Enable editing"
// toggle (WI-4.3) promotes a tab to read-write; "Open in external
// editor" (WI-4.4) deep-links to $EDITOR.
//
// Language packs:
//   - TypeScript / TSX: @codemirror/lang-javascript with jsx + typescript flags
//   - JavaScript / JSX: @codemirror/lang-javascript with jsx flag
//   - Python: @codemirror/lang-python
//   - Rust: @codemirror/lang-rust
//   - Go: @codemirror/lang-go
//   - CSS: @codemirror/lang-css
//   - Shell (.sh / .bash): @codemirror/legacy-modes/mode/shell
//   - Ruby: @codemirror/legacy-modes/mode/ruby
//   - Lua: @codemirror/legacy-modes/mode/lua
//
// .zig is deliberately out of v1 scope (no maintained pack — ADR-3).

import type { Extension } from "@codemirror/state";
import { registerFormat } from "../registry";
import type { FormatConfig } from "../types";

const codeMenuPolicy: FormatConfig["adapters"]["menuPolicy"] = {
  sourceWysiwygToggle: false,
  cjkFormatActions: false,
  insertBlockActions: false,
  paragraphFormatting: false,
};

function makeCodeFormat(
  id: string,
  nameI18nKey: string,
  extensions: string[],
  filterName: string,
  loadLanguage: () => Promise<Extension>,
): FormatConfig {
  return {
    id,
    nameI18nKey,
    extensions,
    kind: "viewer",
    loadLanguage,
    adapters: {
      saveDialogFilters: [{ name: filterName, extensions }],
      untitledExtension: extensions[0],
      exportEnabled: false,
      findEnabled: true,
      searchAdapter: "codemirror",
      contentSearchIndexed: false,
      readOnlyDefault: true,
      reloadPolicy: "reload",
      menuPolicy: codeMenuPolicy,
      closeSavePolicy: "markdown-default",
    },
  };
}

const loadJavascript = async (): Promise<Extension> => {
  const { javascript } = await import("@codemirror/lang-javascript");
  return javascript({ jsx: true });
};

const loadTypescript = async (): Promise<Extension> => {
  const { javascript } = await import("@codemirror/lang-javascript");
  return javascript({ jsx: true, typescript: true });
};

const loadPython = async (): Promise<Extension> => {
  const { python } = await import("@codemirror/lang-python");
  return python();
};

const loadRust = async (): Promise<Extension> => {
  const { rust } = await import("@codemirror/lang-rust");
  return rust();
};

const loadGo = async (): Promise<Extension> => {
  const { go } = await import("@codemirror/lang-go");
  return go();
};

const loadCss = async (): Promise<Extension> => {
  const { css } = await import("@codemirror/lang-css");
  return css();
};

const loadShell = async (): Promise<Extension> => {
  const [{ StreamLanguage }, { shell }] = await Promise.all([
    import("@codemirror/language"),
    import("@codemirror/legacy-modes/mode/shell"),
  ]);
  return StreamLanguage.define(shell);
};

const loadRuby = async (): Promise<Extension> => {
  const [{ StreamLanguage }, { ruby }] = await Promise.all([
    import("@codemirror/language"),
    import("@codemirror/legacy-modes/mode/ruby"),
  ]);
  return StreamLanguage.define(ruby);
};

const loadLua = async (): Promise<Extension> => {
  const [{ StreamLanguage }, { lua }] = await Promise.all([
    import("@codemirror/language"),
    import("@codemirror/legacy-modes/mode/lua"),
  ]);
  return StreamLanguage.define(lua);
};

export const codeFormats: FormatConfig[] = [
  makeCodeFormat(
    "code-typescript",
    "format.codeTypescript",
    ["ts", "tsx"],
    "TypeScript",
    loadTypescript,
  ),
  makeCodeFormat(
    "code-javascript",
    "format.codeJavascript",
    ["js", "jsx"],
    "JavaScript",
    loadJavascript,
  ),
  makeCodeFormat(
    "code-python",
    "format.codePython",
    ["py"],
    "Python",
    loadPython,
  ),
  makeCodeFormat(
    "code-rust",
    "format.codeRust",
    ["rs"],
    "Rust",
    loadRust,
  ),
  makeCodeFormat(
    "code-go",
    "format.codeGo",
    ["go"],
    "Go",
    loadGo,
  ),
  makeCodeFormat(
    "code-css",
    "format.codeCss",
    ["css"],
    "CSS",
    loadCss,
  ),
  makeCodeFormat(
    "code-shell",
    "format.codeShell",
    ["sh", "bash"],
    "Shell",
    loadShell,
  ),
  makeCodeFormat(
    "code-ruby",
    "format.codeRuby",
    ["rb"],
    "Ruby",
    loadRuby,
  ),
  makeCodeFormat(
    "code-lua",
    "format.codeLua",
    ["lua"],
    "Lua",
    loadLua,
  ),
];

export function registerCodeFormats(): void {
  for (const f of codeFormats) registerFormat(f);
}
