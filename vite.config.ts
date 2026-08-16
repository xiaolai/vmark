import { defineConfig } from "vite";
import { sourceAliases } from "./vitest.shared.ts";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { manualChunks } from "./scripts/manualChunks.ts";

const host = process.env.TAURI_DEV_HOST;

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
) as { version: string };

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],

  define: {
    __VMARK_VERSION__: JSON.stringify(pkg.version),
  },

  resolve: {
    alias: sourceAliases(import.meta.dirname),
  },

  // Pre-bundle heavy dependencies to speed up dev server startup
  optimizeDeps: {
    include: [
      // CodeMirror
      "@codemirror/state",
      "@codemirror/view",
      "@codemirror/commands",
      "@codemirror/lang-markdown",
      "@codemirror/language",
      "@codemirror/language-data",
      "@codemirror/autocomplete",
      "@codemirror/search",
      // Heavy utilities (mermaid is lazy-loaded, not included here)
      "katex",
      // Tauri APIs
      "@tauri-apps/api/core",
      "@tauri-apps/api/event",
      "@tauri-apps/api/webviewWindow",
      "@tauri-apps/plugin-dialog",
      "@tauri-apps/plugin-fs",
      // React ecosystem
      "react",
      "react-dom",
      "react-router-dom",
      "zustand",
    ],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // Vite full-reloads the page for ANY watched file it cannot map to a
      // module — not just source. Two ways that bites a VMark developer:
      //
      //   1. Build/test output. `pnpm test:coverage` writes ~1600 HTML files
      //      into coverage/, and each one fired a reload — 1620 in a single run,
      //      which tears down whatever the app was doing. Most visibly it
      //      destroys the terminal panel, reading as "the terminal closed by
      //      itself" seconds after an unrelated test run started.
      //   2. CONTENT. VMark is a markdown editor and we dogfood it on this very
      //      repo, so saving AGENTS.md from inside the app reloaded the app —
      //      losing the workspace on every Cmd+S. Reproduced with a bare
      //      `touch README.md`.
      //
      // Nothing here is imported by the app (no module imports a `.md`), so
      // ignoring it costs no HMR. `.git` matters too: a commit rewrites dozens
      // of files under it and would reload the app mid-operation.
      ignored: [
        // Build and test output
        "**/src-tauri/**",
        "**/coverage/**",
        "**/dist/**",
        "**/__screenshots__/**",
        "**/reports/**",
        "**/tmp/**",
        // Content and docs — edited BY the app, never imported by it
        "**/*.md",
        "**/website/**",
        "**/docs/**",
        "**/dev-docs/**",
        "**/.vmark/**",
        // Repository plumbing
        "**/.git/**",
        "**/e2e/**",
      ],
    },
  },

  build: {
    // The ONLY engine this bundle ever runs in is the macOS WKWebView, so the
    // target names one Safari version rather than a browser matrix.
    //
    // Set explicitly because the default is not a constant: Vite's
    // `baseline-widely-available` resolves to a set pinned to a date fixed per
    // Vite MAJOR, so upgrading Vite silently raises the oldest macOS that can
    // run VMark. Left unset, it did exactly that — the app claimed macOS 10.15
    // while emitting Safari-16.4 syntax, and a macOS 12 user got a window that
    // rendered nothing, because the bundle failed to PARSE before any of our
    // code, error handling or logging could run (issue #1278).
    //
    // This is NOT a no-op pin of the previous behaviour. The default was the
    // five-entry list `[chrome111, edge111, firefox114, safari16.4, ios16.4]`,
    // and esbuild downlevels to satisfy ALL of them — so the app was carrying
    // transforms for three engines it never runs in. Measured: 35,724 KB →
    // 35,716 KB of `dist`. Small, because Safari is nearly always the binding
    // constraint, which is also why nobody noticed the other four were there.
    //
    // The browser-facing artifact is unaffected: `src/export/reader/` reaches
    // exported HTML through a `?raw` import, so Vite ships it verbatim and no
    // target applies to it. Its compatibility is a property of how it is
    // written, not of this line.
    //
    // `pnpm lint:webview-floor` ties this to tauri.conf.json's
    // minimumSystemVersion and website/download.md. Lowering it to widen
    // support is a real project, not a one-line edit: our own source needs
    // only Safari 15.4 (structuredClone, Object.hasOwn), but 54 `color-mix()`
    // declarations across 20 stylesheets need 16.2, dependencies are unaudited,
    // and no runner in this CI can execute an older WebKit to prove any of it.
    target: "safari16.4",
    // Vendor chunks (mermaid ~1.7MB, codemirror ~1MB, index ~2.5MB) exceed
    // default 500kB limit. These are already manually chunked — suppress noise.
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        // Stable entry-chunk name so .size-limit.cjs can budget it with a
        // glob — hash-pinned `index-<hash>*` globs silently rotted and the
        // 1.2 MB entry chunk went unbudgeted (audit 20260612 H9).
        entryFileNames: "assets/entry-[hash].js",
        // The Settings page emits as `Settings-<hash>.js`, and the i18n locale
        // chunks built from src/locales/<lang>/settings.json emit as
        // `settings-<hash>.js` — differing ONLY by case. size-limit 13 matches
        // globs case-insensitively (12 did not), so the page's 101 kB budget
        // silently swept in ten ~45 kB locale chunks and reported 541 kB
        // against a healthy 99.6 kB bundle. Glob negation cannot separate them
        // (the exclude matches both cases), and pinning the page in
        // manualChunks drags its transitive deps in (2.8 MB), so rename the
        // EMITTED FILE only — chunk membership is untouched.
        chunkFileNames: (chunk: { name: string }) =>
          chunk.name === "Settings"
            ? "assets/SettingsPage-[hash].js"
            : "assets/[name]-[hash].js",
        // Chunk policy lives in scripts/manualChunks.ts so it is
        // unit-tested (scripts/manualChunks.test.ts — characterization
        // cases lock every branch). Keep it in lockstep with
        // .size-limit.cjs and scripts/check-eager-chunks.mjs.
        manualChunks,
      },
    },
  },
}));
