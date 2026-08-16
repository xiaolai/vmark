#!/usr/bin/env node
/**
 * Webview floor gate — the JS target, the OS minimum, and the docs agree.
 *
 * Purpose: VMark renders in the OS webview, so the JavaScript we emit must be
 * parseable by the WebKit that ships with the oldest macOS we let the app
 * launch on. FOUR surfaces independently assert that floor, and nothing tied
 * them together:
 *
 *   1. `vite.config.ts`            — `build.target`, what esbuild emits
 *   2. `src-tauri/tauri.conf.json` — `minimumSystemVersion`, what may launch
 *   3. `website/**` download pages — what we tell people, in ten languages
 *   4. `update-homebrew.yml`       — the cask's `depends_on macos:`
 *
 * They disagreed by four major macOS releases (issue #1278). `build.target`
 * was UNSET, so it inherited Vite's default — `baseline-widely-available`,
 * which pins to `safari16.4` for this Vite major and MOVES on the next one —
 * while the other two promised macOS 10.15 (Catalina), whose baseline WebKit is
 * Safari 13.1.3. A user on macOS 12 got a window that passed every check we
 * had and rendered nothing: the bundle failed to parse before any of our code
 * ran, so there was no error to log and no console to read it in.
 *
 * Why an explicit target at all: an inherited default is a version floor that
 * changes when a dependency is upgraded, silently, in a direction that drops
 * users. Pinning it makes that a reviewed edit instead of a side effect.
 *
 * Key decisions:
 *   - The mapping below is the BASELINE WebKit each macOS ships with, not the
 *     newest Safari installable on it. Users do not reliably update Safari, and
 *     on the machine in #1278 `softwareupdate` left WebKit at the shipped
 *     613.3.9.1.16 (Safari 15.6.1). Only the shipped engine can be assumed.
 *   - Conservative by construction: the floor is the OLDEST macOS in the table
 *     whose baseline Safari is >= the configured target. A macOS absent from
 *     the table cannot be chosen, so widening support requires citing evidence
 *     rather than guessing a point release.
 *
 * @coordinates-with vite.config.ts — build.target
 * @coordinates-with src-tauri/tauri.conf.json — bundle.macOS.minimumSystemVersion
 * @coordinates-with website/ download.md pages — every locale's requirement line
 * @coordinates-with .github/workflows/update-homebrew.yml — the cask's depends_on
 * @module scripts/check-webview-floor
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");

/**
 * macOS release → the Safari/WebKit version it SHIPS WITH.
 *
 * Source: Tauri's own webview-versions reference
 * (https://v2.tauri.app/reference/webview-versions/), which is the table Tauri
 * publishes precisely so downstream apps can pick a target. Adding a row means
 * citing that table (or an equally checkable source) — not inferring a
 * mapping from a Safari release note, because Safari ships to several macOS
 * versions at once and says nothing about what a given machine actually has.
 */
export const MACOS_BASELINE_SAFARI = [
  { macos: "10.15", name: "Catalina", safari: "13.1.3", cask: "catalina" },
  { macos: "11.6", name: "Big Sur", safari: "14.1.2", cask: "big_sur" },
  { macos: "12.6", name: "Monterey", safari: "15.6.1", cask: "monterey" },
  { macos: "13.4", name: "Ventura", safari: "16.5.1", cask: "ventura" },
  { macos: "14.0", name: "Sonoma", safari: "17.0", cask: "sonoma" },
];

/** Compare dotted numeric versions. Returns <0, 0, >0. */
export function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** The oldest macOS whose SHIPPED Safari satisfies `safariTarget`, or null. */
export function oldestMacosFor(safariTarget) {
  const ordered = [...MACOS_BASELINE_SAFARI].sort((x, y) =>
    compareVersions(x.macos, y.macos),
  );
  return ordered.find((row) => compareVersions(row.safari, safariTarget) >= 0) ?? null;
}

/**
 * Read `build.target` out of vite.config.ts.
 *
 * Deliberately a source read rather than an import: importing the config
 * executes it (plugins, env, `defineConfig` callbacks), and a gate that has to
 * boot the build system to ask one question is a gate that breaks for reasons
 * unrelated to what it checks. An ABSENT target is the defect this exists to
 * catch, so "not found" is a failure, never a default.
 */
export function readViteTarget(source) {
  // Strip comments before matching. This file's own explanation of WHY the
  // target is pinned names `safari16.4` in prose, so a naive scan reads the
  // comment and reports success no matter what the config actually sets —
  // the gate would then pass on the very tree it exists to reject.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  // Not anchored to line start: a one-line `build: { target: "safari16.4" }`
  // is valid config, and reporting it as ABSENT would block a correct tree.
  const found = [...code.matchAll(/\btarget:\s*"([^"]+)"/g)].map((m) => m[1]);
  if (found.length === 0) return null;

  // More than one distinct target is ambiguous — which one governs the bundle
  // is a question this gate must not guess at, so it reports the conflict.
  const distinct = [...new Set(found)];
  return distinct.length === 1 ? distinct[0] : { ambiguous: distinct };
}

/** Read the declared macOS minimum out of tauri.conf.json. */
export function readTauriMinimum(conf) {
  return conf?.bundle?.macOS?.minimumSystemVersion ?? null;
}

/**
 * The macOS symbol the generated Homebrew cask depends on.
 *
 * A FOURTH surface asserting the floor, and the one that governs
 * `brew install` — it said `:catalina` while the app needed Ventura, so
 * Homebrew installed happily onto a Mac that could not open the result.
 */
export function readCaskMacos(workflow) {
  const m = workflow.match(/^\s*depends_on macos:\s*:(\w+)/m);
  return m ? m[1] : null;
}

