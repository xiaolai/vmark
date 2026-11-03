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
 *   - A namespace is loaded at boot when something in EVERY window reads it
 *     outside React — a store, a service or a plugin has no hook to load it,
 *     and i18next will not load a namespace just because a key names it. Every
 *     other namespace is loaded by the component that reads it.
 *   - Language is seeded from settingsStore on startup; runtime changes
 *     follow the setting through a store subscription, and the last
 *     requested language wins even when an earlier locale is still loading.
 *   - Sets document.documentElement.lang on languageChanged event for
 *     correct assistive-technology announcements.
 *
 * @coordinates-with stores/settingsStore.ts — reads general.language at init
 * @coordinates-with services/menu/startupMenuSync.ts — rebuilds native menu for non-English locales
 * @module i18n
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import resourcesToBackend from "i18next-resources-to-backend";
import { useSettingsStore } from "@/stores/settingsStore";
import { i18nWarn } from "@/utils/debug";
import { setSafeStorageMessageResolver } from "@/services/persistence/safeStorage";
import { setWorkspaceStorageMessageResolver } from "@/services/persistence/workspaceStorage";

const localeModules = import.meta.glob("./locales/*/*.json");

/** Supported locale codes — used to validate persisted settings and fallback to "en". */
const SUPPORTED_LOCALES = new Set(
  Object.keys(localeModules)
    .map((p) => p.split("/")[2]) // "./locales/{lang}/common.json" → lang
    .filter(Boolean)
);

/* v8 ignore start -- @preserve reason: i18next initialization runs at module eval; mocked globally in test setup */
function validateLocale(lang: string): string {
  return SUPPORTED_LOCALES.has(lang) ? lang : "en";
}

// `init` resolves even though `initAsync: false` makes the FIRST pass
// synchronous: lazy namespace loads still settle later, and a rejected locale
// import would otherwise surface only as an unhandled rejection with no clue
// which namespace failed.
void i18n
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
    // Boot-critical: every window loads these at startup.
    //
    // "common", "statusbar", "commands" and "dialog" are read from stores,
    // services and the CommandBus — code that runs before any React tree can
    // ask for a namespace. "editor", "workflowEditor", "export" and "ai" are
    // read the same way: the editor's plugins build their DOM without a hook,
    // the git-journal export command runs in the main window (which never
    // mounts the export panel), and the provider store reports a keychain
    // failure from the Settings window.
    //
    // A namespace left out of this list has to be named in the
    // `useTranslation(...)` call of the component that reads it — i18next
    // strips an `ns:` prefix off a key and then looks the key up in a
    // namespace nobody loaded, which answers with the key itself.
    ns: [
      "common",
      "statusbar",
      "commands",
      "dialog",
      "editor",
      "workflowEditor",
      "export",
      "ai",
    ],
    defaultNS: "common",
    interpolation: {
      escapeValue: false,
    },
    // Make init synchronous so i18n.language is set before the first render.
    // Resources are still loaded lazily per namespace via the backend callback.
    // (i18next v26 renamed `initImmediate` back to `initAsync` — same semantics.)
    initAsync: false,
  })
  .catch((e) => i18nWarn("i18n initialisation failed:", e));

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

// Follow the language setting — changed here, or in another window and
// delivered by settings sync — into this window's i18n instance.
//
// The last REQUESTED language wins. The guard below compares against what was
// last asked for, not what last finished loading: comparing against the
// committed language dropped a switch back to it made while another locale
// was still loading ("ja", then "en"), and the late locale then took over the
// UI while the setting said otherwise. i18next applies only its newest
// changeLanguage when loads overlap, so requesting every change in order is
// enough to make the last one win.
let lastRequested: string | undefined = i18n.language;
// Monotonic id of the most recent request, so only a failure of the NEWEST
// request reopens the guard.
let langRequestId = 0;
useSettingsStore.subscribe((state) => {
  const lang = state.general.language;
  if (!lang || lang === lastRequested) return;
  lastRequested = lang;
  const requestId = ++langRequestId;
  i18n.changeLanguage(lang).catch((error: unknown) => {
    // A failed switch (missing bundle) must not leave the guard claiming it
    // happened, or the next settings emission would never retry it.
    if (requestId === langRequestId) lastRequested = undefined;
    i18nWarn("changeLanguage failed; keeping previous locale", error);
  });
});

export default i18n;
