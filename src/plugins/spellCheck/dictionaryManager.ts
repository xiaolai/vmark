/**
 * Dictionary Manager
 *
 * Lazy-loads Hunspell dictionaries for spell checking.
 * Fetches dictionary files from public/dictionaries/ at runtime.
 */

import nspell from "nspell";
import type { NSpellInstance, SpellCheckLanguage } from "./types";

// Cache for loaded dictionary instances
const dictionaryCache = new Map<SpellCheckLanguage, NSpellInstance>();

// Loading promises to prevent duplicate loads
const loadingPromises = new Map<SpellCheckLanguage, Promise<NSpellInstance>>();

/**
 * Fetch dictionary files for a language from public/dictionaries/.
 */
async function fetchDictionary(
  lang: SpellCheckLanguage
): Promise<{ aff: string; dic: string }> {
  const basePath = "/dictionaries";

  const [affResponse, dicResponse] = await Promise.all([
    fetch(`${basePath}/${lang}.aff`),
    fetch(`${basePath}/${lang}.dic`),
  ]);

  if (!affResponse.ok || !dicResponse.ok) {
    throw new Error(`Failed to load dictionary for ${lang}`);
  }

  const [aff, dic] = await Promise.all([
    affResponse.text(),
    dicResponse.text(),
  ]);

  return { aff, dic };
}

/**
 * Get or create a spell checker instance for a language.
 * Lazy-loads the dictionary on first use.
 */
export async function getDictionary(
  lang: SpellCheckLanguage
): Promise<NSpellInstance> {
  // Return cached instance if available
  const cached = dictionaryCache.get(lang);
  if (cached) return cached;

  // Return existing loading promise if in progress
  const loading = loadingPromises.get(lang);
  if (loading) return loading;

  // Start loading
  const promise = (async () => {
    try {
      const { aff, dic } = await fetchDictionary(lang);
      const instance = nspell({ aff, dic }) as NSpellInstance;
      dictionaryCache.set(lang, instance);
      return instance;
    } finally {
      loadingPromises.delete(lang);
    }
  })();

  loadingPromises.set(lang, promise);
  return promise;
}

/**
 * Preload dictionaries for specified languages.
 * Call this when user enables spell check.
 */
export async function preloadDictionaries(
  languages: SpellCheckLanguage[]
): Promise<void> {
  await Promise.all(languages.map(getDictionary));
}

/**
 * Check if a dictionary is loaded.
 */
export function isDictionaryLoaded(lang: SpellCheckLanguage): boolean {
  return dictionaryCache.has(lang);
}

/**
 * Clear all cached dictionaries.
 */
export function clearDictionaryCache(): void {
  dictionaryCache.clear();
}
