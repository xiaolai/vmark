import { defineConfig, type Plugin } from "vite";
import { sourceAliases } from "./vitest.shared.ts";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { chunkFileNames, manualChunks } from "./scripts/manualChunks.ts";

const host = process.env.TAURI_DEV_HOST;

/** The module `src/main.tsx` awaits with `import("./App")` before first paint. */
const BOOT_MODULE = "/src/App.tsx";

/** Source modules E2E journeys `import()` in the page; see `optimizeDeps.entries`. */
const E2E_RUNTIME_IMPORTS = [
  "src/export/renderMarkdownToHtml.ts",
  "src/export/htmlExport.ts",
  "src/export/printDocument.ts",
  "src/export/pdfHtmlTemplate.ts",
  "src/export/themeSnapshot.ts",
  "src/export/htmlExportStyles.ts",
  "src/export/pageSpec.ts",
  "src/export/pdfOptions.ts",
  "src/test/focusFacts.ts",
  "src/test/focusFactHost.ts",
];

/** The slice of a Rollup output item the boot preload reads. */
interface BundleItem {
  type: "chunk" | "asset";
  fileName: string;
  isEntry?: boolean;
  facadeModuleId?: string | null;
  imports?: readonly string[];
}

/**
 * Files to modulepreload for the boot chunk: the chunk itself and its static
 * import closure, minus what the entry's own closure already preloads.
 *
 * Vite annotates index.html with the ENTRY's static imports only. The App
 * chunk is reached through a dynamic import, so its fetch and parse used to
 * start only after `initSecureStorage` — two IPC round trips — had resolved.
 * A modulepreload fetches and compiles a module WITHOUT evaluating it, so the
 * download overlaps those IPCs while App's stores still hydrate after the
 * secure-storage cache is filled. Throws when there is no boot chunk: a
 * renamed App must fail the build, not silently drop the preload.
 */
export function bootChunkPreloads(
  bundle: Record<string, BundleItem>,
  bootModule: string = BOOT_MODULE,
): string[] {
  const chunks = Object.values(bundle).filter((item) => item.type === "chunk");
  const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const closure = (roots: readonly string[]): string[] => {
    const seen: string[] = [];
    const visit = (file: string) => {
      if (seen.includes(file) || !byFile.has(file)) return;
      seen.push(file);
      for (const next of byFile.get(file)?.imports ?? []) visit(next);
    };
    roots.forEach(visit);
    return seen;
  };
  const boot = chunks.find((chunk) => chunk.facadeModuleId?.endsWith(bootModule));
  if (!boot) throw new Error(`boot preload: no chunk is built from ${bootModule}`);
  const preloadedByEntry = new Set(closure(chunks.filter((c) => c.isEntry).map((c) => c.fileName)));
  return closure([boot.fileName]).filter((file) => !preloadedByEntry.has(file));
}

/** Emit `<link rel="modulepreload">` tags for `bootChunkPreloads` (build only). */
function bootChunkPreload(): Plugin {
  let base = "/";
  return {
    name: "vmark:boot-chunk-preload",
    apply: "build",
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        if (!ctx.bundle) return [];
        return bootChunkPreloads(ctx.bundle as Record<string, BundleItem>).map((file) => ({
          tag: "link",
          attrs: { rel: "modulepreload", crossorigin: true, href: `${base}${file}` },
          injectTo: "head" as const,
        }));
      },
    },
  };
}

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
) as { version: string };

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss(), bootChunkPreload()],

  define: {
    __VMARK_VERSION__: JSON.stringify(pkg.version),
  },

  resolve: {
    alias: sourceAliases(import.meta.dirname),
  },

  // Pre-bundle heavy dependencies to speed up dev server startup
  optimizeDeps: {
    // The startup scan crawls these roots for bare imports. Setting `entries`
    // replaces the default HTML crawl, so index.html stays first. The rest are
    // the modules E2E journeys `import()` at runtime: one the app never reaches
    // (src/test/ imports `vitest`) would otherwise make Vite discover a dep
    // mid-run, re-optimize and full-reload the page under the journey.
    // `e2e/journeyImportsPrebundled.test.mjs` holds this list to the journeys.
    entries: ["index.html", ...E2E_RUNTIME_IMPORTS],
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
        // Two chunks need a name a size budget can glob, and get it by
        // renaming the EMITTED FILE only — chunk membership is untouched
        // (pinning in manualChunks drags dependencies along). The Settings
        // page (`Settings-*` collides by case with the i18n `settings-*`
        // locale chunks, which size-limit 13's case-insensitive globs swept
        // into the page's budget) and the shared Settings primitives
        // (`components-*`, too generic). See scripts/manualChunks.ts.
        chunkFileNames,
        // Chunk policy lives in scripts/manualChunks.ts so it is
        // unit-tested (scripts/manualChunks.test.ts — characterization
        // cases lock every branch). Keep it in lockstep with
        // .size-limit.cjs and scripts/check-eager-chunks.mjs.
        manualChunks,
      },
    },
  },
}));
