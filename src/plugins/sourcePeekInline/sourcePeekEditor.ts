/**
 * Source Peek CodeMirror Editor
 *
 * Creates and manages the CodeMirror editor instance for inline Source Peek.
 * CodeMirror modules are lazily loaded on first use to avoid bloating the main bundle.
 */

import { codeHighlightStyle } from "@/plugins/codemirror";
import { sourcePeekError } from "@/utils/debug";

/** Cached CodeMirror modules — loaded once on first activation. */
let cmModules: Awaited<ReturnType<typeof loadCMModules>> | null = null;

async function loadCMModules() {
  // `markdownLanguageSupport` is imported LAZILY with the rest: it pulls in
  // @codemirror/lang-markdown, and a static import here would drag CodeMirror
  // into the main bundle, which is exactly what this lazy block avoids.
  const [state, view, commands, lang, langData, language, mdSupport] = await Promise.all([
    import("@codemirror/state"),
    import("@codemirror/view"),
    import("@codemirror/commands"),
    import("@codemirror/lang-markdown"),
    import("@codemirror/language-data"),
    import("@codemirror/language"),
    import("@/lib/formats/markdownLanguageSupport"),
  ]);
  return { state, view, commands, lang, langData, language, mdSupport };
}

/** Track CodeMirror view for cleanup */
let currentCMView: { destroy: () => void; focus: () => void } | null = null;

/**
 * Create CodeMirror editor element.
 *
 * Returns the container synchronously; CodeMirror is mounted inside it
 * asynchronously after dynamic imports resolve.
 */
export function createCodeMirrorEditor(
  markdown: string,
  onSave: () => void,
  onCancel: () => void,
  onUpdate: (markdown: string) => void
): HTMLElement {
  const container = document.createElement("div");
  container.className = "source-peek-inline-editor";

  // Kick off async CM creation
  void initCMEditor(container, markdown, onSave, onCancel, onUpdate).catch((e) =>
    sourcePeekError("Failed to create source-peek editor:", e)
  );

  return container;
}

async function initCMEditor(
  container: HTMLElement,
  markdown: string,
  onSave: () => void,
  onCancel: () => void,
  onUpdate: (markdown: string) => void
): Promise<void> {
  if (!cmModules) cmModules = await loadCMModules();

  const { state, view, commands, langData, language, mdSupport } = cmModules;
  const CMState = state.EditorState;
  const CMView = view.EditorView;
  const cmKeymap = view.keymap;

  const theme = CMView.theme({
    "&": {
      height: "100%",
    },
    ".cm-content": {
      fontFamily: "var(--font-mono, monospace)",
      fontSize: "var(--editor-font-size-mono)",
      lineHeight: "var(--code-line-height)",
      padding: "0",
    },
    ".cm-line": {
      padding: "0",
    },
    "&.cm-focused": {
      outline: "none",
    },
    ".cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "var(--selection-color, rgba(0, 122, 255, 0.2)) !important",
    },
  });

  const handleSave = () => {
    onSave();
    return true;
  };

  const handleCancel = () => {
    onCancel();
    return true;
  };

  const editorState = CMState.create({
    doc: markdown,
    extensions: [
      CMView.lineWrapping,
      commands.history(),
      cmKeymap.of([
        { key: "Mod-Enter", run: handleSave },
        { key: "Escape", run: handleCancel },
        ...commands.defaultKeymap,
        ...commands.historyKeymap,
      ]),
      CMView.updateListener.of((update: { docChanged: boolean; state: { doc: { toString: () => string } } }) => {
        if (update.docChanged) {
          onUpdate(update.state.doc.toString());
        }
      }),
      mdSupport.markdownLanguageSupport(langData.languages),
      language.syntaxHighlighting(codeHighlightStyle, { fallback: true }),
      theme,
    ],
  });

  // Cleanup previous CM view
  if (currentCMView) {
    currentCMView.destroy();
  }

  const cmView = new CMView({
    state: editorState,
    parent: container,
  });

  currentCMView = cmView;

  // Focus after render
  requestAnimationFrame(() => {
    cmView.focus();
  });
}

/**
 * Cleanup CodeMirror view.
 */
export function cleanupCMView(): void {
  if (currentCMView) {
    currentCMView.destroy();
    currentCMView = null;
  }
}
