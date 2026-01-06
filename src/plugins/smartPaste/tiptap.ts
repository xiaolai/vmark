import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

const smartPastePluginKey = new PluginKey("smartPaste");

function isValidUrl(str: string): boolean {
  return /^https?:\/\//i.test(str.trim());
}

function handlePaste(view: EditorView, event: ClipboardEvent): boolean {
  const { from, to, empty } = view.state.selection;

  if (empty) return false;

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

