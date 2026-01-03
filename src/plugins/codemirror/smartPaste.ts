/**
 * Smart Paste Plugin for CodeMirror
 *
 * When text is selected and user pastes a URL,
 * creates a markdown link [selected text](pasted URL)
 * instead of replacing the selection.
 */

import { EditorView } from "@codemirror/view";

/**
 * Check if a string looks like a valid URL.
 */
function isValidUrl(str: string): boolean {
  const trimmed = str.trim();
  // Must start with http:// or https://
  return /^https?:\/\/\S+/.test(trimmed);
}

/**
 * Creates an extension that intercepts paste events
 * and converts URL paste on selection to markdown links.
 */
export function createSmartPastePlugin() {
  return EditorView.domEventHandlers({
    paste: (event, view) => {
      const { from, to } = view.state.selection.main;

      // No selection - let default paste handle it
      if (from === to) return false;

      // Get pasted text
      const pastedText = event.clipboardData?.getData("text/plain");
      if (!pastedText) return false;

      const trimmedUrl = pastedText.trim();

      // Not a URL - let default paste handle it
      if (!isValidUrl(trimmedUrl)) return false;

      // Get selected text
      const selectedText = view.state.doc.sliceString(from, to);

      // Don't wrap if selected text already looks like a markdown link
      if (/^\[.*\]\(.*\)$/.test(selectedText)) return false;

      // Create markdown link
      const linkMarkdown = `[${selectedText}](${trimmedUrl})`;

      // Prevent default paste and insert link
      event.preventDefault();
      view.dispatch({
        changes: { from, to, insert: linkMarkdown },
        selection: { anchor: from + linkMarkdown.length },
      });

      return true;
    },
  });
}
