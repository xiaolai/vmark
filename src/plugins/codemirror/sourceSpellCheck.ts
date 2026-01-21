/**
 * Source Mode Spell Check Plugin
 *
 * CodeMirror 6 plugin for spell checking in Source mode.
 * Uses the same dictionary manager as the WYSIWYG spell check.
 *
 * Features:
 * - Red wavy underline for misspelled words
 * - Right-click context menu with suggestions
 * - Debounced checking on document changes
 * - Skips code blocks, inline code, URLs, numbers
 */

import { RangeSetBuilder, StateField, StateEffect, type Text } from "@codemirror/state";
import {
  EditorView,
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { useSettingsStore } from "@/stores/settingsStore";
import { useSpellCheckStore } from "@/stores/spellCheckStore";
import { getDictionary, preloadDictionaries } from "@/plugins/spellCheck/dictionaryManager";
import type { MisspelledWord, NSpellInstance, SpellCheckLanguage } from "@/plugins/spellCheck/types";
import { runOrQueueCodeMirrorAction } from "@/utils/imeGuard";
import { createSourceSpellCheckPopupPlugin } from "./sourceSpellCheckPopup";

const SPELL_CHECK_DEBOUNCE_MS = 300;

/**
 * Regex to match words including contractions (don't, it's).
 */
const WORD_REGEX = /[\p{L}]+(?:[''][\p{L}]+)*/gu;

/**
 * Patterns to skip (URLs, emails, etc.)
 */
const SKIP_PATTERNS = [
  /https?:\/\/\S+/gi,
  /www\.\S+/gi,
  /\S+@\S+\.\S+/gi,
  /\d+/g,
];

/**
 * Mask skip patterns with spaces to preserve positions.
 */
function maskSkipPatterns(text: string): string {
  let masked = text;
  for (const pattern of SKIP_PATTERNS) {
    masked = masked.replace(pattern, (match) => " ".repeat(match.length));
  }
  return masked;
}

/**
 * Find frontmatter line range at the top of the document.
 */
function getFrontmatterLineRange(doc: Text): { from: number; to: number } | null {
  if (doc.lines < 2) return null;
  const firstLine = doc.line(1).text.trim();
  if (firstLine !== "---") return null;

  for (let i = 2; i <= doc.lines; i++) {
    const lineText = doc.line(i).text.trim();
    if (lineText === "---" || lineText === "...") {
      return { from: 1, to: i };
    }
  }
  return null;
}

/**
 * Extract words from visible ranges, skipping code and frontmatter.
 */
function tokenizeSourceDocument(
  doc: Text,
  visibleLineRanges: Array<{ from: number; to: number }>
): { word: string; from: number; to: number }[] {
  const tokens: { word: string; from: number; to: number }[] = [];
  if (visibleLineRanges.length === 0) return tokens;

  const frontmatter = getFrontmatterLineRange(doc);
  const maxVisibleLine = Math.max(...visibleLineRanges.map((r) => r.to));

  const isLineVisible = (lineNumber: number) =>
    visibleLineRanges.some((range) => lineNumber >= range.from && lineNumber <= range.to);

  let inCodeBlock = false;
  for (let i = 1; i <= Math.min(doc.lines, maxVisibleLine); i++) {
    const line = doc.line(i);
    const lineText = line.text;

    const inFrontmatter =
      frontmatter && i >= frontmatter.from && i <= frontmatter.to;
    if (inFrontmatter) {
      continue;
    }

    if (/^\s*```/.test(lineText) || /^\s*~~~/.test(lineText)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      continue;
    }

    if (!isLineVisible(i)) {
      continue;
    }

    let text = line.text;

    // Skip inline code by masking with spaces
    text = text.replace(/`[^`]+`/g, (match) => " ".repeat(match.length));

    // Apply skip patterns
    const masked = maskSkipPatterns(text);

    // Find words
    let match: RegExpExecArray | null;
    WORD_REGEX.lastIndex = 0;

    while ((match = WORD_REGEX.exec(masked)) !== null) {
      const word = match[0];
      if (word.length >= 2) {
        tokens.push({
          word,
          from: line.from + match.index,
          to: line.from + match.index + word.length,
        });
      }
    }
  }

  return tokens;
}

/**
 * Check words against dictionaries.
 */
async function checkWords(
  words: { word: string; from: number; to: number }[],
  languages: SpellCheckLanguage[],
  isIgnored: (word: string) => boolean
): Promise<MisspelledWord[]> {
  if (languages.length === 0) return [];

  const dictionaries: NSpellInstance[] = [];
  for (const lang of languages) {
    try {
      const dict = await getDictionary(lang);
      dictionaries.push(dict);
    } catch (e) {
      console.warn(`[SourceSpellCheck] Failed to load dictionary for ${lang}:`, e);
    }
  }

  if (dictionaries.length === 0) return [];

  const misspelled: MisspelledWord[] = [];

  for (const { word, from, to } of words) {
    if (isIgnored(word)) continue;

    const isCorrect = dictionaries.some((dict) => dict.correct(word));

    if (!isCorrect) {
      const suggestions = dictionaries[0].suggest(word).slice(0, 5);
      misspelled.push({ word, from, to, suggestions });
    }
  }

  return misspelled;
}

// State effect to update misspelled words
const setMisspelledWords = StateEffect.define<MisspelledWord[]>();

// State field to store misspelled words
const misspelledWordsField = StateField.define<MisspelledWord[]>({
  create() {
    return [];
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setMisspelledWords)) {
        return effect.value;
      }
    }
    return value;
  },
});

// Decoration style for misspelled words
const spellErrorMark = Decoration.mark({ class: "spell-error" });

/**
 * Create decorations from misspelled words.
 */
