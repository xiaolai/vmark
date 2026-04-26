/**
 * i18n initialization module.
 *
 * Purpose: Configures i18next with dynamic locale file loading via
 * import.meta.glob, namespace splitting (common/menu/statusbar/sidebar/settings/editor/ai/dialog),
 * and fallback chains for regional variants (zh-TW → zh-CN → en).
 *
 * Key decisions:
 *   - Uses i18next-resources-to-backend for lazy loading only the
 *     requested language+namespace combination.
 *   - load: "currentOnly" avoids loading both "zh" and "zh-CN" for
 *     regional codes — only the exact requested locale is fetched.
 *   - Language is seeded from settingsStore on startup; runtime changes
 *     are handled by calling i18n.changeLanguage() elsewhere.
 *   - Sets document.documentElement.lang on languageChanged event for
 *     correct assistive-technology announcements.
 *
 * @coordinates-with stores/settingsStore.ts — reads general.language at init
 * @coordinates-with utils/startupMenuSync.ts — rebuilds native menu for non-English locales
 * @module i18n
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import resourcesToBackend from "i18next-resources-to-backend";
import { useSettingsStore } from "@/stores/settingsStore";
import { setSafeStorageMessageResolver } from "@/utils/safeStorage";
import { setWorkspaceStorageMessageResolver } from "@/utils/workspaceStorage";

const localeModules = import.meta.glob("./locales/*/*.json");

/** Supported locale codes — used to validate persisted settings and fallback to "en". */
export const SUPPORTED_LOCALES = new Set(
  Object.keys(localeModules)
    .map((p) => p.split("/")[2]) // "./locales/{lang}/common.json" → lang
    .filter(Boolean)
);

/* v8 ignore start -- @preserve reason: i18next initialization runs at module eval; mocked globally in test setup */
function validateLocale(lang: string): string {
  return SUPPORTED_LOCALES.has(lang) ? lang : "en";
}

i18n
  .use(initReactI18next)
  .use(
    resourcesToBackend((lng: string, ns: string) => {
      const key = `./locales/${lng}/${ns}.json`;
      const loader = localeModules[key];
      if (!loader) return Promise.reject(new Error(`Missing locale: ${key}`));
      return loader() as Promise<{ default: Record<string, string> }>;
    })
  )
  .init({
    lng: validateLocale(useSettingsStore.getState().general.language),
    fallbackLng: {
      "zh-TW": ["zh-CN", "en"],
      "pt-BR": ["en"],
      default: ["en"],
    },
    load: "currentOnly",
    ns: ["common", "statusbar"],  // Boot-critical only; others loaded on demand by useTranslation(ns)
    defaultNS: "common",
    interpolation: {
      escapeValue: false,
    },
    // Make init synchronous so i18n.language is set before the first render.
    // Resources are still loaded lazily per namespace via the backend callback.
    initImmediate: false,
  });

// Set <html lang> on initial load for accessibility/spellcheck
document.documentElement.lang = i18n.resolvedLanguage ?? i18n.language ?? "en";

// Wire up i18n-aware messages for safeStorage quota warnings
setSafeStorageMessageResolver((key) =>
  i18n.t("dialog:toast.localStorageQuotaExceeded", { key })
);
setWorkspaceStorageMessageResolver(() =>
  i18n.t("dialog:toast.workspaceStorageQuotaExceeded")
);
/* v8 ignore stop */

// Update <html lang> on subsequent language changes
i18n.on("languageChanged", (lng) => {
  document.documentElement.lang = lng;
});

// Cross-window sync: when another window changes language via settings sync,
// update this window's i18n instance to match.
/* v8 ignore start -- @preserve reason: cross-window sync subscription only fires in multi-window runtime */
let lastLang = i18n.language;
useSettingsStore.subscribe((state) => {
  const lang = state.general.language;
  if (lang && lang !== lastLang) {
    lastLang = lang;
    i18n.changeLanguage(lang);
  }
});
/* v8 ignore stop */

export default i18n;
