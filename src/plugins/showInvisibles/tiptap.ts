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
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import "./show-invisibles.css";

export const showInvisiblesPluginKey = new PluginKey<DecorationSet>("showInvisibles");

interface ShowInvisiblesStorage {
  enabled: boolean;
}

/**
 * Doc size (in PM positions) above which we skip the per-space scan
 * entirely. One ASCII char ≈ 1 position; 200_000 covers ~80 pages of
 * dense prose. Above this, even the incremental path's initial scan
 * (once, on first enable) would walk a large doc — better to silently
 * degrade than block the editor.
 */
const SHOW_INVISIBLES_DOC_SIZE_LIMIT = 200_000;

function makeHardBreakWidget(): HTMLElement {
  const el = document.createElement("span");
  el.className = "pm-invisible pm-invisible-hard-break";
  el.textContent = "⏎";
  el.setAttribute("aria-hidden", "true");
  return el;
}

/**
 * Scan a document range and emit decorations for every ASCII space and
 * hardBreak node intersecting it. Used by both the initial full build
 * and the incremental update path. The caller is responsible for
 * removing any pre-existing decorations in the range before adding the
 * output to a DecorationSet.
 *
 * The right boundary needs special handling for widget decorations:
 * a widget node sitting at `pos === to` is conceptually "at the right
 * edge" of the range and must be re-emitted so the incremental path
 * agrees with a full rebuild. Inline decorations stay half-open since
 * each character has explicit width.
 */
function scanRange(doc: PMNode, from: number, to: number): Decoration[] {
  const decos: Decoration[] = [];
  const widgetEnd = Math.min(to + 1, doc.content.size);
  doc.nodesBetween(from, widgetEnd, (node, pos) => {
    if (node.type.name === "hardBreak") {
      if (pos >= from && pos <= to) {
        decos.push(Decoration.widget(pos, makeHardBreakWidget, { side: -1 }));
      }
      return;
    }
    if (node.isText && node.text) {
      const nodeStart = pos;
      const nodeEnd = pos + node.text.length;
      const overlapStart = Math.max(nodeStart, from);
      // Inline overlap stays bounded by the original `to` — we extended
      // the walk only to discover boundary widgets, not to double-emit
      // inline decorations into the next range.
      const overlapEnd = Math.min(nodeEnd, to);
      for (let i = overlapStart - nodeStart; i < overlapEnd - nodeStart; i++) {
        if (node.text[i] === " ") {
          decos.push(
            Decoration.inline(nodeStart + i, nodeStart + i + 1, {
              class: "pm-invisible-space",
            }),
          );
        }
      }
    }
  });
  return decos;
}

function buildDecorations(doc: PMNode, enabled: boolean): DecorationSet {
  if (!enabled) return DecorationSet.empty;
  if (doc.content.size > SHOW_INVISIBLES_DOC_SIZE_LIMIT) {
    return DecorationSet.empty;
  }
  return DecorationSet.create(doc, scanRange(doc, 0, doc.content.size));
}

/**
 * Collect the set of doc-position ranges (in the FINAL-doc coordinate
 * space) that a transaction touched. For multi-step transactions, each
 * step map's newStart/newEnd are in its own intermediate coordinate
 * space, so we remap them through the suffix of the mapping that
 * comes after the step. Ranges are sorted and coalesced so the
 * apply() path scans each region only once.
 */
function changedRanges(tr: Transaction): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  for (let i = 0; i < tr.mapping.maps.length; i++) {
    const map = tr.mapping.maps[i];
    const tail = tr.mapping.slice(i + 1);
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      ranges.push({ from: tail.map(newStart), to: tail.map(newEnd) });
    });
  }
  if (ranges.length === 0) return ranges;
  ranges.sort((a, b) => a.from - b.from);
  const merged: { from: number; to: number }[] = [ranges[0]];
  for (let i = 1; i < ranges.length; i++) {
    const last = merged[merged.length - 1];
    const r = ranges[i];
    if (r.from <= last.to) {
      last.to = Math.max(last.to, r.to);
    } else {
      merged.push({ from: r.from, to: r.to });
    }
  }
  return merged;
}

export const showInvisiblesExtension = Extension.create<unknown, ShowInvisiblesStorage>({
  name: "showInvisibles",

  addStorage() {
    return { enabled: false };
  },

  addProseMirrorPlugins() {
    const { storage } = this;
    return [
      new Plugin<DecorationSet>({
        key: showInvisiblesPluginKey,
        state: {
          init(_, { doc }) {
            return buildDecorations(doc, storage.enabled);
          },
          apply(tr, old) {
            // Force-rebuild marker via meta — set by setShowInvisibles helper
            const force = tr.getMeta(showInvisiblesPluginKey) as
              | { enabled?: boolean }
              | undefined;
            if (force && typeof force.enabled === "boolean") {
              return buildDecorations(tr.doc, force.enabled);
            }
            if (!storage.enabled) return DecorationSet.empty;
            if (tr.doc.content.size > SHOW_INVISIBLES_DOC_SIZE_LIMIT) {
              return DecorationSet.empty;
            }
            if (!tr.docChanged) return old;

            // Incremental update: translate existing decorations through
            // the transaction's step map, then remove and re-scan only
            // the regions the user actually touched. This keeps the
            // per-keystroke cost dominated by O(changed range) for the
            // rescan, instead of O(doc) for the original full walk.
            //
            // Correctness notes:
            //   - DecorationSet.find(from, to) is boundary-inclusive
            //     (any decoration that *touches* the range), so we
            //     filter the result to mirror scanRange's semantics.
            //     Widget decorations (from==to) are removed when
            //     `range.from <= d.from <= range.to` — closed-right,
            //     matching scanRange's `pos >= from && pos <= to`
            //     widget check, so a widget that lands exactly at the
            //     right boundary survives the round-trip. Inline
            //     decorations stay strictly contained, since scanRange
            //     re-emits per-character within [from, to).
            //   - changedRanges() returns ranges already remapped to
            //     final-doc coordinates, so removals + rescans target
            //     the right slice of the new document.
            let updated = old.map(tr.mapping, tr.doc);
            const ranges = changedRanges(tr);
            for (const range of ranges) {
              const overlapping = updated
                .find(range.from, range.to)
                .filter((d) =>
                  d.from === d.to
                    ? // Widget: closed-right, matching scanRange's
                      // `pos >= from && pos <= to` widget check.
                      d.from >= range.from && d.from <= range.to
                    : // Inline: strictly inside the half-open range.
                      d.from >= range.from && d.to <= range.to,
                );
              if (overlapping.length > 0) updated = updated.remove(overlapping);
              const fresh = scanRange(tr.doc, range.from, range.to);
              if (fresh.length > 0) updated = updated.add(tr.doc, fresh);
            }
            return updated;
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
 * Imperative toggle: dispatch a transaction tagged with the plugin's
 * PluginKey so the plugin's apply() sees it and re-runs the decoration
 * builder with the new `enabled` flag. Call from the consumer hook
 * whenever the user flips the setting at runtime — the storage flag
 * still needs to be updated by the caller so subsequent docChanged
 * transactions stay in sync.
 */
export function setShowInvisibles(view: EditorView, enabled: boolean): void {
  view.dispatch(view.state.tr.setMeta(showInvisiblesPluginKey, { enabled }));
}
