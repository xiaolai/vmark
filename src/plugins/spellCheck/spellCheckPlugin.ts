/**
 * Spell Check Plugin
 *
 * ProseMirror plugin that highlights misspelled words with decorations.
 * Follows the pattern from searchPlugin.ts.
 */

import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { useSettingsStore } from "@/stores/settingsStore";
import { useSpellCheckStore } from "@/stores/spellCheckStore";
import { getDictionary, preloadDictionaries } from "./dictionaryManager";
import { tokenizeDocument } from "./tokenizer";
import type { MisspelledWord, NSpellInstance, SpellCheckLanguage } from "./types";
import "./spellCheck.css";

export const spellCheckPluginKey = new PluginKey("spellCheck");

/** Debounce delay for spell checking after typing */
const SPELL_CHECK_DEBOUNCE_MS = 300;

/** Check words against loaded dictionaries */
async function checkWords(
  words: { word: string; from: number; to: number }[],
  languages: SpellCheckLanguage[],
  isIgnored: (word: string) => boolean
): Promise<MisspelledWord[]> {
  if (languages.length === 0) return [];

  // Load all dictionaries
  const dictionaries: NSpellInstance[] = [];
  for (const lang of languages) {
    try {
      const dict = await getDictionary(lang);
      dictionaries.push(dict);
    } catch (e) {
      console.warn(`[SpellCheck] Failed to load dictionary for ${lang}:`, e);
    }
  }

  if (dictionaries.length === 0) return [];

  const misspelled: MisspelledWord[] = [];

  for (const { word, from, to } of words) {
    // Skip ignored words
    if (isIgnored(word)) continue;

    // Check against all dictionaries - word is correct if ANY dictionary accepts it
    const isCorrect = dictionaries.some((dict) => dict.correct(word));

    if (!isCorrect) {
      // Get suggestions from first dictionary
      const suggestions = dictionaries[0].suggest(word).slice(0, 5);
      misspelled.push({ word, from, to, suggestions });
    }
  }

  return misspelled;
}

export const spellCheckPlugin = $prose(() => {
  let misspelledWords: MisspelledWord[] = [];
  let checkTimeout: ReturnType<typeof setTimeout> | null = null;
  let isChecking = false;

  return new Plugin({
    key: spellCheckPluginKey,

    state: {
      init() {
        return { misspelledWords: [] as MisspelledWord[] };
      },
      apply() {
        // State is managed externally via misspelledWords variable
        return { misspelledWords };
      },
    },

    props: {
      decorations(state) {
        const settings = useSettingsStore.getState().markdown;
        if (!settings.spellCheckEnabled) {
          return DecorationSet.empty;
        }

        if (misspelledWords.length === 0) {
          return DecorationSet.empty;
        }

        const decorations = misspelledWords.map((word) =>
          Decoration.inline(word.from, word.to, {
            class: "spell-error",
            "data-suggestions": word.suggestions.join(","),
          })
        );

        return DecorationSet.create(state.doc, decorations);
      },

      handleDOMEvents: {
        contextmenu(view, event) {
          const settings = useSettingsStore.getState().markdown;
          if (!settings.spellCheckEnabled) return false;

          // Find if we right-clicked on a misspelled word
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (!pos) return false;

          const clickedWord = misspelledWords.find(
            (w) => pos.pos >= w.from && pos.pos <= w.to
          );

          if (clickedWord) {
            event.preventDefault();

            // Get position for popup
            const coords = view.coordsAtPos(clickedWord.from);

            useSpellCheckStore.getState().openPopup(
              { top: coords.bottom + 4, left: coords.left },
              { from: clickedWord.from, to: clickedWord.to, text: clickedWord.word },
              clickedWord.suggestions
            );

            return true;
          }

          return false;
        },
      },
    },

    view(editorView) {
      const performSpellCheck = async () => {
        const settings = useSettingsStore.getState().markdown;
        if (!settings.spellCheckEnabled || isChecking) return;

        isChecking = true;

        try {
          const doc = editorView.state.doc;
          const tokens = tokenizeDocument(doc);
          const { isIgnored } = useSpellCheckStore.getState();

          misspelledWords = await checkWords(
            tokens,
            settings.spellCheckLanguages,
            isIgnored
          );

          // Trigger redraw
          editorView.dispatch(editorView.state.tr);
        } catch (e) {
          console.error("[SpellCheck] Error during spell check:", e);
        } finally {
          isChecking = false;
        }
      };

      const scheduleCheck = () => {
        if (checkTimeout) {
          clearTimeout(checkTimeout);
        }
        checkTimeout = setTimeout(performSpellCheck, SPELL_CHECK_DEBOUNCE_MS);
      };

      // Subscribe to settings changes
      let prevEnabled = useSettingsStore.getState().markdown.spellCheckEnabled;
      let prevLanguages = useSettingsStore.getState().markdown.spellCheckLanguages;

      const unsubscribeSettings = useSettingsStore.subscribe((state) => {
        const { spellCheckEnabled, spellCheckLanguages } = state.markdown;

        // If spell check was just enabled, preload dictionaries and check
        if (spellCheckEnabled && !prevEnabled) {
          preloadDictionaries(spellCheckLanguages).then(scheduleCheck);
        }
        // If languages changed while enabled, re-check
        else if (
          spellCheckEnabled &&
          JSON.stringify(spellCheckLanguages) !== JSON.stringify(prevLanguages)
        ) {
          preloadDictionaries(spellCheckLanguages).then(scheduleCheck);
        }
        // If disabled, clear decorations
        else if (!spellCheckEnabled && prevEnabled) {
          misspelledWords = [];
          editorView.dispatch(editorView.state.tr);
        }

        prevEnabled = spellCheckEnabled;
        prevLanguages = spellCheckLanguages;
      });

      // Subscribe to ignored words changes
      const unsubscribeSpellCheck = useSpellCheckStore.subscribe((state, prev) => {
        if (state.ignoredWords.length !== prev.ignoredWords.length) {
          scheduleCheck();
        }
      });

      // Initial check if enabled
      const settings = useSettingsStore.getState().markdown;
      if (settings.spellCheckEnabled) {
        preloadDictionaries(settings.spellCheckLanguages).then(scheduleCheck);
      }

      return {
        update(view, prevState) {
          // Only re-check if document changed
          if (!view.state.doc.eq(prevState.doc)) {
            const settings = useSettingsStore.getState().markdown;
            if (settings.spellCheckEnabled) {
              scheduleCheck();
            }
          }
        },

        destroy() {
          if (checkTimeout) {
            clearTimeout(checkTimeout);
          }
          unsubscribeSettings();
          unsubscribeSpellCheck();
        },
      };
    },
  });
});

export default spellCheckPlugin;
