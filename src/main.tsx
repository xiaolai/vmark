import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./i18n";
import "./utils/startupMenuSync";
import { initSecureStorage } from "./utils/secureStorage";
import { bootstrapFormats } from "./lib/formats";
import { useSettingsStore } from "./stores/settingsStore";
import "./styles/index.css";
// KaTeX CSS must load AFTER Tailwind (so preflight runs first).
// KaTeX fixes must load AFTER KaTeX CSS to restore border-widths reset by Tailwind.
import "katex/dist/katex.min.css";
import "./styles/katexFixes.css";

// Pre-load secure storage cache BEFORE importing App.
// App → aiProviderStore → Zustand persist() hydrates at module evaluation time.
// If App is imported statically, hydration reads an empty cache.
const SECURE_KEYS = ["vmark-ai-providers"];

async function bootstrap() {
  await initSecureStorage(SECURE_KEYS);

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

  // Dynamic import: App (and its transitive Zustand stores) only evaluate
  // AFTER the secure storage cache is populated.
  const { default: App } = await import("./App");

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

bootstrap();
