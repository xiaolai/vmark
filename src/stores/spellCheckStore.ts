/**
 * Spell Check Store
 *
 * Manages popup state for spell check suggestions and custom dictionary.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface PopupPosition {
  top: number;
  left: number;
}

interface CurrentWord {
  from: number;
  to: number;
  text: string;
}

interface SpellCheckState {
  // Popup state
  isPopupOpen: boolean;
  popupPosition: PopupPosition | null;
  currentWord: CurrentWord | null;
  suggestions: string[];

  // Custom dictionary (ignored words)
  ignoredWords: string[];
}

interface SpellCheckActions {
  // Popup actions
  openPopup: (
    position: PopupPosition,
    word: CurrentWord,
    suggestions: string[]
  ) => void;
  closePopup: () => void;

  // Custom dictionary actions
  addToIgnored: (word: string) => void;
  removeFromIgnored: (word: string) => void;
  isIgnored: (word: string) => boolean;
  clearIgnored: () => void;
}

// Set for O(1) lookup of ignored words (derived from persisted array)
let ignoredWordsSet = new Set<string>();

export const useSpellCheckStore = create<SpellCheckState & SpellCheckActions>()(
  persist(
    (set) => ({
      // Initial state
      isPopupOpen: false,
      popupPosition: null,
      currentWord: null,
      suggestions: [],
      ignoredWords: [],

      // Popup actions
      openPopup: (position, word, suggestions) => {
        set({
          isPopupOpen: true,
          popupPosition: position,
          currentWord: word,
          suggestions,
        });
      },

      closePopup: () => {
        set({
          isPopupOpen: false,
          popupPosition: null,
          currentWord: null,
          suggestions: [],
        });
      },

      // Custom dictionary actions
      addToIgnored: (word) => {
        const lower = word.toLowerCase();
        if (ignoredWordsSet.has(lower)) return;

        ignoredWordsSet.add(lower);
        set((state) => ({
          ignoredWords: [...state.ignoredWords, lower],
        }));
      },

      removeFromIgnored: (word) => {
        const lower = word.toLowerCase();
        ignoredWordsSet.delete(lower);
        set((state) => ({
          ignoredWords: state.ignoredWords.filter((w) => w !== lower),
        }));
      },

      isIgnored: (word) => {
        return ignoredWordsSet.has(word.toLowerCase());
      },

      clearIgnored: () => {
        ignoredWordsSet.clear();
        set({ ignoredWords: [] });
      },
    }),
    {
      name: "vmark-spellcheck",
      storage: createJSONStorage(() =>
        typeof window !== "undefined"
          ? localStorage
          : {
              getItem: () => null,
              setItem: () => {},
              removeItem: () => {},
            }
      ),
      // Only persist ignoredWords, not popup state
      partialize: (state) => ({ ignoredWords: state.ignoredWords }),
      onRehydrateStorage: () => (state) => {
        // Rebuild the Set from persisted array
        if (state?.ignoredWords) {
          ignoredWordsSet = new Set(state.ignoredWords);
        }
      },
    }
  )
);
