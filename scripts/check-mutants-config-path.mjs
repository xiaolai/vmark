#!/usr/bin/env node
/**
 * WI-4 — cargo-mutants config-path staleness guard (D1).
 *
 * Purpose: cargo-mutants reads its configuration from `.cargo/mutants.toml`
 * relative to the workspace root of the manifest it mutates (for this repo:
 * `src-tauri/.cargo/mutants.toml` — src-tauri is its own workspace; verified
 * against cargo-mutants 27.1.0). A config at `src-tauri/mutants.toml` is
 * SILENTLY IGNORED — that misplacement made every CI mutation run mutate the
 * unfiltered tree into its 60-minute timeout, invisibly (8/8 failed runs
 * hidden by `continue-on-error: true`).
 *
 * Two-way guard, fails closed:
 *   - a config at the ignored legacy path  → exit 1 (it would be dead weight
 *     that LOOKS like scoping; the failure mode this repo actually shipped);
 *   - no config at the path the tool reads → exit 1 with a DISTINCT message
 *     (an unscoped run is the same 60-minute fiction with extra steps).
 *
 * Usage: node scripts/check-mutants-config-path.mjs [--root <dir>]
 * Wired as `pnpm lint:mutants-config` (in `check:all`).
 * Tested by scripts/check-mutants-config-path.test.mjs against fixture trees.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LEGACY_REL = "src-tauri/mutants.toml";
const CORRECT_REL = "src-tauri/.cargo/mutants.toml";

function parseRoot(argv) {
  const i = argv.indexOf("--root");
  if (i !== -1 && argv[i + 1]) return path.resolve(argv[i + 1]);
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

const root = parseRoot(process.argv.slice(2));
const legacy = path.join(root, LEGACY_REL);
const correct = path.join(root, CORRECT_REL);

if (existsSync(legacy)) {
  console.error(
    `❌ lint:mutants-config — ${LEGACY_REL} is silently ignored by cargo-mutants.\n` +
      `   cargo-mutants reads ${CORRECT_REL} (\`.cargo/mutants.toml\` relative to the\n` +
      `   workspace root). A config at the legacy path scopes nothing: runs mutate the\n` +
      `   whole unfiltered tree. Move the file to ${CORRECT_REL} and delete the legacy one.`,
  );
  process.exit(1);
}

if (!existsSync(correct)) {
  console.error(
    `❌ lint:mutants-config — config missing where cargo-mutants reads it.\n` +
      `   Expected ${CORRECT_REL} to exist. Without it, mutation runs are unscoped\n` +
      `   (whole-tree mutation → guaranteed CI timeout). Restore the scoped config.`,
  );
  process.exit(1);
}

console.log(`✅ lint:mutants-config — ${CORRECT_REL} present, legacy path clean.`);
