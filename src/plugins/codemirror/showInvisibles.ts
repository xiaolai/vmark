/**
 * Show Invisibles plugin for CodeMirror (Source mode).
 *
 * Purpose: Renders normally-invisible characters as visible glyphs when
 * the user enables `settings.markdown.showInvisibles`. Source mode shows
 * the raw markdown text, so we visualize:
 *
 *   - Space         →  ·    (U+00B7 middle dot)
 *   - Tab           →  →    (U+2192 rightwards arrow)
 *   - Soft break    →  ↓    (U+2193 downwards arrow) — single \n inside a paragraph
 *   - Hard break    →  ⏎    (U+23CE return symbol) — two-space, backslash, or <br>
 *
 * Each visible space/tab is replaced by a widget that renders the glyph
 * but preserves cursor positions (widget is inline, non-block). Line
 * breaks are rendered via a line decoration that appends a ::after
 * pseudo-element with the appropriate glyph; this avoids inserting
 * widgets into the line itself and keeps the doc text intact.
 *
 * @coordinates-with stores/settingsStore.ts — reads markdown.showInvisibles
 * @coordinates-with services/assembly/sourceEditorExtensions.ts — registers via Compartment
 * @module plugins/codemirror/showInvisibles
 */

import { RangeSetBuilder } from "@codemirror/state";
import {
  EditorView,
  Decoration,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

class GlyphWidget extends WidgetType {
  constructor(private readonly glyph: string, private readonly kind: string) {
    super();
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = `cm-invisible cm-invisible-${this.kind}`;
    el.textContent = this.glyph;
    el.setAttribute("aria-hidden", "true");
    return el;
  }
  eq(other: GlyphWidget) {
    return this.glyph === other.glyph && this.kind === other.kind;
  }
  ignoreEvent() {
    return false;
  }
}

const spaceWidget = Decoration.replace({ widget: new GlyphWidget("·", "space") });
const tabWidget = Decoration.replace({ widget: new GlyphWidget("→", "tab") });
const softBreakLine = Decoration.line({ class: "cm-invisible-soft-break" });
const hardBreakLine = Decoration.line({ class: "cm-invisible-hard-break" });

/**
 * Classify the end of a non-blank line as a soft or hard break by
 * looking at the line's trailing characters and the next line.
 *
 * Returns null when the line is blank (no break marker needed; the
 * next non-blank line is a new paragraph but the empty line itself is
 * just empty).
 */
function classifyLineEnd(
  thisLineText: string,
  hasNextLine: boolean,
): "soft" | "hard" | null {
  if (thisLineText.length === 0) return null;
  if (!hasNextLine) return null;
  // Hard break: trailing two-space, or trailing backslash, or literal <br>
  if (/  +$/.test(thisLineText)) return "hard";
  if (/\\$/.test(thisLineText)) return "hard";
  if (/<br\s*\/?>$/i.test(thisLineText.trimEnd())) return "hard";
  return "soft";
}

export function createShowInvisiblesPlugin(enabled: boolean) {
  if (!enabled) return [];

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = this.build(update.view);
        }
      }

      build(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        const doc = view.state.doc;

        // Iterate visible viewport ranges only — keeps large-document
        // perf bounded. Within each range, walk line-by-line and add
        // the line decoration (at line.from) BEFORE any char widget
        // decorations on that line: RangeSetBuilder requires strictly
        // non-decreasing `from`, and `line.from` is always <= any
        // char position within the line.
        for (const { from, to } of view.visibleRanges) {
          const firstLine = doc.lineAt(from).number;
          const lastLine = doc.lineAt(to).number;

          for (let n = firstLine; n <= lastLine; n++) {
            const line = doc.line(n);

            // Line-end marker first (at line.from) so ordering is monotonic.
            const hasNext = n < doc.lines;
            const kind = classifyLineEnd(line.text, hasNext);
            if (kind === "soft") {
              builder.add(line.from, line.from, softBreakLine);
            } else if (kind === "hard") {
              builder.add(line.from, line.from, hardBreakLine);
            }

            // Then per-character widgets for spaces/tabs in the visible
            // slice of this line.
            const lineEnd = Math.min(line.to, to);
            const startInLine = Math.max(from - line.from, 0);
            const endInLine = lineEnd - line.from;
            const slice = line.text.slice(startInLine, endInLine);
            for (let i = 0; i < slice.length; i++) {
              const ch = slice[i];
              const absPos = line.from + startInLine + i;
              if (ch === " ") {
                builder.add(absPos, absPos + 1, spaceWidget);
              } else if (ch === "\t") {
                builder.add(absPos, absPos + 1, tabWidget);
              }
            }
          }
        }

        return builder.finish();
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );
}

export const showInvisiblesTheme = EditorView.baseTheme({
  ".cm-invisible": {
    color: "var(--md-char-color)",
    opacity: "0.5",
    fontStyle: "normal",
  },
  ".cm-invisible-soft-break::after": {
    content: '"↓"',
    color: "var(--md-char-color)",
    opacity: "0.5",
    marginLeft: "2px",
  },
  ".cm-invisible-hard-break::after": {
    content: '"⏎"',
    color: "var(--md-char-color)",
    opacity: "0.5",
    marginLeft: "2px",
  },
  "@media print": {
    ".cm-invisible, .cm-invisible-soft-break::after, .cm-invisible-hard-break::after": {
      display: "none !important",
    },
  },
});
