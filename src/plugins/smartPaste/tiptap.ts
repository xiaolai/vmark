/**
 * Smart Paste Extension
 *
 * Purpose: When pasting a URL while text is selected, automatically wraps the selected
 * text in a markdown link instead of replacing it. This matches the behavior users
 * expect from editors like Notion and Obsidian.
 *
 * Key decisions:
 *   - Only triggers when selection is non-empty AND clipboard is a valid URL
 *   - Skips code blocks to avoid unwanted link wrapping in code
 *   - Skips if selection already has a link mark (prevents double-wrapping)
 *
 * @coordinates-with markdownPaste/tiptap.ts — runs before markdown paste (lower priority)
 * @coordinates-with pasteUtils.ts — shared isSelectionInCode check
 * @module plugins/smartPaste/tiptap
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { isSelectionInCode } from "@/utils/pasteUtils";

const smartPastePluginKey = new PluginKey("smartPaste");

function isValidUrl(str: string): boolean {
  return /^https?:\/\//i.test(str.trim());
}

function handlePaste(view: EditorView, event: ClipboardEvent): boolean {
  const { from, to, empty } = view.state.selection;

  if (empty) return false;

  // Don't apply link in code contexts
  if (isSelectionInCode(view.state)) return false;

  const url = event.clipboardData?.getData("text/plain")?.trim();
  if (!url || !isValidUrl(url)) return false;

  const linkMark = view.state.schema.marks.link;
  if (!linkMark) return false;
  if (view.state.doc.rangeHasMark(from, to, linkMark)) return false;

  event.preventDefault();
  const tr = view.state.tr.addMark(from, to, linkMark.create({ href: url }));
  view.dispatch(tr);
  return true;
}

export const smartPasteExtension = Extension.create({
  name: "smartPaste",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: smartPastePluginKey,
        props: {
          handlePaste,
        },
      }),
    ];
  },
});

