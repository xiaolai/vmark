// @vitest-environment node
/**
 * Every namespace a lookup names must be LOADED in the window that makes it.
 *
 * i18next does not load a namespace because a key names it. `t("ns:key")`
 * strips the prefix, looks the key up in that namespace, and — when the
 * namespace was never loaded — answers with the key itself. So a lookup only
 * works if something in that window has already loaded the namespace.
 *
 * Two things load one:
 *   - the BOOT list in `src/i18n.ts`, loaded in every window at startup;
 *   - a `useTranslation(...)` hook, because react-i18next loads what the hook
 *     asks for.
 *
 * Nothing else counts. A lookup from a store, a service or a plugin has no
 * hook to lean on, so its namespace has to be in the boot list; a lookup
 * through a hook's own `t` may name any namespace that hook asked for.
 *
 * The Settings window was the proof that this is not a paper rule: its
 * workflow group asked the `workflowEditor` bundle for five strings through a
 * hook bound to `settings`, and the group rendered "settings.groupTitle" in
 * every language.
 *
 * @coordinates-with src/i18n.ts — the boot list this reads
 * @module locales/__tests__/namespaceLoading.test
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SRC = path.join(REPO_ROOT, "src");
const I18N_MODULE = path.join(SRC, "i18n.ts");

const SKIP_DIRS = new Set(["node_modules", "dist", "target", "coverage", "__tests__"]);

/** Files that are not production sources, and so carry no lookups to check. */
function isProduction(rel: string): boolean {
  if (rel.endsWith(".d.ts")) return false;
  if (/\.(test|spec|bench)\.[^/]+$/.test(rel)) return false;
  if (rel.startsWith("src/test/")) return false;
  if (rel.startsWith("src/locales/")) return false;
  return true;
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const abs = path.join(dir, entry);
    if (statSync(abs).isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      walk(abs, acc);
    } else if (/\.tsx?$/.test(entry)) {
      acc.push(abs);
    }
  }
  return acc;
}

/**
 * The namespaces every window loads at boot, parsed from `src/i18n.ts`.
 *
 * Parsed rather than imported: the module initialises i18next and touches
 * `document`, and this file runs in the node environment.
 */
function bootNamespaces(): string[] {
  const src = readFileSync(I18N_MODULE, "utf8");
  const match = src.match(/ns:\s*\[((?:\s*"[^"]+",?)+)\s*\]/);
  if (!match) {
    throw new Error('src/i18n.ts no longer declares an `ns: ["…"]` boot list');
  }
  return [...match[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

/** The namespaces a `useTranslation(...)` argument asks for. */
function namespacesOf(argument: string): Set<string> {
  const out = new Set<string>();
  for (const m of argument.matchAll(/"([^"]+)"/g)) out.add(m[1]!);
  // A bare `useTranslation()` asks for the default namespace.
  if (out.size === 0) out.add("common");
  return out;
}

/**
 * The translation functions a file binds, and the namespaces each one loads.
 *
 * `const { t } = useTranslation("export")` binds `t` to the `export` bundle;
 * `const { t: tDialog } = useTranslation("dialog")` binds `tDialog` to
 * `dialog`. Keyed by the LOCAL name, because that is what a call site names.
 */
function translationBindings(src: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const m of src.matchAll(/const\s*\{\s*t\s*\}\s*=\s*useTranslation\(([^)]*)\)/g)) {
    out.set("t", namespacesOf(m[1]!));
  }
  for (const m of src.matchAll(/const\s*\{\s*t:\s*(\w+)\s*\}\s*=\s*useTranslation\(([^)]*)\)/g)) {
    out.set(m[1]!, namespacesOf(m[2]!));
  }
  return out;
}

/** Namespaces read through the `i18n` singleton — the non-React path. */
function singletonNamespaces(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/\bi18n\.t\(\s*"([^"]+):/g)) out.add(m[1]!);
  return out;
}

const files = walk(SRC)
  .map((abs) => path.relative(REPO_ROOT, abs).split(path.sep).join("/"))
  .filter(isProduction)
  .sort();

const boot = bootNamespaces();

describe("the i18n boot list", () => {
  it("is discoverable, and is what every window loads at startup", () => {
    // A rename that broke the parse would make every assertion below vacuous.
    expect(boot.length).toBeGreaterThan(0);
    for (const ns of ["common", "dialog"]) expect(boot).toContain(ns);
  });

  it("names the namespaces the non-React code reads", () => {
    // The rule the boot list exists for: a store, a service or a plugin reads
    // through the `i18n` singleton, and no hook in that window will ever load
    // the namespace for it.
    const wanted = new Set<string>();
    for (const file of files) {
      const src = readFileSync(path.join(REPO_ROOT, file), "utf8");
      const hooks = new Set<string>();
      for (const namespaces of translationBindings(src).values()) {
        for (const ns of namespaces) hooks.add(ns);
      }
      for (const ns of singletonNamespaces(src)) {
        // The boot list loads it in every window; a hook in the same file
        // loads it in that file's window.
        if (boot.includes(ns) || hooks.has(ns)) continue;
        wanted.add(ns);
      }
    }
    expect([...wanted].sort()).toEqual([]);
  });
});

describe("namespaced lookups through a hook", () => {
  it("name a namespace that hook loaded", () => {
    const violations: string[] = [];
    for (const file of files) {
      const src = readFileSync(path.join(REPO_ROOT, file), "utf8");
      for (const [fn, namespaces] of translationBindings(src)) {
        const calls = src.matchAll(new RegExp(`\\b${fn}\\(\\s*"([^"]+):`, "g"));
        for (const call of calls) {
          const ns = call[1]!;
          if (namespaces.has(ns) || boot.includes(ns)) continue;
          violations.push(`${file}: ${fn}("${ns}:…") — this hook loads ${[...namespaces].join(", ")}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
