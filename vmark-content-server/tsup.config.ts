import { defineConfig } from "tsup";
import { fileURLToPath } from "node:url";

/**
 * Production bundle (fixes grill C1).
 *
 * `tsc paths` does NOT rewrite emitted specifiers, so a plain `tsc` build emits
 * a bare `@vmark/markdown-plugins` import that Node cannot resolve. tsup/esbuild
 * resolves that alias at BUNDLE time and inlines the alias-free plugin files
 * (the ADR-2 "vendor" step), while keeping real npm dependencies external (they
 * are installed in the provisioned node_modules). The result, `dist/cli.js`, is
 * runnable with `node`.
 */
export default defineConfig({
  entry: ["src/cli.ts", "src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  outDir: "dist",
  sourcemap: true,
  clean: true,
  dts: false,
  // Inline the cross-boundary markdown plugins; everything else stays external.
  esbuildOptions(options) {
    options.alias = {
      "@vmark/markdown-plugins": fileURLToPath(
        new URL("../src/utils/markdownPipeline/nodeSafe.ts", import.meta.url)
      ),
    };
  },
  // Do NOT bundle @slidev/cli — it is provisioned separately and dynamic-imported.
  external: ["@slidev/cli"],
});
