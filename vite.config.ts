import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
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
      "@tanstack/react-query",
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
    // Keep warnings meaningful but avoid noise after intentional chunking.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;

          const parts = id.split("node_modules/");
          const pkgPath = parts[parts.length - 1] ?? "";
          const pkgName = pkgPath.startsWith("@")
            ? pkgPath.split("/").slice(0, 2).join("/")
            : pkgPath.split("/")[0];

          if (pkgName.startsWith("@lezer/")) return "vendor-lezer";
          if (pkgName === "@codemirror/language-data") return "vendor-codemirror-languages";
          // Keep all @codemirror packages together to avoid circular dependency issues
          // Previously splitting @codemirror/lang-* and @codemirror/language caused
          // "Cannot access 'kn' before initialization" in production builds
          if (pkgName.startsWith("@codemirror/")) return "vendor-codemirror";
          if (pkgName.startsWith("@tiptap/") || pkgName.startsWith("prosemirror")) return "vendor-tiptap";
          // Keep all mermaid-related packages together to avoid circular dependency issues
          // Previously splitting mermaid, @mermaid-js/*, d3-*, dagre caused
          // "this.clear is not a function" error in production builds
          if (
            pkgName === "mermaid" ||
            pkgName.startsWith("@mermaid-js/") ||
            pkgName.startsWith("d3-") ||
            pkgName === "d3" ||
            pkgName === "dagre" ||
            pkgName === "dagre-d3-es" ||
            pkgName === "khroma"
          ) {
            return "vendor-mermaid";
          }
          if (pkgName === "katex") return "vendor-katex";
          if (
            pkgName === "html2pdf.js" ||
            pkgName === "html2canvas" ||
            pkgName === "jspdf" ||
            pkgName === "canvg" ||
            pkgName === "svg-pathdata" ||
            pkgName === "stackblur-canvas"
          ) {
            if (pkgName === "html2canvas" || pkgName === "stackblur-canvas") return "vendor-html2canvas";
            if (pkgName === "jspdf") return "vendor-jspdf";
            if (pkgName === "html2pdf.js") return "vendor-html2pdf";
            return "vendor-export";
          }
          if (
            pkgName === "cytoscape" ||
            pkgName === "cytoscape-cose-bilkent" ||
            pkgName === "cytoscape-fcose" ||
            pkgName === "cose-base" ||
            pkgName === "layout-base"
          ) {
            return "vendor-graph";
          }
          if (pkgName.startsWith("@tauri-apps/")) return "vendor-tauri";
          if (pkgName === "react-router-dom" || pkgName === "react-router") return "vendor-react";
          if (pkgName === "react-dom" || pkgName === "react") return "vendor-react";
          if (pkgName === "zustand" || pkgName.startsWith("@tanstack/")) return "vendor-state";
          if (
            pkgName.startsWith("remark") ||
            pkgName.startsWith("unified") ||
            pkgName.startsWith("mdast") ||
            pkgName.startsWith("micromark")
          ) {
            return "vendor-markdown";
          }

          return undefined;
        },
      },
    },
  },
}));
