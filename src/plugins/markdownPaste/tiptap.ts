import { Extension } from "@tiptap/core";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Fragment, Slice, type NodeType } from "@tiptap/pm/model";
import { parseMarkdown } from "@/utils/markdownPipeline";
import type { MarkdownPipelineOptions } from "@/utils/markdownPipeline/types";
import { isMarkdownPasteCandidate } from "@/utils/markdownPasteDetection";
import { isSubstantialHtml } from "@/utils/htmlToMarkdown";
import { useSettingsStore, type MarkdownPasteMode } from "@/stores/settingsStore";
import { isMultiSelection, isSelectionInCode } from "@/utils/pasteUtils";

const markdownPastePluginKey = new PluginKey("markdownPaste");

const MAX_MARKDOWN_PASTE_CHARS = 200_000;

export interface MarkdownPasteDecision {
  pasteMode: MarkdownPasteMode;
  /** Raw HTML from clipboard, if any */
  html: string;
}

function ensureBlockContent(content: Fragment, paragraphType: NodeType | undefined): Fragment {
  if (content.childCount === 0 && paragraphType) {
    return Fragment.from(paragraphType.create());
  }
  const firstChild = content.firstChild;
  if (firstChild && !firstChild.isBlock && paragraphType) {
    return Fragment.from(paragraphType.create(null, content));
  }
  return content;
}

function hasValidUrl(text: string): boolean {
  return /^https?:\/\//i.test(text.trim());
}

export function createMarkdownPasteSlice(
  state: EditorState,
  markdown: string,
  options: MarkdownPipelineOptions = {}
): Slice {
  const parsed = parseMarkdown(state.schema, markdown, options);
  const content = ensureBlockContent(parsed.content, state.schema.nodes.paragraph);
  return Slice.maxOpen(content);
}

export function createMarkdownPasteTransaction(
  state: EditorState,
  markdown: string,
  options: MarkdownPipelineOptions = {}
): Transaction | null {
  try {
    const slice = createMarkdownPasteSlice(state, markdown, options);
    return state.tr.replaceSelection(slice);
  } catch (error) {
    console.error("[MarkdownPaste] Failed to parse markdown:", error);
    return null;
  }
}

export function shouldHandleMarkdownPaste(
  state: EditorState,
  text: string,
  decision: MarkdownPasteDecision
): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.length > MAX_MARKDOWN_PASTE_CHARS) return false;
  if (decision.pasteMode === "off") return false;
  // If HTML is present AND substantial, let htmlPaste handle it.
  // If HTML is minimal (just wrapper tags), we should still try markdown parsing.
  if (decision.html && isSubstantialHtml(decision.html)) return false;
  if (isMultiSelection(state)) return false;
  if (isSelectionInCode(state)) return false;
  if (!state.selection.empty && hasValidUrl(trimmed)) return false;
  return isMarkdownPasteCandidate(trimmed);
}


async function readClipboardPlainText(): Promise<string> {
  try {
    const text = await readText();
    if (text) return text;
  } catch (error) {
    console.error("[MarkdownPaste] Failed to read clipboard:", error);
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
    try {
      return await navigator.clipboard.readText();
    } catch (error) {
      console.error("[MarkdownPaste] Failed to read web clipboard:", error);
    }
  }

  return "";
}

function handlePaste(view: EditorView, event: ClipboardEvent): boolean {
  const text = event.clipboardData?.getData("text/plain");
  if (!text) return false;

  const settings = useSettingsStore.getState();
  const pasteMode = settings.markdown.pasteMarkdownInWysiwyg ?? "auto";
  const html = event.clipboardData?.getData("text/html") ?? "";

  if (!shouldHandleMarkdownPaste(view.state, text, { pasteMode, html })) {
    return false;
  }

  const tr = createMarkdownPasteTransaction(view.state, text, {
    preserveLineBreaks: settings.markdown.preserveLineBreaks,
  });

  if (!tr) return false;

  event.preventDefault();
  view.dispatch(tr.scrollIntoView());
  return true;
}


export async function triggerPastePlainText(view: EditorView): Promise<void> {
  if (view.state.selection.ranges.length > 1) return;

  const text = await readClipboardPlainText();
  if (!text) return;
  const { from, to } = view.state.selection;
  const tr = view.state.tr.insertText(text, from, to);
  view.dispatch(tr.scrollIntoView());
}

export const markdownPasteExtension = Extension.create({
  name: "markdownPaste",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: markdownPastePluginKey,
        props: {
          handlePaste,
        },
      }),
    ];
  },
});
