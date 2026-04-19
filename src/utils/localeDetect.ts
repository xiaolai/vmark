/**
 * OS locale detection for first-run language selection.
 *
 * Reads `navigator.language` / `navigator.languages` and maps the result
 * to one of the 10 UI locales VMark ships. Used once at store init when
 * the user has no persisted language preference.
 *
 * @module utils/localeDetect
 */

export const SUPPORTED_LOCALES = [
  "en",
  "zh-CN",
  "zh-TW",
  "ja",
  "ko",
  "de",
  "es",
  "fr",
  "it",
  "pt-BR",
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

const SUPPORTED_SET = new Set<string>(SUPPORTED_LOCALES);

const CANONICAL: Record<string, SupportedLocale> = {
  en: "en",
  ja: "ja",
  ko: "ko",
  de: "de",
  es: "es",
  fr: "fr",
  it: "it",
};

function normalizeTag(tag: string): string {
  return tag.trim();
}

function mapOneTag(raw: string): SupportedLocale | null {
  const tag = normalizeTag(raw).toLowerCase();
  if (!tag) return null;

  const parts = tag.split("-");
  const base = parts[0];

  if (base === "zh") {
    const hasHans = parts.includes("hans");
    const hasHant = parts.includes("hant");
    const region = parts.find((p) => p.length === 2 && p !== "zh");

    if (hasHans) return "zh-CN";
    if (hasHant) return "zh-TW";
    if (region === "tw" || region === "hk" || region === "mo") return "zh-TW";
    return "zh-CN";
  }

  if (base === "pt") {
    return "pt-BR";
  }

  const canonical = CANONICAL[base];
  if (canonical) return canonical;

  if (SUPPORTED_SET.has(raw)) return raw as SupportedLocale;

  return null;
}

/**
 * Resolve the best initial UI language from the user's OS / browser preferences.
 * Never throws. Returns "en" when no supported tag is found.
 */
export function resolveInitialLanguage(): SupportedLocale {
  const nav: Navigator | undefined =
    typeof navigator !== "undefined" ? navigator : undefined;

  const candidates: string[] = [];
  if (nav?.languages && nav.languages.length > 0) {
    candidates.push(...nav.languages);
  } else if (nav?.language) {
    candidates.push(nav.language);
  }

  for (const tag of candidates) {
    const match = mapOneTag(tag);
    if (match) return match;
  }

  return "en";
}
