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
      ignored: ["**/src-tauri/**"],
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
        // Chunk policy lives in scripts/manualChunks.ts so it is
        // unit-tested (scripts/manualChunks.test.ts — characterization
        // cases lock every branch). Keep it in lockstep with
        // .size-limit.cjs and scripts/check-eager-chunks.mjs.
        manualChunks,
      },
    },
  },
}));
