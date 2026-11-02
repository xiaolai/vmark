/**
 * App bootstrap — the startup sequence `main.tsx` runs before first paint.
 *
 * Purpose: fill the secure-storage cache and learn the native theme
 *   capability, bind the composition-root seams (tab-existence guard, plugin
 *   host settings, format registry) while those IPCs are in flight, and only
 *   then load and mount App.
 *
 * Key decisions:
 *   - App is loaded through `loadApp`, which `main.tsx` passes as
 *     `() => import("./App")`. The entry keeps the import site, so the App
 *     chunk and its modulepreload stay exactly as they were; the parameter
 *     exists because "App is loaded only after the cache is filled" is the
 *     contract, and a loader handed in is the one place that can be observed.
 *   - App → aiProviderStore → Zustand persist() hydrates at module evaluation
 *     time, so loading App before the cache is filled hydrates it empty.
 *
 * @coordinates-with main.tsx — the entry that calls it with the App loader
 * @module bootstrap
 */
import React, { type ComponentType } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { initSecureStorage } from "@/services/secrets/secureStorage";
import { bootstrapFormats } from "@/lib/formats";
import { useSettingsStore } from "@/stores/settingsStore";
import { setTabExistenceGuard } from "@/stores/documentStore";
import { bindPluginHostSettings } from "@/services/assembly/bindHostSettings";
import { useTabStore } from "@/stores/tabStore";
import { platformRootClass } from "@/utils/platform";
import { loadNativeThemeCapability } from "@/services/theme/nativeThemeCapability";
import { installPageSelectAllGuard } from "@/services/commands/pageSelectAllGuard";

/** Secure-storage keys App's stores hydrate from at module evaluation. */
const SECURE_KEYS = ["vmark-ai-providers"];

/** Loads the App module — a dynamic import, so it evaluates when called. */
export type AppLoader = () => Promise<{ default: ComponentType }>;

export async function bootstrap(loadApp: AppLoader): Promise<void> {
  // Platform root class, before first paint — index.css keys the
  // D7 cursor split off it (arrow on macOS, pointer elsewhere).
  document.documentElement.classList.add(platformRootClass());

  // Every window, for its whole life: a Select All from the native Edit menu
  // with focus outside a field would otherwise select the entire page.
  installPageSelectAllGuard();

  // Started now, awaited just before App is loaded: the setup below reads no
  // secure-storage key (only the AI provider store in App does), so it runs
  // while the store's IPCs are in flight. index.html modulepreloads the App
  // chunk, so its download overlaps them too. initSecureStorage never rejects.
  const secureStorageReady = initSecureStorage(SECURE_KEYS);
  // In parallel with it: whether this window's native chrome can follow every
  // theme (Windows 11). Known before first render, so a tinted theme paints as
  // itself from the first frame instead of as White first. Never rejects.
  const nativeThemeReady = loadNativeThemeCapability();

  // C1 defense-in-depth: teach documentStore.initDocument to skip writes for
  // tabs that no longer exist (closed mid-file-read). Wired here at the
  // composition root so documentStore stays decoupled from tabStore and pure
  // store unit tests remain permissive.
  setTabExistenceGuard((tabId) => useTabStore.getState().findTabById(tabId) !== null);

  // ADR-015: point the plugins' host-settings seam at the real store. Plugins
  // depend on that seam, not on `@/stores`, so they still run when lifted out
  // of this repo — this is what makes them read the USER's preferences here.
  // Bound at the composition root, not at editor creation: the Source-mode
  // plugins that read it are not built by the Tiptap factory.
  bindPluginHostSettings();

  // Register every format adapter before App imports any store that
  // calls dispatchEditor() (e.g., tabStore.createTab). Honor the user's
  // opt-in toggles — markdown, txt, and yaml always register; the rest
  // depend on `settings.formats.*`. The runtime re-bootstrap subscription
  // is mounted by document windows only (see useFormatSettingsBridge in
  // App.tsx) so non-document windows like Settings / PDF Export don't
  // pull tabStore + registry orchestration.
  const initialFormats = useSettingsStore.getState().formats;
  bootstrapFormats({
    dataFormats: initialFormats.dataFormats,
    diagrams: initialFormats.diagrams,
    htmlPreview: initialFormats.htmlPreview,
    codeViewers: initialFormats.codeViewers,
  });

  // App (and its transitive Zustand stores) only evaluate AFTER the secure
  // storage cache is populated.
  await Promise.all([secureStorageReady, nativeThemeReady]);
  const { default: App } = await loadApp();

  const rootElement = document.getElementById("root");
  if (!rootElement) {
    throw new Error("Root element not found");
  }

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  );
}
