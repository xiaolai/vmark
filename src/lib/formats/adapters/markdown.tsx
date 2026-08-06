// WI-1A.3 — Markdown format adapter.
//
// Registers .md/.markdown/.mdown/.mkd/.mdx as kind="wysiwyg" pointing at
// the markdown rendering surface (Tiptap WYSIWYG + CodeMirror source mode +
// workflow side panels + heading picker).
//
// WI-13 — this module is METADATA ONLY. `bootstrapFormats()` evaluates it in
// every window (Settings, PDF export) before `import("./App")`, so anything it
// imports statically is cold-start cost for windows that never open an editor.
// The surface lives in ./markdownSurface and the CodeMirror pack behind the
// `language` thunk; both load at first mount via lib/formats/lazySurfaces.ts.
// What stays static here is what the REGISTRY answers synchronously —
// extensions, dispatch keys, menu policy — plus the light text helpers
// (`lint`, `outline`, `toPlainText`) the stores call per keystroke.

import { lintMarkdown } from "@/lib/lintEngine";
import { extractHeadings } from "@/components/Sidebar/outlineUtils";
import { stripMarkdown } from "@/components/StatusBar/statusTextMetrics";
import { registerFormat } from "../registry";
import type { FormatConfig } from "../types";

export const markdownFormat: FormatConfig = {
  id: "markdown",
  nameI18nKey: "format.markdown",
  extensions: ["md", "markdown", "mdown", "mkd", "mdx"],
  kind: "wysiwyg",
  lint: (source: string) => lintMarkdown(source),
  outline: (content: string) => extractHeadings(content),
  toPlainText: (content: string) => stripMarkdown(content),
  // The CodeMirror markdown pack, loaded with the source editor rather than
  // with the registry. `@codemirror/language-data` (the ~140-language registry
  // markdown's fenced-code highlighting consults) rides this thunk too.
  language: async () => {
    const [{ markdownLanguageSupport }, { languages }] = await Promise.all([
      import("@/lib/formats/markdownLanguageSupport"),
      import("@codemirror/language-data"),
    ]);
    return markdownLanguageSupport(languages);
  },
  wysiwygComponent: () =>
    import("./markdownSurface").then((m) => ({ default: m.MarkdownEditorSurface })),
  adapters: {
    saveDialogFilters: [
      { nameI18nKey: "format.markdown", extensions: ["md", "markdown", "mdown", "mkd", "mdx"] },
    ],
    untitledExtension: "md",
    exportEnabled: true,
    findEnabled: true,
    contentSearchIndexed: true,
    readOnlyDefault: false,
    reloadPolicy: "reload",
    menuPolicy: {
      sourceWysiwygToggle: true,
      cjkFormatActions: true,
      insertBlockActions: true,
      paragraphFormatting: true,
    },
    closeSavePolicy: "prompt-on-close",
  },
};

export function registerMarkdownFormat(): void {
  registerFormat(markdownFormat);
}