function buildSpellDecorations(words: MisspelledWord[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  // Sort by position for RangeSetBuilder
  const sorted = [...words].sort((a, b) => a.from - b.from);

  for (const word of sorted) {
    builder.add(word.from, word.to, spellErrorMark);
  }

  return builder.finish();
}

/**
 * Creates the source spell check plugin.
 */
export function createSourceSpellCheckPlugin() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      checkTimeout: ReturnType<typeof setTimeout> | null = null;
      isChecking = false;
      unsubscribeSettings: (() => void) | null = null;
      unsubscribeSpellCheck: (() => void) | null = null;

      constructor(private view: EditorView) {
        // Subscribe to settings changes
        let prevEnabled = useSettingsStore.getState().markdown.spellCheckEnabled;
        let prevLanguages = useSettingsStore.getState().markdown.spellCheckLanguages;

        this.unsubscribeSettings = useSettingsStore.subscribe((state) => {
          const { spellCheckEnabled, spellCheckLanguages } = state.markdown;

          if (spellCheckEnabled && !prevEnabled) {
            preloadDictionaries(spellCheckLanguages).then(() => this.scheduleCheck());
          } else if (
            spellCheckEnabled &&
            JSON.stringify(spellCheckLanguages) !== JSON.stringify(prevLanguages)
          ) {
            preloadDictionaries(spellCheckLanguages).then(() => this.scheduleCheck());
          } else if (!spellCheckEnabled && prevEnabled) {
            this.clearMisspelledWords();
          }

          prevEnabled = spellCheckEnabled;
          prevLanguages = spellCheckLanguages;
        });

        // Subscribe to spell check store (ignored words changes)
        this.unsubscribeSpellCheck = useSpellCheckStore.subscribe((state, prev) => {
          if (state.ignoredWords.length !== prev.ignoredWords.length) {
            this.scheduleCheck();
          }
        });

        // Initial check if enabled
        const settings = useSettingsStore.getState().markdown;
        if (settings.spellCheckEnabled) {
          preloadDictionaries(settings.spellCheckLanguages).then(() => this.scheduleCheck());
        }
      }

      update(update: ViewUpdate) {
        // Update decorations from state field
        const words = update.state.field(misspelledWordsField, false);
        if (words) {
          const settings = useSettingsStore.getState().markdown;
          if (settings.spellCheckEnabled) {
            this.decorations = buildSpellDecorations(words);
          } else {
            this.decorations = Decoration.none;
          }
        }

        // Schedule check on document or viewport change
        if (update.docChanged || update.viewportChanged) {
          const settings = useSettingsStore.getState().markdown;
          if (settings.spellCheckEnabled) {
            this.scheduleCheck();
          }
        }
      }

      scheduleCheck() {
        if (this.checkTimeout) {
          clearTimeout(this.checkTimeout);
        }
        this.checkTimeout = setTimeout(() => this.performSpellCheck(), SPELL_CHECK_DEBOUNCE_MS);
      }

      async performSpellCheck() {
        const settings = useSettingsStore.getState().markdown;
        if (!settings.spellCheckEnabled || this.isChecking) return;

        this.isChecking = true;

        try {
          const doc = this.view.state.doc;
          const visibleLineRanges = this.view.visibleRanges.map((range) => ({
            from: doc.lineAt(range.from).number,
            to: doc.lineAt(range.to).number,
          }));
          const tokens = tokenizeSourceDocument(doc, visibleLineRanges);
          const { isIgnored } = useSpellCheckStore.getState();

          const misspelled = await checkWords(
            tokens,
            settings.spellCheckLanguages,
            isIgnored
          );

          runOrQueueCodeMirrorAction(this.view, () => {
            this.view.dispatch({
              effects: setMisspelledWords.of(misspelled),
            });
          });
        } catch (e) {
          console.error("[SourceSpellCheck] Error during spell check:", e);
        } finally {
          this.isChecking = false;
        }
      }

      clearMisspelledWords() {
        runOrQueueCodeMirrorAction(this.view, () => {
          this.view.dispatch({
            effects: setMisspelledWords.of([]),
          });
        });
        this.decorations = Decoration.none;
      }

      destroy() {
        if (this.checkTimeout) {
          clearTimeout(this.checkTimeout);
        }
        if (this.unsubscribeSettings) {
          this.unsubscribeSettings();
        }
        if (this.unsubscribeSpellCheck) {
          this.unsubscribeSpellCheck();
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );
}

/**
 * Find misspelled word at a given position.
 */
export function getMisspelledWordAtPos(
  view: EditorView,
  pos: number
): MisspelledWord | null {
  const words = view.state.field(misspelledWordsField, false);
  if (!words) return null;

  return words.find((w) => pos >= w.from && pos <= w.to) || null;
}

/**
 * Creates a context menu handler for spell check.
 */
export function createSpellCheckContextMenu() {
  return EditorView.domEventHandlers({
    contextmenu(event, view) {
      const settings = useSettingsStore.getState().markdown;
      if (!settings.spellCheckEnabled) return false;

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;

      const word = getMisspelledWordAtPos(view, pos);
      if (!word) return false;

      event.preventDefault();

      const coords = view.coordsAtPos(word.from);
      if (!coords) return false;

      useSpellCheckStore.getState().openPopup(
        { top: coords.bottom + 4, left: coords.left },
        { from: word.from, to: word.to, text: word.word },
        word.suggestions
      );

      return true;
    },
  });
}

/**
 * Get all extensions needed for source spell check.
 */
export const sourceSpellCheckExtensions = [
  misspelledWordsField,
  createSourceSpellCheckPlugin(),
  createSpellCheckContextMenu(),
  createSourceSpellCheckPopupPlugin(),
];
