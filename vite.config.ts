import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { readFileSync } from "node:fs";
import { manualChunks } from "./scripts/manualChunks";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
) as { version: string };

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  define: {
    __VMARK_VERSION__: JSON.stringify(pkg.version),
  },

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "./src/shared"),
    },
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
        chunkFileNames: (chunk) =>
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
