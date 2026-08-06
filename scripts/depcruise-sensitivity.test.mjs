/**
 * WI-8 — Plugin-isolation gate-sensitivity meta-test (B3).
 *
 * Proves the REAL `.dependency-cruiser.cjs` still bites: a NEW plugin→plugin
 * edge must fail `depcruise` naming the edge. With the plugin-wide "verified
 * dependency" licenses retired and every existing edge frozen per-edge in
 * `.dependency-cruiser-known-violations.json`, this test is what keeps the
 * rule from silently rotting into an always-green formality.
 *
 * Approach (fixture tree, not a worktree): the real config hardcodes no repo
 * paths — its `tsConfig.fileName: "tsconfig.json"` resolves relative to the
 * CWD — so the real depcruise CLI runs the REAL config against a minimal
 * generated project in a tmpdir. The repo's own known-violations file is
 * passed via `--ignore-known` (mirroring `pnpm lint:deps` exactly); its
 * entries name real repo paths, so they can never mask a fixture edge.
 * Verified live before committing: an injected src/plugins/pluginA →
 * src/plugins/pluginB import exits 1 with
 * "error plugin-isolation: src/plugins/pluginA/index.ts → src/plugins/pluginB/index.ts".
 * The clean-tree and via-shared/ cases pin that a pass is a verdict, not a
 * config that fails to load. Runtime: ~1s per depcruise run, 3 runs.
 */
import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEPCRUISE = path.join(REPO, "node_modules", ".bin", "depcruise");
const CONFIG = path.join(REPO, ".dependency-cruiser.cjs");
const KNOWN = path.join(REPO, ".dependency-cruiser-known-violations.json");

const MINIMAL_TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: "es2020",
    module: "esnext",
    moduleResolution: "bundler",
    baseUrl: ".",
    paths: { "@/*": ["src/*"] },
  },
});

const cleanups = [];
afterAll(() => {
  for (const dir of cleanups) rmSync(dir, { recursive: true, force: true });
});

/** Write a fixture project ({ "rel/path.ts": content }) into a fresh tmpdir. */
function writeFixture(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "depcruise-sensitivity-"));
  cleanups.push(dir);
  writeFileSync(path.join(dir, "tsconfig.json"), MINIMAL_TSCONFIG);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

/** Run the real depcruise CLI with the real config, exactly like lint:deps. */
function runGate(cwd) {
  return spawnSync(DEPCRUISE, ["src", "--config", CONFIG, "--ignore-known", KNOWN], {
    cwd,
    encoding: "utf8",
  });
}

describe("plugin-isolation gate sensitivity (real config, fixture tree)", () => {
  it("fails on a new plugin→plugin edge, naming the edge", () => {
    const dir = writeFixture({
      "src/plugins/pluginA/index.ts":
        'import { b } from "../pluginB/index";\nexport const a = b + 1;\n',
      "src/plugins/pluginB/index.ts": "export const b = 1;\n",
    });
    const res = runGate(dir);
    const out = res.stdout + res.stderr;
    expect(res.status).not.toBe(0);
    expect(out).toContain("plugin-isolation");
    expect(out).toContain("src/plugins/pluginA/index.ts");
    expect(out).toContain("src/plugins/pluginB/index.ts");
  });

  it("passes on the same tree without the forbidden edge (failure above IS the edge)", () => {
    const dir = writeFixture({
      "src/plugins/pluginA/index.ts": "export const a = 1;\n",
      "src/plugins/pluginB/index.ts": "export const b = 1;\n",
    });
    const res = runGate(dir);
    expect(res.stderr).toBe("");
    expect(res.status).toBe(0);
  });

  it("keeps the sanctioned channel open: plugin → plugins/shared/ passes", () => {
    const dir = writeFixture({
      "src/plugins/pluginA/index.ts":
        'import { s } from "../shared/util";\nexport const a = s + 1;\n',
      "src/plugins/shared/util.ts": "export const s = 1;\n",
    });
    const res = runGate(dir);
    expect(res.stderr).toBe("");
    expect(res.status).toBe(0);
  });
});

// ─── WI-10 (B1): the hooks/services tier boundary keeps biting ───

describe("services-no-upward gate sensitivity (real config, fixture tree)", () => {
  it("fails on a services → hooks import, naming the edge", () => {
    const dir = writeFixture({
      "src/services/domain/thing.ts":
        'import { h } from "../../hooks/helper";\nexport const t = h + 1;\n',
      "src/hooks/helper.ts": "export const h = 1;\n",
    });
    const res = runGate(dir);
    const out = res.stdout + res.stderr;
    expect(res.status).not.toBe(0);
    expect(out).toContain("services-no-upward");
    expect(out).toContain("src/services/domain/thing.ts");
    expect(out).toContain("src/hooks/helper.ts");
  });

  it("passes the correct direction: hooks → services", () => {
    const dir = writeFixture({
      "src/hooks/useThing.ts":
        'import { useEffect } from "react";\nimport { t } from "../services/domain/thing";\nexport function useThing() { useEffect(() => { void t; }, []); }\n',
      "src/services/domain/thing.ts": "export const t = 1;\n",
    });
    const res = runGate(dir);
    expect(res.stderr).toBe("");
    expect(res.status).toBe(0);
  });
});

