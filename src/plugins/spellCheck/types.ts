/**
 * Spell Check Plugin Types
 */

/** Word token with document position */
export interface WordToken {
  word: string;
  from: number; // ProseMirror document position
  to: number;
}

/** Misspelled word with suggestions */
export interface MisspelledWord extends WordToken {
  suggestions: string[];
}

/** Supported languages */
export type SpellCheckLanguage = "en" | "de" | "es" | "fr" | "ko";

/** Language metadata */
export interface LanguageInfo {
  code: SpellCheckLanguage;
  name: string;
  nativeName: string;
}

/** Available languages with metadata */
export const SUPPORTED_LANGUAGES: LanguageInfo[] = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "de", name: "German", nativeName: "Deutsch" },
  { code: "es", name: "Spanish", nativeName: "Espanol" },
  { code: "fr", name: "French", nativeName: "Francais" },
  { code: "ko", name: "Korean", nativeName: "한국어" },
];

/** NSpell instance type (from nspell package) */
export interface NSpellInstance {
  correct: (word: string) => boolean;
  suggest: (word: string) => string[];
  add: (word: string) => void;
}
