// @vitest-environment node
/**
 * Vite/Vitest configs must stay loadable by `configLoader: 'native'`.
 *
 * Vite plans to make the native loader the default. It loads these configs
 * through Node's own TypeScript support rather than bundling them with esbuild,
 * and Node's ESM resolver has two requirements the bundled loader hid:
 *
 *   1. no CJS `__dirname` / `__filename` — use `import.meta.dirname`
 *   2. a real file extension on every relative import
 *
 * Five configs violated both (ten `__dirname` uses, five bare specifiers) and
 * the only symptom was a warning printed on every `pnpm dev`, `pnpm test` and
 * `pnpm tauri dev` — which is exactly the kind of thing that gets read past
 * until the default flips and the build stops loading.
 *
 * This asserts the property rather than the fix, so a new config, or a
 * reintroduced `__dirname`, fails here instead of at the version bump.
 */
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Every Vite/Vitest config at the repo root. Discovered, not listed — a new
 *  config file is covered the moment it is added. */
function configFiles(): string[] {
  return readdirSync(".")
    .filter((f) => /^(vite|vitest)[.\w-]*\.config\.ts$/.test(f))
    .sort();
}

describe("Vite config native-loader compatibility", () => {
  it("finds the configs it is meant to guard", () => {
    // A discovery bug here would make every assertion below vacuously pass.
    expect(configFiles().length).toBeGreaterThanOrEqual(5);
  });

  it.each(configFiles())("%s uses import.meta.dirname, not __dirname", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).not.toMatch(/\b__dirname\b/);
    expect(src).not.toMatch(/\b__filename\b/);
  });

  it.each(configFiles())("%s gives every relative import a file extension", (file) => {
    const src = readFileSync(file, "utf8");
    const bare = [...src.matchAll(/^\s*import\s[^;]*?from\s+"(\.[^"]*)"/gm)]
      .map((m) => m[1])
      .filter((spec) => !/\.(ts|tsx|js|mjs|cjs|json)$/.test(spec));
    expect(bare).toEqual([]);
  });
});
