/**
 * WI-4 — cargo-mutants config-path staleness guard (D1).
 *
 * cargo-mutants reads `.cargo/mutants.toml` relative to the workspace root of
 * the manifest (verified against cargo-mutants 27.1.0: `--help` documents
 * `--config`/`--no-config` against `.cargo/mutants.toml`). The repo carried
 * its config at `src-tauri/mutants.toml` for its entire history — a path the
 * tool never reads — so every CI mutation run mutated the UNFILTERED tree into
 * its 60-minute timeout, hidden by `continue-on-error: true` (8/8 runs failed).
 *
 * This guard fails the gate whenever a config exists at the ignored legacy
 * path, and fails DISTINCTLY (fail closed) when no config exists at the path
 * the tool actually reads. Tests run the REAL script as a subprocess against
 * tmpdir fixture trees — same pattern as check-mock-boundaries.test.mjs.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO, "scripts", "check-mutants-config-path.mjs");

const LEGACY = "src-tauri/mutants.toml";
const CORRECT = "src-tauri/.cargo/mutants.toml";
const SENTINEL = 'examine_globs = ["src/sentinel.rs"]\n';

/** Create a fixture tree: { "src-tauri/mutants.toml": "content", ... } */
function writeTree(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "mutants-config-path-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

/** Run the real guard against a fixture root. */
function runGuard(root) {
  const res = spawnSync(process.execPath, [SCRIPT, "--root", root], {
    encoding: "utf8",
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

describe("check-mutants-config-path.mjs (fixture trees)", () => {
  // Case 1 — legacy path present → exit ≠0, names legacy AND correct path
  it("fails when a config sits at the ignored legacy path, naming both paths", () => {
    const root = writeTree({ [LEGACY]: SENTINEL });
    const { status, stderr } = runGuard(root);
    expect(status).toBe(1);
    expect(stderr).toContain(LEGACY);
    expect(stderr).toContain(CORRECT);
    expect(stderr).toContain("silently ignored");
  });

  // Case 2 — only the correct path → exit 0
  it("passes when the config exists only at the path cargo-mutants reads", () => {
    const root = writeTree({ [CORRECT]: SENTINEL });
    const { status, stdout } = runGuard(root);
    expect(status).toBe(0);
    expect(stdout).toContain("✅");
  });

  // Case 3 — both present → exit ≠0 with the legacy-path message
  it("fails when both paths exist — the legacy file must be deleted", () => {
    const root = writeTree({ [LEGACY]: SENTINEL, [CORRECT]: SENTINEL });
    const { status, stderr } = runGuard(root);
    expect(status).toBe(1);
    expect(stderr).toContain(LEGACY);
    expect(stderr).toContain("silently ignored");
  });

  // Case 4 — neither present → exit ≠0 with a DISTINCT fail-closed message
  it("fails closed with a distinct message when no config exists anywhere", () => {
    const root = writeTree({ "src-tauri/Cargo.toml": "[package]\n" });
    const { status, stderr } = runGuard(root);
    expect(status).toBe(1);
    expect(stderr).toContain(CORRECT);
    expect(stderr).toContain("config missing");
    expect(stderr).not.toContain("silently ignored");
  });

  // Case 5 — cases 1 and 4 produce two different diagnoses
  it("emits different substrings for legacy-path and missing-config failures", () => {
    const legacyRoot = writeTree({ [LEGACY]: SENTINEL });
    const emptyRoot = writeTree({ "src-tauri/Cargo.toml": "[package]\n" });
    const legacy = runGuard(legacyRoot);
    const missing = runGuard(emptyRoot);
    expect(legacy.stderr).toContain("silently ignored");
    expect(legacy.stderr).not.toContain("config missing");
    expect(missing.stderr).toContain("config missing");
    expect(missing.stderr).not.toContain("silently ignored");
    expect(legacy.stderr).not.toBe(missing.stderr);
  });
});

describe("wiring — real package.json and the real tree", () => {
  it("exposes lint:mutants-config and chains it into check:all", () => {
    const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8"));
    expect(pkg.scripts["lint:mutants-config"]).toBe(
      "node scripts/check-mutants-config-path.mjs",
    );
    expect(pkg.scripts["check:all"]).toContain("lint:mutants-config");
  });

  it("passes on the real repository (config relocated, legacy file gone)", () => {
    const { status, stdout } = runGuard(REPO);
    expect(status).toBe(0);
    expect(stdout).toContain("✅");
  });
});
