/**
 * CJK Letter Spacing Plugin
 *
 * Purpose: Applies letter-spacing to CJK character runs using ProseMirror decorations,
 * improving readability of Chinese/Japanese/Korean text without modifying the document.
 *
 * Key decisions:
 *   - Display-only: uses inline decorations (CSS class) rather than document mutations
 *   - Performance: when disabled (cjkLetterSpacing === "0"), no regex scanning or
 *     decoration creation occurs — completely zero-cost
 *   - Performance: on doc change, uses incremental updates (scan only changed ranges
 *     via transaction step maps) instead of full-document rescan
 *   - Tracks enabled state in plugin state to detect setting toggles and rebuild decorations
 *   - Covers CJK Unified Ideographs, Extension A, Compatibility, Hiragana, Katakana,
 *     Hangul Syllables, and Bopomofo ranges
 *
 * @coordinates-with stores/settingsStore.ts — reads appearance.cjkLetterSpacing setting
 * @module plugins/cjkLetterSpacing
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { useSettingsStore } from "@/stores/settingsStore";
import "./cjk-letter-spacing.css";

/** Configuration options for the CJK letter spacing extension. */
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

/**
 * Scan a document range for CJK text runs and return decorations.
 * Used for incremental updates — only scans nodes overlapping [from, to].
 */
function scanRangeForCJK(
  doc: PMNode,
  from: number,
  to: number,
  className: string,
): Decoration[] {
  const decorations: Decoration[] = [];
  doc.nodesBetween(from, to, (node: PMNode, pos: number) => {
    if (!node.isText || !node.text) return;
    CJK_REGEX.lastIndex = 0;
    let match;
    while ((match = CJK_REGEX.exec(node.text)) !== null) {
      const decoFrom = pos + match.index;
      const decoTo = decoFrom + match[0].length;
      decorations.push(Decoration.inline(decoFrom, decoTo, { class: className }));
    }
  });
  return decorations;
}

/**
 * Apply incremental decoration updates for a transaction.
 * Maps old decorations through the change, removes stale ones in changed
 * ranges, then re-scans only those ranges.
 */
function applyIncrementalUpdate(
  tr: Transaction,
  oldDecorations: DecorationSet,
  className: string,
): DecorationSet {
  let decorations = oldDecorations.map(tr.mapping, tr.doc);

  tr.steps.forEach((_step, i) => {
    const map = tr.mapping.maps[i];
    map.forEach((_oldStart: number, _oldEnd: number, newStart: number, newEnd: number) => {
      // Expand range to full node boundaries for correctness
      const $from = tr.doc.resolve(newStart);
      const $to = tr.doc.resolve(Math.min(newEnd, tr.doc.content.size));
      const rangeFrom = $from.start($from.depth);
      const rangeTo = $to.end($to.depth);

      // Remove old decorations in the changed range
      const stale = decorations.find(rangeFrom, rangeTo);
      if (stale.length > 0) {
        decorations = decorations.remove(stale);
      }

      // Re-scan the changed range
      const newDecos = scanRangeForCJK(tr.doc, rangeFrom, rangeTo, className);
      if (newDecos.length > 0) {
        decorations = decorations.add(tr.doc, newDecos);
      }
    });
  });

  return decorations;
}

/** Plugin state includes decorations and the enabled state at creation time */
interface PluginState {
  decorations: DecorationSet;
  wasEnabled: boolean;
}

/** Tiptap extension that adds letter-spacing decorations to CJK text runs. */
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

            // No doc change — just remap existing decorations
            if (!tr.docChanged) {
              return { decorations: oldDecorations.map(tr.mapping, tr.doc), wasEnabled: true };
            }

            // Doc changed — incremental update (scan only changed ranges)
            return {
              decorations: applyIncrementalUpdate(tr, oldDecorations, className),
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
