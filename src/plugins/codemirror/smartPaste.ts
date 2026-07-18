/**
 * Smart Paste Plugin for CodeMirror
 *
 * Purpose: Enhances paste behavior in Source mode — auto-creates markdown links when
 * pasting URLs over selected text, and handles image path/URL pasting with asset copying.
 *
 * Pipeline: paste event -> detect content type -> URL over selection -> [text](url)
 *         -> image path -> copy to assets -> insert ![](relative-path)
 *         -> markdown content -> clean and insert
 *
 * Key decisions:
 *   - Supports multi-image paste (multiple paths from Finder)
 *   - Uses the image paste toast for user confirmation on ambiguous pastes
 *   - Markdown content from other apps is cleaned before insertion
 *   - HTML conversion and markdown cleanup are both skipped inside fenced
 *     code blocks — pasted text lands verbatim (it is code, not markdown)
 *   - URL detection uses clipboard metadata, not just text heuristics
 *
 * @coordinates-with smartPaste/tiptap.ts — WYSIWYG counterpart
 * @coordinates-with smartPasteUtils.ts — shared utilities
 * @coordinates-with smartPasteImage.ts — image paste handling
 * @coordinates-with utils/imagePathDetection.ts — image URL/path detection
 * @coordinates-with stores/imagePasteToastStore.ts — toast UI for image paste confirmation
 * @module plugins/codemirror/smartPaste
 */

import { EditorView } from "@codemirror/view";
import { cleanPastedMarkdown } from "@/utils/cleanPastedMarkdown";
import { htmlToMarkdown, isSubstantialHtml } from "@/utils/htmlToMarkdown";
import { useSettingsStore, type PasteMode } from "@/stores/settingsStore";
import { getCodeFenceInfo } from "@/plugins/sourceContextDetection/codeFenceDetection";
import { isValidUrl } from "./smartPasteUtils";
import { tryImagePaste } from "./smartPasteImage";
import { handleClipboardImagePaste } from "./smartPasteClipboardImage";

/**
 * Creates an extension that intercepts paste events
 * and converts URL paste on selection to markdown links,
 * and prompts for image URL/path pasting.
 */
export function createSmartPastePlugin() {
  return EditorView.domEventHandlers({
    paste: (event, view) => {
      const { from, to } = view.state.selection.main;

      // Clipboard binary image (e.g., screenshot paste) — check before text guard
      // because screenshot paste may have no text/plain content
      if (handleClipboardImagePaste(view, event)) {
        event.preventDefault();
        return true;
      }

      const pastedText = event.clipboardData?.getData("text/plain");
      if (!pastedText) return false;

      const trimmedText = pastedText.trim();

      // HTML paste: convert HTML to markdown (skip inside code fences)
      const pasteMode: PasteMode = useSettingsStore.getState().markdown.pasteMode ?? "smart";
      if (pasteMode === "smart") {
        const html = event.clipboardData?.getData("text/html");
        if (html && html.length <= 100_000 && isSubstantialHtml(html)) {
          // Skip inside code fences — paste raw text
          const inCodeFence = getCodeFenceInfo(view) !== null;
          if (!inCodeFence) {
            try {
              const markdown = htmlToMarkdown(html);
              if (markdown && markdown.trim().length >= 2 && markdown.trim() !== pastedText.trim()) {
                event.preventDefault();
                view.dispatch({
                  changes: { from, to, insert: markdown },
                  selection: { anchor: from + markdown.length },
                });
                return true;
              }
            } catch {
              // htmlToMarkdown can throw on malformed HTML — fall through to default paste
            }
          }
        }
      } else if (pasteMode === "plain") {
        // Plain mode: just insert text as-is (skip all smart handling)
        event.preventDefault();
        view.dispatch({
          changes: { from, to, insert: pastedText },
          selection: { anchor: from + pastedText.length },
        });
        return true;
      }

      // Image path/URL paste (works with or without selection)
      if (tryImagePaste(view, pastedText)) {
        event.preventDefault();
        return true;
      }

      // Clean AI-clipboard artifacts (escaped pipes, <br> in tables) from pasted markdown
      const cleaned = cleanPastedMarkdown(pastedText);
      if (cleaned !== pastedText) {
        // Inside a fenced code block the "artifacts" are real code (e.g. the
        // escaped pipe in `s/foo\|bar/x/`) — never rewrite; default paste.
        if (getCodeFenceInfo(view) !== null) return false;
        event.preventDefault();
        view.dispatch({
          changes: { from, to, insert: cleaned },
          selection: { anchor: from + cleaned.length },
        });
        return true;
      }

      // No selection - let default paste handle it
      if (from === to) return false;

      // Not a URL - let default paste handle it
      if (!isValidUrl(trimmedText)) return false;

      // Get selected text
      const selectedText = view.state.doc.sliceString(from, to);

      // Don't wrap if selected text already looks like a markdown link
      if (/^\[.*\]\(.*\)$/.test(selectedText)) return false;

      // Create markdown link
      const linkMarkdown = `[${selectedText}](${trimmedText})`;

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
