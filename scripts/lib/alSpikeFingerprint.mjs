#!/usr/bin/env node
/**
 * Purpose: the dependency fingerprint of one agent-edit-ledger spike — the
 * sha256 of every input its results depend on — computed by ONE function that
 * both the generators (when a run starts) and the phase-0 checker (when it
 * judges freshness) call, so the two can never disagree about what an input is.
 *
 * Inputs (SPIKE_INPUTS, repo-relative): the spike's own folder, which holds its
 * package.json/pnpm-lock.yaml or Cargo.toml/Cargo.lock; every other folder its
 * probes import or read (review imports revert/lib and reads golden/, the txn
 * tests read golden/, the anchor probe reads golden/provenance.md, the backend
 * crate compiles in scripts/lib/alSpikeBackendCrashCases.json); and, for the vitest-run probes that resolve packages from
 * the repo root, the root package.json, pnpm-lock.yaml and vitest.shared.ts.
 * Excluded: dot-files, node_modules/, target/, and the spike's own outputs
 * (its results.json, review/out/). A declared input that is absent throws —
 * a silently skipped input would make every change to it invisible.
 *
 * Plus the import closure of every code file among those inputs
 * (alSpikeImportGraph.mjs): the src/ modules a probe runs, transitively, files
 * of other spikes it imports, and the package.json/pnpm-lock.yaml pinning each
 * npm package it imports (whole-lockfile hashes cover versions and pnpm patch
 * hashes). This module and the graph module are the measuring tool, not what
 * is measured, so they are a stop set; a change to the algorithm still shows,
 * as a digest that no longer matches.
 *
 * Digest: sha256 over the lines `<path>\0<sha256 of the file's bytes>\n`,
 * sorted by path. Content, not mtime: a touched file is unchanged, and a
 * restored one (anchor/mutants.mjs) is too.
 *
 * Usage: node scripts/lib/alSpikeFingerprint.mjs [--root=<dir>] <spike>
 *   prints the fingerprint as one JSON line; exit 64 on bad invocation,
 *   1 when an input cannot be read. The Rust generators call this CLI.
 *
 * @coordinates-with scripts/check-al-spike-results.mjs — recomputes this and fails "stale" on a mismatch
 * @coordinates-with scripts/check-al-spike-results.test.mjs — the self-test
 * @coordinates-with scripts/lib/alSpikeImportGraph.mjs — the import closure added to the inputs
 * @module scripts/lib/alSpikeFingerprint
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { importClosure } from "./alSpikeImportGraph.mjs";
import { isMainModule } from "./isMainModule.mjs";

export const GRILLS_DIR = "dev-docs/grills/agent-edit-ledger";
const G = GRILLS_DIR;
/** Root files a probe run under the repo's vitest depends on. */
const ROOT_DEPENDENCIES = ["package.json", "pnpm-lock.yaml", "vitest.shared.ts"];

/** Per spike: the repo-relative inputs walked, and outputs under them excluded. Every spike's own results.json is an output. */
export const SPIKE_INPUTS = {
  revert: { inputs: [`${G}/revert`] },
  // crash.rs compiles in the crash matrix the phase-0 gate also requires.
  backend: { inputs: [`${G}/backend`, "scripts/lib/alSpikeBackendCrashCases.json"] },
  txn: { inputs: [`${G}/txn`, `${G}/golden`] },
  // The anchor probe reads golden/provenance.md (its reason-code list) at run time.
  anchor: { inputs: [`${G}/anchor`, `${G}/golden/provenance.md`, ...ROOT_DEPENDENCIES] },
  review: {
    inputs: [`${G}/review`, `${G}/revert/lib`, `${G}/revert/package.json`, `${G}/revert/pnpm-lock.yaml`, `${G}/golden`, ...ROOT_DEPENDENCIES],
    outputs: [`${G}/review/out`],
  },
};

const IGNORED_NAMES = new Set(["node_modules", "target"]);
const CODE = /\.(?:[cm]?[jt]sx?)$/;
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/** `{ algorithm, digest, files }` for `spike` under `root`; throws on an unknown spike or a missing input. */
export function spikeFingerprint(root, spike) {
  if (!Object.hasOwn(SPIKE_INPUTS, spike)) throw new Error(`unknown spike "${spike}"`);
  const spec = SPIKE_INPUTS[spike];
  const outputs = new Set([`${G}/${spike}/results.json`, ...(spec.outputs ?? [])]);
  const files = {};
  const visit = (rel) => {
    if (outputs.has(rel)) return;
    const abs = path.join(root, rel);
    const st = statSync(abs, { throwIfNoEntry: false });
    if (st?.isDirectory()) {
      for (const name of readdirSync(abs)) {
        if (!name.startsWith(".") && !IGNORED_NAMES.has(name)) visit(`${rel}/${name}`);
      }
    } else if (st?.isFile()) files[rel] = sha256(readFileSync(abs));
  };
  for (const rel of spec.inputs) {
    if (!statSync(path.join(root, rel), { throwIfNoEntry: false })) throw new Error(`input ${rel} is missing`);
    visit(rel);
  }
  const tooling = [import.meta.filename, path.join(import.meta.dirname, "alSpikeImportGraph.mjs")].map((f) => path.relative(root, f).split(path.sep).join("/"));
  const entries = Object.keys(files).filter((f) => CODE.test(f));
  for (const rel of importClosure(root, entries, { stop: tooling })) {
    if (!Object.hasOwn(files, rel) && !outputs.has(rel)) files[rel] = sha256(readFileSync(path.join(root, rel)));
  }
  const sorted = Object.keys(files).sort();
  const digest = sha256(sorted.map((f) => `${f}\u0000${files[f]}\n`).join(""));
  return { algorithm: "sha256", digest, files: Object.fromEntries(sorted.map((f) => [f, files[f]])) };
}

/** Which paths differ between two `files` maps, each list sorted. */
export function diffFingerprints(recorded, current) {
  const keys = (o) => Object.keys(o).sort();
  return {
    changed: keys(current).filter((f) => Object.hasOwn(recorded, f) && recorded[f] !== current[f]),
    added: keys(current).filter((f) => !Object.hasOwn(recorded, f)),
    removed: keys(recorded).filter((f) => !Object.hasOwn(current, f)),
  };
}

function main() {
  const usage = `Usage: node scripts/lib/alSpikeFingerprint.mjs [--root=<dir>] <${Object.keys(SPIKE_INPUTS).join("|")}>`;
  let root = path.resolve(import.meta.dirname, "../..");
  const rest = [];
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--root=")) root = path.resolve(a.slice("--root=".length));
    else rest.push(a);
  }
  if (rest.length !== 1 || !Object.hasOwn(SPIKE_INPUTS, rest[0])) {
    console.error(usage);
    process.exit(64);
  }
  try {
    console.log(JSON.stringify(spikeFingerprint(root, rest[0])));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (isMainModule(import.meta.url)) main();
