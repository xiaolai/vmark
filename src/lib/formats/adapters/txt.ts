// WI-1A.9 — Plain text adapter (full Phase 1A pipeline smoke test).
//
// Plain `.txt` is the simplest non-markdown format and the dispatcher
// fallback for unknown extensions. No language pack, no validator, no
// preview — just the SplitPaneEditor source pane with native CodeMirror
// editing, find, undo, save.

import { registerFormat } from "../registry";
import type { FormatConfig } from "../types";

export const txtFormat: FormatConfig = {
  id: "txt",
  nameI18nKey: "format.txt",
  extensions: ["txt"],
  kind: "split-pane",
  adapters: {
    saveDialogFilters: [{ name: "Plain Text", extensions: ["txt"] }],
    untitledExtension: "txt",
    exportEnabled: false,
    findEnabled: true,
    searchAdapter: "codemirror",
    contentSearchIndexed: true,
    readOnlyDefault: false,
    reloadPolicy: "reload",
    menuPolicy: {
      sourceWysiwygToggle: false,
      cjkFormatActions: false,
      insertBlockActions: false,
      paragraphFormatting: false,
    },
    closeSavePolicy: "markdown-default",
  },
};

export function registerTxtFormat(): void {
  registerFormat(txtFormat);
}
