/**
 * Code Paste Extension
 *
 * Purpose: Detects when pasted plain text looks like source code and automatically
 * wraps it in a code block with language detection, improving the paste experience
 * for developers.
 *
 * Pipeline: paste event → imageHandler → smartPaste → markdownPaste → htmlPaste → THIS
 *         → code detection scoring → wrap in code block if score exceeds threshold
 *
 * Key decisions:
 *   - Lowest priority in the paste chain — only fires if no other handler claims the paste
 *   - Gated by the pasteMode setting (only active in "smart" mode)
 *   - Skips detection if already inside a code block or if content looks like markdown
 *   - Uses scoring heuristics from codeDetection utils (indentation, braces, keywords, etc.)
 *
 * @coordinates-with utils/codeDetection/ — scoring heuristics for code detection
 * @coordinates-with utils/markdownPasteDetection.ts — markdown detection to avoid false positives
 * @module plugins/codePaste/tiptap
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { shouldPasteAsCodeBlock } from "@/utils/codeDetection";
import { isMarkdownPasteCandidate } from "@/utils/markdownPasteDetection";
import { useSettingsStore, type PasteMode } from "@/stores/settingsStore";
import { isViewSelectionInCodeBlock, isViewMultiSelection } from "@/utils/pasteUtils";

const codePastePluginKey = new PluginKey("codePaste");

/**
 * Minimum lines for code detection to kick in.
 * Single-line pastes are rarely code blocks.
 */
const MIN_LINES_FOR_CODE_BLOCK = 2;

/**
 * Maximum text size for code detection (50KB).
 */
const MAX_CODE_SIZE = 50_000;

function handlePaste(view: EditorView, event: ClipboardEvent): boolean {
  // Get paste mode setting
  const settings = useSettingsStore.getState();
  const pasteMode: PasteMode = settings.markdown.pasteMode ?? "smart";

  // Only apply in "smart" mode
  if (pasteMode !== "smart") {
    return false;
  }

  // Check if there's HTML content - if so, let htmlPaste handle it
  const html = event.clipboardData?.getData("text/html");
  if (html && html.trim()) {
    return false;
  }

  const text = event.clipboardData?.getData("text/plain");
  if (!text) {
    return false;
  }

  // If it looks like Markdown, prefer markdownPaste (or plain paste) over code block auto-conversion.
  // This prevents markdown-heavy prose from being misclassified as code.
  if (isMarkdownPasteCandidate(text)) {
    return false;
  }

  // Skip if text is too large
  if (text.length > MAX_CODE_SIZE) {
    return false;
  }

  // Skip if already in a code block
  if (isViewSelectionInCodeBlock(view)) {
    return false;
  }

  // Skip if multi-cursor
  if (isViewMultiSelection(view)) {
    return false;
  }

  // Check if text has enough lines to be considered a code block
  const lines = text.split("\n");
  if (lines.length < MIN_LINES_FOR_CODE_BLOCK) {
    return false;
  }

  // Detect if this looks like code
  const { should, language } = shouldPasteAsCodeBlock(text);

  if (!should) {
    return false;
  }

  // Insert as code block
  const { state, dispatch } = view;
  const codeBlockType = state.schema.nodes.codeBlock;

  if (!codeBlockType) {
    console.warn("[codePaste] codeBlock node type not found");
    return false;
  }

  event.preventDefault();

  // Create code block node
  const codeBlock = codeBlockType.create(
    { language: language || null },
    state.schema.text(text)
  );

  // Replace selection with code block
  const { from, to } = state.selection;
  const tr = state.tr.replaceRangeWith(from, to, codeBlock);

  dispatch(tr.scrollIntoView());
  return true;
}

export const codePasteExtension = Extension.create({
  name: "codePaste",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: codePastePluginKey,
        props: {
          handlePaste,
        },
      }),
    ];
  },
});
