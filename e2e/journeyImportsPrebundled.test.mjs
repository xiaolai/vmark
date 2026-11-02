// @vitest-environment node
/**
 * Every `/src/` module a journey imports at runtime is an `optimizeDeps.entries`
 * root in vite.config.ts.
 *
 * Why: the dev server pre-bundles only the bare dependencies its startup scan
 * finds from its entries. A journey that `import()`s a module the app never
 * reaches (the focus-fact helpers under src/test/ import `vitest`) makes Vite
 * discover a new dependency mid-run, re-optimize, and full-reload the page; the
 * in-flight import then fails with "Importing a module script failed". On a
 * warm local cache it passes, so only CI's fresh cache showed it.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import viteConfig from "../vite.config.ts";

const JOURNEYS = new URL("./journeys/", import.meta.url);

/** `/src/...` specifiers passed to a dynamic `import()` in a journey's page script. */
function journeySourceImports() {
  const found = new Map();
  for (const name of readdirSync(JOURNEYS).filter((f) => f.endsWith(".mjs"))) {
    const text = readFileSync(new URL(name, JOURNEYS), "utf8");
    for (const m of text.matchAll(/import\(\s*["'](\/src\/[^"']+)["']\s*\)/g)) {
      const path = m[1].slice(1);
      found.set(path, [...(found.get(path) ?? []), name]);
    }
  }
  return found;
}

describe("journey runtime imports are pre-bundled", () => {
  const config = viteConfig({ command: "serve", mode: "development" });
  const entries = config.optimizeDeps?.entries ?? [];

  it("finds the journeys' runtime imports (the scan is not vacuous)", () => {
    expect(journeySourceImports().has("src/test/focusFacts.ts")).toBe(true);
  });

  it("keeps index.html as an entry, since setting entries replaces the default crawl", () => {
    expect(entries).toContain("index.html");
  });

  it("lists every /src/ module a journey imports as an optimizeDeps entry", () => {
    const missing = [...journeySourceImports()]
      .filter(([path]) => !entries.includes(path))
      .map(([path, files]) => `${path} (imported by ${files.join(", ")})`);
    expect(missing).toEqual([]);
  });
});