describe("hooks-tier purity gate sensitivity (real script, fixture tree)", () => {
  const PURITY = path.join(REPO, "scripts", "check-hooks-react-purity.mjs");

  /** Run the REAL purity gate against a fixture root, like lint:hooks-purity. */
  function runPurity(root) {
    return spawnSync(process.execPath, [PURITY, "--root", root], { encoding: "utf8" });
  }

  it("fails on a non-React business module in src/hooks/, naming the file", () => {
    const dir = writeFixture({
      // No react import, no hook call (getState() is the imperative store
      // API), no hook re-export — the exact misfiled-module shape WI-10 moved
      // 74 of.
      "src/hooks/businessLogic.ts":
        'import { useFooStore } from "../stores/fooStore";\nexport function computeThing(): number {\n  return useFooStore.getState().n + 1;\n}\n',
      "src/stores/fooStore.ts":
        "export const useFooStore = { getState: () => ({ n: 1 }) };\n",
    });
    const res = runPurity(dir);
    const out = res.stdout + res.stderr;
    expect(res.status).not.toBe(0);
    expect(out).toContain("src/hooks/businessLogic.ts");
  });

  it("passes a react-importing hook and a composite that only calls hooks", () => {
    const dir = writeFixture({
      "src/hooks/useReal.ts":
        'import { useEffect } from "react";\nexport function useReal() { useEffect(() => {}, []); }\n',
      // Composite shape: no direct react import, composes other hooks.
      "src/hooks/useComposite.ts":
        'import { useReal } from "./useReal";\nexport function useComposite() { useReal(); }\n',
      // Barrel shape: re-exports hooks only.
      "src/hooks/lifecycle/index.ts": 'export { useReal } from "../useReal";\n',
    });
    const res = runPurity(dir);
    expect(res.stdout + res.stderr).toContain("✅");
    expect(res.status).toBe(0);
  });

  it("is not fooled by a hook call in a comment (parse-ish, not grep)", () => {
    const dir = writeFixture({
      "src/hooks/prose.ts":
        "// This module used to call useEffect() before the migration.\n" +
        "export function pureThing(): number {\n  return 2;\n}\n",
    });
    const res = runPurity(dir);
    const out = res.stdout + res.stderr;
    expect(res.status).not.toBe(0);
    expect(out).toContain("src/hooks/prose.ts");
  });

  // ── The three false-PASS classes the regex detector admitted ──
  // Evidence was read off raw text: the react-import check ran BEFORE comments
  // were stripped, strings were never stripped at all, and `useX(` matched a
  // declaration as readily as a call. Each of these is a business module that
  // used to satisfy the gate without being a React adapter.

  it("does not accept a react import that is commented out", () => {
    const dir = writeFixture({
      "src/hooks/commentedImport.ts":
        '// import { useEffect } from "react";  ← removed during the migration\n' +
        "export function computeThing(): number {\n  return 41 + 1;\n}\n",
    });
    const res = runPurity(dir);
    expect(res.status).not.toBe(0);
    expect(res.stdout + res.stderr).toContain("src/hooks/commentedImport.ts");
  });

  it("does not accept a react import or a hook call that lives inside a string", () => {
    const dir = writeFixture({
      "src/hooks/stringEvidence.ts":
        'export const SNIPPET = \'import { useState } from "react"; useState(0);\';\n' +
        "export function renderSnippet(): string {\n  return SNIPPET;\n}\n",
    });
    const res = runPurity(dir);
    expect(res.status).not.toBe(0);
    expect(res.stdout + res.stderr).toContain("src/hooks/stringEvidence.ts");
  });

  it("does not accept a hook-NAMED function declaration as evidence of calling one", () => {
    // `export function useBusiness()` matched `\buse[A-Z]\w*\s*\(`. Naming a
    // function `useX` is exactly what a misfiled business module does to look
    // like a hook; only a CALL is evidence.
    const dir = writeFixture({
      "src/hooks/useBusiness.ts":
        'import { readSettings } from "../services/settings/read";\n' +
        "export function useBusiness(): number {\n  return readSettings().n + 1;\n}\n",
      "src/services/settings/read.ts": "export const readSettings = () => ({ n: 1 });\n",
    });
    const res = runPurity(dir);
    expect(res.status).not.toBe(0);
    expect(res.stdout + res.stderr).toContain("src/hooks/useBusiness.ts");
  });

  it("still accepts the real adapter shapes: react-dom, a require, and an aliased re-export", () => {
    const dir = writeFixture({
      "src/hooks/useDom.ts":
        'import { flushSync } from "react-dom";\nexport function useDom() { flushSync(() => {}); }\n',
      "src/hooks/legacy.cjs.ts":
        'const React = require("react/jsx-runtime");\nexport const j = React;\n',
      "src/hooks/barrel.ts": 'export { internal as useThing } from "./useDom";\n',
    });
    const res = runPurity(dir);
    expect(res.stdout + res.stderr).toContain("✅");
    expect(res.status).toBe(0);
  });

  it("fails closed on a file it cannot parse rather than waving it through", () => {
    const dir = writeFixture({
      "src/hooks/broken.ts": "export function oops( {\n",
    });
    const res = runPurity(dir);
    expect(res.status).not.toBe(0);
    expect(res.stdout + res.stderr).toContain("src/hooks/broken.ts");
  });
});
