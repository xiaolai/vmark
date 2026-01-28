/**
 * CJK Letter Spacing Plugin
 *
 * Applies letter-spacing to CJK character runs using ProseMirror decorations.
 * This is display-only and doesn't modify the document structure.
 *
 * Performance: When disabled (cjkLetterSpacing === "0"), no decorations are
 * created and no regex scanning occurs.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { useSettingsStore } from "@/stores/settingsStore";

export interface CJKLetterSpacingOptions {
  /**
   * CSS class applied to CJK text runs
   * @default "cjk-spacing"
   */
  className: string;
}

// CJK Unicode ranges:
// - CJK Unified Ideographs: U+4E00-U+9FFF
// - CJK Unified Ideographs Extension A: U+3400-U+4DBF
// - CJK Compatibility Ideographs: U+F900-U+FAFF
// - Hiragana: U+3040-U+309F
// - Katakana: U+30A0-U+30FF
// - Hangul Syllables: U+AC00-U+D7AF
// - Bopomofo: U+3100-U+312F
const CJK_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af\u3100-\u312f]+/g;

const pluginKey = new PluginKey("cjkLetterSpacing");

/** Check if CJK letter spacing is enabled */
function isEnabled(): boolean {
  const setting = useSettingsStore.getState().appearance.cjkLetterSpacing;
  return setting !== "0" && setting !== undefined;
}

/**
 * Create decorations for CJK text runs in a document.
 * Returns empty DecorationSet if feature is disabled.
 */
function createCJKDecorations(doc: PMNode, className: string): DecorationSet {
  // Skip all work when disabled
  if (!isEnabled()) {
    return DecorationSet.empty;
  }

  const decorations: Decoration[] = [];

  doc.descendants((node: PMNode, pos: number) => {
    if (!node.isText || !node.text) return;

    CJK_REGEX.lastIndex = 0; // Reset regex state
    let match;
    while ((match = CJK_REGEX.exec(node.text)) !== null) {
      const from = pos + match.index;
      const to = from + match[0].length;
      decorations.push(
        Decoration.inline(from, to, { class: className })
      );
    }
  });

  return DecorationSet.create(doc, decorations);
}

/** Plugin state includes decorations and the enabled state at creation time */
interface PluginState {
  decorations: DecorationSet;
  wasEnabled: boolean;
}

export const CJKLetterSpacing = Extension.create<CJKLetterSpacingOptions>({
  name: "cjkLetterSpacing",

  addOptions() {
    return {
      className: "cjk-spacing",
    };
  },

  addProseMirrorPlugins() {
    const { className } = this.options;

    return [
      new Plugin({
        key: pluginKey,
        state: {
          init(_, { doc }): PluginState {
            const enabled = isEnabled();
            return {
              decorations: enabled ? createCJKDecorations(doc, className) : DecorationSet.empty,
              wasEnabled: enabled,
            };
          },
          apply(tr, oldState: PluginState): PluginState {
            const nowEnabled = isEnabled();
            const { wasEnabled, decorations: oldDecorations } = oldState;

            // Setting toggled off → clear decorations
            if (!nowEnabled) {
              return { decorations: DecorationSet.empty, wasEnabled: false };
            }

            // Setting toggled on → recalculate decorations
            if (nowEnabled && !wasEnabled) {
              return {
                decorations: createCJKDecorations(tr.doc, className),
                wasEnabled: true,
              };
            }

            // Normal case: recalculate only on doc change
            if (!tr.docChanged) {
              return { decorations: oldDecorations.map(tr.mapping, tr.doc), wasEnabled: true };
            }
            return {
              decorations: createCJKDecorations(tr.doc, className),
              wasEnabled: true,
            };
          },
        },
        props: {
          decorations(state) {
            return this.getState(state)?.decorations;
          },
        },
      }),
    ];
  },
});

export default CJKLetterSpacing;
