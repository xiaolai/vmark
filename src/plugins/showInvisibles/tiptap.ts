/**
 * Show-invisibles extension for the WYSIWYG editor.
 *
 * Visualizes:
 *   - Space               →  ·    (overlay widget at each space position)
 *   - Hard line break     →  ⏎    (widget at each <br>)
 *
 * Soft line breaks (markdown single-newline-inside-paragraph) have no
 * DOM representation in WYSIWYG mode — they are render-time joins.
 * Tabs are stripped by the markdown→DOM pipeline so they don't appear
 * here either. Source mode handles both.
 *
 * The extension is a pure ProseMirror decoration plugin — no schema
 * changes, no commands. Toggle via the storage `enabled` field; the
 * provider re-creates decorations on view update.
 *
 * @coordinates-with stores/settingsStore.ts — markdown.showInvisibles
 * @coordinates-with services/assembly/tiptapExtensions.ts — registers via storage
 * @module plugins/showInvisibles/tiptap
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import "./show-invisibles.css";

const pluginKey = new PluginKey<DecorationSet>("showInvisibles");

interface ShowInvisiblesStorage {
  enabled: boolean;
}

function buildDecorations(doc: PMNode, enabled: boolean): DecorationSet {
  if (!enabled) return DecorationSet.empty;
  const decos: Decoration[] = [];

  doc.descendants((node, pos) => {
    // Hard breaks: <br> node — mark with widget showing ⏎
    if (node.type.name === "hardBreak") {
      decos.push(
        Decoration.widget(pos, () => {
          const el = document.createElement("span");
          el.className = "pm-invisible pm-invisible-hard-break";
          el.textContent = "⏎";
          el.setAttribute("aria-hidden", "true");
          return el;
        }, { side: -1 }),
      );
      return;
    }

    // Text nodes: per-space inline decoration. Walk the string and
    // emit a decoration per ASCII space. Skip non-breaking spaces
    // (U+00A0) and other whitespace for the MVP.
    if (node.isText && node.text) {
      const text = node.text;
      for (let i = 0; i < text.length; i++) {
        if (text[i] === " ") {
          decos.push(
            Decoration.inline(pos + i, pos + i + 1, {
              class: "pm-invisible-space",
            }),
          );
        }
      }
    }
  });

  return DecorationSet.create(doc, decos);
}

export const showInvisiblesExtension = Extension.create<unknown, ShowInvisiblesStorage>({
  name: "showInvisibles",

  addStorage() {
    return { enabled: false };
  },

  addProseMirrorPlugins() {
    const ext = this;
    return [
      new Plugin<DecorationSet>({
        key: pluginKey,
        state: {
          init(_, { doc }) {
            return buildDecorations(doc, ext.storage.enabled);
          },
          apply(tr, old) {
            // Force-rebuild marker via meta — set by setShowInvisibles helper
            const force = tr.getMeta(pluginKey) as { enabled?: boolean } | undefined;
            if (force && typeof force.enabled === "boolean") {
              return buildDecorations(tr.doc, force.enabled);
            }
            if (tr.docChanged) return buildDecorations(tr.doc, ext.storage.enabled);
            return old;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state) ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

/**
 * Imperative toggle: dispatch a transaction that re-runs the decoration
 * builder with the new `enabled` flag. Call from the consumer hook
 * whenever the user flips the setting at runtime.
 */
export function setShowInvisibles(
  view: { dispatch: (tr: unknown) => void; state: { tr: unknown } } & { state: { tr: { setMeta: (key: PluginKey, value: unknown) => unknown } } },
  enabled: boolean,
): void {
  const tr = (view.state.tr as unknown as { setMeta: (key: PluginKey, value: unknown) => unknown }).setMeta(pluginKey, { enabled });
  view.dispatch(tr);
}
