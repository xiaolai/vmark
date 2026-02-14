/**
 * HTML Paste Extension
 *
 * Purpose: Intercepts paste events with HTML content and converts to clean Markdown
 * before inserting — handles content from Word, web pages, and rich text sources.
 *
 * Pipeline: paste event → imageHandler → smartPaste → markdownPaste → THIS
 *         → check for substantial HTML → htmlToMarkdown → insert as markdown
 *
 * Key decisions:
 *   - Only fires if no earlier handler claimed the paste (lower priority in chain)
 *   - Uses isSubstantialHtml to filter out trivial HTML (plain text wrapped in `<p>`)
 *   - Gated by the pasteMode setting (only active in "smart" mode)
 *   - Skips when cursor is inside a code block or with multi-cursor
 *
 * @coordinates-with utils/htmlToMarkdown.ts — HTML-to-Markdown conversion
 * @coordinates-with markdownPaste/tiptap.ts — creates the markdown insertion transaction
 * @module plugins/htmlPaste/tiptap
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { htmlToMarkdown, isSubstantialHtml } from "@/utils/htmlToMarkdown";
import { createMarkdownPasteTransaction } from "@/plugins/markdownPaste/tiptap";
import { useSettingsStore, type PasteMode } from "@/stores/settingsStore";
import { isViewSelectionInCode, isViewMultiSelection } from "@/utils/pasteUtils";

const htmlPastePluginKey = new PluginKey("htmlPaste");

/**
 * Maximum HTML size to process (100KB).
 * Larger content might be too expensive to convert.
 */
const MAX_HTML_SIZE = 100_000;

function handlePaste(view: EditorView, event: ClipboardEvent): boolean {
  // Get paste mode setting
  const settings = useSettingsStore.getState();
  const pasteMode: PasteMode = settings.markdown.pasteMode ?? "smart";

  // If paste mode is "rich", let Tiptap handle it natively
  if (pasteMode === "rich") {
    return false;
  }

  // If paste mode is "plain", convert to plain text
  if (pasteMode === "plain") {
    const text = event.clipboardData?.getData("text/plain");
    if (text) {
      event.preventDefault();
      const { from, to } = view.state.selection;
      const tr = view.state.tr.insertText(text, from, to);
      view.dispatch(tr.scrollIntoView());
      return true;
    }
    return false;
  }

  // Smart mode: convert HTML to Markdown
  const html = event.clipboardData?.getData("text/html");
  const text = event.clipboardData?.getData("text/plain");

  // No HTML content, let other handlers deal with it
  if (!html) {
    return false;
  }

  // HTML is too large, fall back to plain text
  if (html.length > MAX_HTML_SIZE) {
    console.warn("[htmlPaste] HTML too large, falling back to plain text");
    if (text) {
      event.preventDefault();
      const { from, to } = view.state.selection;
      const tr = view.state.tr.insertText(text, from, to);
      view.dispatch(tr.scrollIntoView());
      return true;
    }
    return false;
  }

  // Skip if in code block or code mark
  if (isViewSelectionInCode(view)) {
    return false;
  }

  // Skip if multi-cursor (let multi-cursor handler deal with it)
  if (isViewMultiSelection(view)) {
    return false;
  }

  // Check if HTML is substantial enough to warrant conversion
  if (!isSubstantialHtml(html)) {
    // Not substantial HTML, let markdown paste or default handle it
    return false;
  }

  // Convert HTML to Markdown
  const markdown = htmlToMarkdown(html);

  // If conversion resulted in empty or very short content, fall back
  if (!markdown || markdown.trim().length < 2) {
    return false;
  }

  // If the markdown is just the same as plain text (no formatting gained),
  // let other handlers deal with it
  const trimmedMarkdown = markdown.trim();
  const trimmedText = text?.trim() ?? "";
  if (trimmedMarkdown === trimmedText) {
    return false;
  }

  // Create transaction from parsed markdown
  const preserveLineBreaks = settings.markdown?.preserveLineBreaks ?? false;
  const tr = createMarkdownPasteTransaction(view.state, markdown, {
    preserveLineBreaks,
  });

  if (!tr) {
    console.warn("[htmlPaste] Failed to create transaction from markdown");
    return false;
  }

  event.preventDefault();
  view.dispatch(tr.scrollIntoView());
  return true;
}

export const htmlPasteExtension = Extension.create({
  name: "htmlPaste",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: htmlPastePluginKey,
        props: {
          handlePaste,
        },
      }),
    ];
  },
});
