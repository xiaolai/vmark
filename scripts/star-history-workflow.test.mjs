/**
 * The star-history generator and the workflow that is the ONLY thing that runs
 * it must agree about dependencies.
 *
 * WHY THIS EXISTS. `gen-star-history.mjs` shipped for months importing nothing
 * but `node:` builtins, and `star-history.yml` said so in a comment — "the
 * generator needs no npm deps" — with a bare `setup-node` and no install step.
 * The moment the generator gained a real import (roughjs, for the hand-drawn
 * rendering) that comment became false and the workflow died on
 * ERR_MODULE_NOT_FOUND.
 *
 * Nothing caught it, and nothing could have: every test tier and every gate runs
 * with `node_modules` already installed, so the import resolves everywhere
 * except the one place that matters. The failure surfaced as a red weekly
 * refresh AFTER the change had merged.
 *
 * So this asserts the seam directly, in both directions:
 *   - if the generator imports any package, the workflow must install packages;
 *   - every package it imports must be declared in the root manifest, because a
 *     hoisted-but-undeclared dependency resolves locally and fails on a clean
 *     `--frozen-lockfile` install.
 *
 * @coordinates-with .github/workflows/star-history.yml
 * @coordinates-with scripts/gen-star-history.mjs
 * @module scripts/star-history-workflow.test
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GENERATOR = path.join(REPO, "scripts/gen-star-history.mjs");
const WORKFLOW = path.join(REPO, ".github/workflows/star-history.yml");

/** Bare package specifiers imported by the generator (not `node:`, not relative). */
function bareImports(src) {
  return [...src.matchAll(/^\s*import\s+(?:[^"';]+\s+from\s+)?["']([^"']+)["']/gm)]
    .map((m) => m[1])
    .filter((s) => !s.startsWith("node:") && !s.startsWith(".") && !s.startsWith("/"))
    // scoped packages keep two segments; the rest keep one
    .map((s) => (s.startsWith("@") ? s.split("/").slice(0, 2).join("/") : s.split("/")[0]));
}

const generatorSrc = readFileSync(GENERATOR, "utf8");
const workflow = parseYaml(readFileSync(WORKFLOW, "utf8"));
const steps = workflow.jobs.refresh.steps;
const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8"));

describe("star-history workflow / generator dependency seam", () => {
  it("installs dependencies whenever the generator imports any package", () => {
    const imports = bareImports(generatorSrc);
    if (imports.length === 0) return; // stdlib-only generator needs no install

    // Either the shared composite action (which runs `pnpm install
    // --frozen-lockfile`) or an explicit install command.
    const installs = steps.some(
      (s) =>
        String(s.uses ?? "").includes("setup-node-pnpm") ||
        /\b(pnpm|npm|yarn)\s+(install|ci)\b/.test(String(s.run ?? "")),
    );
    expect(
      installs,
      `the generator imports [${imports.join(", ")}] but star-history.yml never installs dependencies`,
    ).toBe(true);
  });

  it("declares every package the generator imports in the root manifest", () => {
    const declared = new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ]);
    const undeclared = bareImports(generatorSrc).filter((p) => !declared.has(p));
    expect(undeclared, `imported but not in package.json: ${undeclared.join(", ")}`).toEqual([]);
  });

  it("still runs the generator, and publishes what it produced", () => {
    // Guards against the seam being 'fixed' by deleting the step that matters.
    expect(steps.some((s) => /node\s+scripts\/gen-star-history\.mjs/.test(String(s.run ?? "")))).toBe(true);
    expect(steps.some((s) => /star-history\.svg/.test(String(s.run ?? "")))).toBe(true);
  });

  it("reads the generator's imports rather than trusting this file's idea of them", () => {
    // A parser that silently matched nothing would make the first test vacuous:
    // it returns early on an empty import list, so "no imports found" and
    // "genuinely stdlib-only" look identical. roughjs is imported today.
    expect(bareImports(generatorSrc)).toContain("roughjs");
    expect(bareImports(`import { x } from "node:fs";\nimport y from "./local.mjs";`)).toEqual([]);
    expect(bareImports(`import a from "@scope/pkg/sub";`)).toEqual(["@scope/pkg"]);
  });
});