/** Every `macOS <version>` claim in the download page. */
export function readDocsMinimums(markdown) {
  return [...markdown.matchAll(/macOS\s+(\d+(?:\.\d+)*)/g)].map((m) => m[1]);
}

export function findings({ viteSource, tauriConf, downloadDocs, caskWorkflow }) {
  const out = [];

  const target = readViteTarget(viteSource);
  if (!target) {
    out.push(
      "vite.config.ts declares no `build.target`. It would inherit Vite's " +
        "default, which pins to a Safari version that moves between Vite " +
        "majors — a user-facing OS floor changed by a dependency bump.",
    );
    return out;
  }

  if (typeof target === "object" && target.ambiguous) {
    out.push(
      `vite.config.ts sets more than one build target (${target.ambiguous.join(", ")}). ` +
        "Which one governs the emitted bundle is not something this gate may " +
        "guess, and neither should a reader.",
    );
    return out;
  }

  const m = target.match(/^safari(\d+(?:\.\d+)?)$/);
  if (!m) {
    out.push(
      `vite.config.ts build.target is "${target}". This app renders only in ` +
        "WKWebView, so the target must name a single Safari version " +
        '(e.g. "safari16.4") for the OS floor to be derivable from it.',
    );
    return out;
  }
  const safariTarget = m[1];

  const required = oldestMacosFor(safariTarget);
  if (!required) {
    out.push(
      `No macOS in the table ships Safari >= ${safariTarget}, so build.target ` +
        `"${target}" cannot be supported by any macOS release listed. Either ` +
        "lower the target or add a cited row to MACOS_BASELINE_SAFARI.",
    );
    return out;
  }

  const declared = readTauriMinimum(tauriConf);
  if (declared === null) {
    out.push("src-tauri/tauri.conf.json has no bundle.macOS.minimumSystemVersion.");
  } else if (compareVersions(declared, required.macos) < 0) {
    out.push(
      `tauri.conf.json allows macOS ${declared}, but build.target ` +
        `"${target}" needs Safari ${safariTarget} and macOS ${declared} ` +
        `ships older WebKit. The oldest macOS that can parse this bundle is ` +
        `${required.macos} (${required.name}, Safari ${required.safari}). ` +
        "Below it the app launches to a BLANK WINDOW rather than refusing " +
        "to launch — see issue #1278.",
    );
  }

  // Homebrew can only name a MAJOR macOS version, so this checks that the
  // cask names the major release CONTAINING the floor — :ventura for 13.4.
  // Looser than LSMinimumSystemVersion by design (13.0-13.3 installs, then
  // macOS refuses to open it with a readable message), but it must not be
  // looser than that.
  if (caskWorkflow !== undefined) {
    const cask = readCaskMacos(caskWorkflow);
    if (cask === null) {
      out.push("The Homebrew cask workflow declares no `depends_on macos:`.");
    } else if (cask !== required.cask) {
      out.push(
        `The Homebrew cask depends on macOS :${cask}, but the floor is ` +
          `${required.macos} (:${required.cask}). \`brew install\` would put ` +
          "VMark on a Mac that cannot open it.",
      );
    }
  }

  // EVERY download page, not just the English one. The first cut of this gate
  // checked `website/download.md` alone and passed while nine translations
  // still promised 10.15 — a gate that green-lights the majority of its
  // surface is worse than none, because it certifies the lie.
  for (const [path, markdown] of Object.entries(downloadDocs)) {
    const docs = readDocsMinimums(markdown);
    if (docs.length === 0) {
      out.push(`${path} states no \`macOS <version>\` requirement.`);
      continue;
    }
    for (const stated of docs) {
      if (compareVersions(stated, required.macos) !== 0) {
        out.push(
          `${path} says "macOS ${stated}", but the shipped floor is macOS ` +
            `${required.macos} (${required.name}). Users below it cannot run ` +
            "the app; telling them they can is how they end up filing a " +
            "blank-window bug.",
        );
      }
    }
  }

  return out;
}

/**
 * Every `download.md` under `website/`, DISCOVERED rather than listed. A
 * hardcoded locale list is a gate that silently stops covering the locale
 * added after it was written.
 */
export function readDownloadDocs(root = ROOT) {
  const site = join(root, "website");
  const out = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === ".vitepress") continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === "download.md") out[relative(root, full)] = readFileSync(full, "utf8");
    }
  };
  walk(site);
  return out;
}

function main() {
  const results = findings({
    viteSource: readFileSync(join(ROOT, "vite.config.ts"), "utf8"),
    tauriConf: JSON.parse(readFileSync(join(ROOT, "src-tauri/tauri.conf.json"), "utf8")),
    downloadDocs: readDownloadDocs(),
    caskWorkflow: readFileSync(join(ROOT, ".github/workflows/update-homebrew.yml"), "utf8"),
  });

  if (results.length > 0) {
    console.error("\n❌ Webview floor is inconsistent across surfaces:\n");
    for (const r of results) console.error(`  • ${r}\n`);
    console.error(
      "  The JS target, the OS minimum and the docs describe one number.\n" +
        "  Change them together, in scripts/check-webview-floor.mjs's table\n" +
        "  if the evidence itself has changed.\n",
    );
    process.exit(1);
  }

  const target = readViteTarget(readFileSync(join(ROOT, "vite.config.ts"), "utf8"));
  const required = oldestMacosFor(target.replace("safari", ""));
  console.log(
    `✅ Webview floor consistent (build.target ${target} → macOS ` +
      `${required.macos} ${required.name}, Safari ${required.safari}).`,
  );
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
