#!/usr/bin/env node
/**
 * check-tauri-versions.mjs — fail fast on Tauri npm/crate version drift.
 *
 * Purpose: `tauri build` refuses to build when a Tauri package's npm and Rust
 * crate versions are on different major/minor releases. That check runs ONLY at
 * `tauri build` (release) time — `pnpm check:all` runs `vite build`, not
 * `tauri build`, so a dependabot bump of a `tauri-plugin-*` crate (or the npm
 * side) without its counterpart sails through every PR gate and only explodes
 * mid-release. The v0.9.0 release hit exactly this: the `tauri-plugin-log`
 * crate was bumped to 2.9.0 (#1123) while `@tauri-apps/plugin-log` stayed
 * 2.8.0, and all four platform builds aborted.
 *
 * This runs the same comparison standalone, in `check:all` (so both CI's
 * `frontend` check and the pre-push gate catch it). It compares the INSTALLED
 * npm `@tauri-apps/*` versions (node_modules) against the RESOLVED Rust crate
 * versions (src-tauri/Cargo.lock) — exactly what `tauri build` sees — for every
 * package present on BOTH sides. Rust-only plugins (window-state, shell — no JS
 * API) and npm-only packages are skipped, matching Tauri's own check.
 *
 * @coordinates-with package.json — `lint:tauri-versions`, wired into `check:all`
 * @coordinates-with .githooks/pre-push — runs check:all before main/tag pushes
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ─── Pure, testable core ───

/** Parse a Cargo.lock's `[[package]]` blocks into `{ crateName: version }`. */
export function parseCargoLock(text) {
  const crates = {};
  let name = null;
  for (const line of text.split("\n")) {
    const n = line.match(/^name = "(.+)"$/);
    if (n) {
      name = n[1];
      continue;
    }
    const v = line.match(/^version = "(.+)"$/);
    if (v && name) {
      crates[name] = v[1];
      name = null; // version always follows name in a [[package]] block
    }
  }
  return crates;
}

/**
 * Map an `@tauri-apps/<sub>` package to its Rust crate name, or null when it
 * has no runtime crate counterpart (e.g. `cli`, a dev tool that is not part of
 * the mismatch gate).
 */
export function crateForNpm(sub) {
  if (sub === "api") return "tauri";
  if (sub.startsWith("plugin-")) return `tauri-${sub}`; // plugin-log -> tauri-plugin-log
  return null;
}

/** True when two semver strings share the same major.minor (patch ignored). */
export function sameMajorMinor(a, b) {
  const mm = (v) => v.split(".").slice(0, 2).join(".");
  return mm(a) === mm(b);
}

/**
 * Given installed npm versions (`{ sub: version }`, keyed by the part after
 * `@tauri-apps/`) and resolved crate versions (`{ crate: version }`), return
 * the pairs that exist on both sides but drift on major/minor.
 */
export function findMismatches(npm, crates) {
  const out = [];
  for (const [sub, npmVer] of Object.entries(npm)) {
    const crate = crateForNpm(sub);
    if (!crate) continue;
    const crateVer = crates[crate];
    if (!crateVer) continue; // no crate counterpart resolved — skip (matches Tauri)
    if (!sameMajorMinor(npmVer, crateVer)) {
      out.push({ crate, crateVer, npm: `@tauri-apps/${sub}`, npmVer });
    }
  }
  return out;
}

// ─── I/O + CLI ───

function readNpmVersions(root) {
  const dir = join(root, "node_modules", "@tauri-apps");
  if (!existsSync(dir)) return null;
  const out = {};
  for (const sub of readdirSync(dir)) {
    const pkg = join(dir, sub, "package.json");
    if (existsSync(pkg)) out[sub] = JSON.parse(readFileSync(pkg, "utf8")).version;
  }
  return out;
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const npm = readNpmVersions(root);
  if (!npm) {
    console.error(
      "check-tauri-versions: node_modules/@tauri-apps not found — run `pnpm install` first.",
    );
    process.exit(1);
  }
  const crates = parseCargoLock(readFileSync(join(root, "src-tauri", "Cargo.lock"), "utf8"));
  const mismatches = findMismatches(npm, crates);

  if (mismatches.length) {
    console.error("❌ Tauri npm/crate version mismatch — `tauri build` (release) will fail:\n");
    for (const m of mismatches) {
      console.error(`  ${m.crate} (v${m.crateVer})  ≠  ${m.npm} (v${m.npmVer})`);
    }
    console.error(
      "\nAlign each pair on the same major/minor: bump the npm package in package.json (then\n" +
        "`pnpm install`), or the crate via src-tauri/Cargo.toml (then `cargo update`).",
    );
    process.exit(1);
  }

  const checked = Object.keys(npm).filter((sub) => crateForNpm(sub) && crates[crateForNpm(sub)]);
  console.log(
    `✅ Tauri versions aligned (${checked.length} @tauri-apps package(s) match src-tauri/Cargo.lock).`,
  );
}

if (process.argv[1]?.endsWith("check-tauri-versions.mjs")) main();
