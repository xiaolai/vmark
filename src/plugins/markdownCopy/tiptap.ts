/**
 * Markdown Copy Extension
 *
 * Two features in one plugin:
 *
 * 1. **Copy format**: Customizes text/plain clipboard content on copy/cut.
 *    When "markdown", converts the selection to markdown syntax instead of
 *    flattened plain text. Uses ProseMirror's `clipboardTextSerializer` prop.
 *
 * 2. **Copy on select**: Automatically copies selected text to clipboard
 *    on mouseup, similar to terminal behavior.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Fragment, Slice, type Schema, type Node as PMNode, type NodeType } from "@tiptap/pm/model";
import { serializeMarkdown } from "@/utils/markdownPipeline";
import { useSettingsStore } from "@/stores/settingsStore";
import { clipboardWarn, markdownCopyWarn } from "@/utils/debug";

const markdownCopyPluginKey = new PluginKey("markdownCopy");

/**
 * Ensures content has at least one block node.
 * Wraps inline content in a paragraph if needed.
 */
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

function createDocFromSlice(schema: Schema, slice: Slice): PMNode {
  const docType = schema.topNodeType;
  const content = ensureBlockContent(slice.content, schema.nodes.paragraph);

  try {
    return docType.create(null, content);
  } catch {
    return docType.createAndFill() ?? docType.create();
  }
}

/**
 * Clean up markdown for clipboard use.
 *
 * The serializer produces round-trip-safe markdown with backslash escapes
 * for special characters ($, ~, @, [, *, _, :, & …). This is correct for
 * file saving but produces noisy clipboard text.  Strip them here so
 * users get clean, readable output.
 *
 * Also collapses autolink expansions:
 *   [https://example.com](https://example.com) → https://example.com
 *   [user@host.com](mailto:user@host.com)      → user@host.com
 */
export function cleanMarkdownForClipboard(md: string): string {
  let result = md;

  // 1. Strip backslash escapes added by remark-stringify for round-trip safety.
  //    Only strip known serializer-added escapes (punctuation), not arbitrary chars.
  //    Must run before autolink collapsing because link text has escapes
  //    (e.g. user\@host) but the URL does not — back-reference won't match
  //    unless we clean escapes first.
  result = result.replace(/\\([#\-*_`|[\]()>+.!~$@&:\\])/g, "$1");

  // 2. Collapse redundant autolinks where text equals URL
  result = result.replace(/\[([^\]]+)\]\((?:mailto:)?\1\)/g, "$1");

  return result;
}

/**
 * Normalize whitespace for clipboard content.
 *
 * Applied to ALL clipboard writes (WYSIWYG and Source mode):
 * 1. Trim trailing whitespace from each line
 * 2. Collapse runs of 3+ blank lines into a single blank line
 * 3. Trim leading/trailing blank lines from the whole string
 */
export function cleanTextForClipboard(text: string): string {
  let result = text;
  // 1. Trim trailing whitespace per line
  result = result.replace(/[^\S\n]+$/gm, "");
  // 2. Collapse multiple blank lines (3+ newlines → 2)
  result = result.replace(/\n{3,}/g, "\n\n");
  // 3. Trim leading/trailing blank lines
  result = result.trim();
  return result;
}

/**
 * Serialize a Slice to markdown with blank-line collapsing.
 * Returns null on failure (caller decides fallback).
 */
function serializeSliceAsMarkdown(schema: Schema, slice: Slice): string | null {
  try {
    const doc = createDocFromSlice(schema, slice);
    const md = serializeMarkdown(schema, doc);
    return cleanTextForClipboard(cleanMarkdownForClipboard(md));
  } catch (error) {
    markdownCopyWarn("Serialization failed:", error);
    return null;
  }
}

/**
 * Get text for the current selection, respecting copyFormat setting.
 */
function getSelectionText(view: EditorView): string {
  const { state } = view;
  const { from, to } = state.selection;
  if (from === to) return "";

  const { copyFormat } = useSettingsStore.getState().markdown;

  if (copyFormat === "markdown") {
    const slice = state.doc.slice(from, to);
    const md = serializeSliceAsMarkdown(state.schema, slice);
    if (md !== null) return md;
  }

  return cleanTextForClipboard(state.doc.textBetween(from, to, "\n\n"));
}

export const markdownCopyExtension = Extension.create({
  name: "markdownCopy",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: markdownCopyPluginKey,
        props: {
          clipboardTextSerializer(slice: Slice, view: EditorView) {
            const { copyFormat } = useSettingsStore.getState().markdown;
            if (copyFormat !== "markdown") return "";

            return serializeSliceAsMarkdown(view.state.schema, slice) ?? "";
          },
          handleDOMEvents: {
            mouseup(view: EditorView) {
              const { copyOnSelect } = useSettingsStore.getState().markdown;
              if (!copyOnSelect) return false;

              requestAnimationFrame(() => {
                if (view.isDestroyed) return;

                const text = getSelectionText(view);
                if (text) {
                  navigator.clipboard.writeText(text).catch((error: unknown) => {
                    clipboardWarn("Clipboard write failed:", error instanceof Error ? error.message : String(error));
                  });
                }
              });

              return false;
            },
          },
        },
      }),
    ];
  },
});
