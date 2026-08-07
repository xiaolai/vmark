/**
 * The one behaviour in `clean-dev.sh` that is not recoverable if it is wrong.
 *
 * `cargo clean` removes the whole target tree and cannot spare a subdirectory,
 * so a locally built `target/release/bundle/` — code-signed and notarized but
 * not yet uploaded — is gone with it, and getting it back costs a re-sign and a
 * re-notarize against Apple's quota. The script therefore REFUSES rather than
 * deleting silently.
 *
 * That guard is exactly the kind that quietly stops working, and reading the
 * source is not proof it runs. `--dry-run` exists so this can be exercised for
 * real without a code path that deletes anything.
 *
 * @coordinates-with scripts/clean-dev.sh
 * @module scripts/clean-dev.test
 */
import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO, "scripts/clean-dev.sh");
const BUNDLE = path.join(REPO, "src-tauri/target/release/bundle");

function run(args) {
  return spawnSync("bash", [SCRIPT, ...args], { cwd: REPO, encoding: "utf8", timeout: 60_000 });
}

/**
 * Create the bundle dir, remembering the TOPMOST path that did not exist so
 * cleanup removes exactly the chain this test made — `mkdir -p` can create
 * `target/` and `target/release/` too, and leaving those behind is litter.
 */
let createdRoot = null;
function withBundle() {
  if (!existsSync(BUNDLE)) {
    let candidate = BUNDLE;
    while (!existsSync(path.dirname(candidate)) && path.dirname(candidate) !== REPO) {
      candidate = path.dirname(candidate);
    }
    createdRoot = candidate;
  }
  mkdirSync(BUNDLE, { recursive: true });
}

afterEach(() => {
  // Only remove what this test made. Never touch a real bundle.
  if (createdRoot && existsSync(createdRoot)) {
    rmSync(createdRoot, { recursive: true, force: true });
  }
  createdRoot = null;
});

describe("bundle guard", () => {
  it("refuses when target/release/bundle exists", () => {
    withBundle();
    const r = run(["--dry-run"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("refusing");
    expect(r.stderr).toContain("--include-bundle");
  });

  it("refuses BEFORE running cargo clean, not after", () => {
    // The ordering is the whole guard: a refusal printed after the deletion
    // would be a eulogy, not a gate.
    withBundle();
    const r = run(["--dry-run"]);
    expect(r.stdout).not.toContain("cargo clean");
  });

  it("names the release-check command so the reader can resolve it", () => {
    withBundle();
    expect(run(["--dry-run"]).stderr).toContain("gh release view");
  });

  it("proceeds once --include-bundle is given", () => {
    withBundle();
    const r = run(["--dry-run", "--include-bundle"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("DRY-RUN: cargo clean");
  });

  it("proceeds when no bundle exists", () => {
    if (existsSync(BUNDLE)) return; // a real bundle is present; the case above covers it
    const r = run(["--dry-run"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("DRY-RUN: cargo clean");
  });
});

describe("tiers", () => {
  // Assertions are anchored to the DRY-RUN action lines, not to raw stdout:
  // the BEFORE block runs `du -sh ~/.cargo/registry`, so a bare
  // `not.toContain(".cargo/registry")` matches a size report and proves nothing
  // about what would be deleted.
  const actions = (args) =>
    run(args)
      .stdout.split("\n")
      .filter((l) => l.startsWith("DRY-RUN:"))
      .join("\n");

  it("tier 1 does not touch machine-wide cargo caches", () => {
    const out = actions(["1", "--dry-run"]);
    expect(out).toContain("cargo clean");
    expect(out).not.toMatch(/\.cargo/);
  });

  it("tier 2 adds the cargo caches but keeps the registry index", () => {
    const out = actions(["2", "--dry-run"]);
    expect(out).toMatch(/registry\/cache/);
    expect(out).toMatch(/registry\/src/);
    // Deleting the index forces a full crates.io index re-fetch for no gain.
    expect(out).not.toMatch(/registry\/index/);
  });

  it("tier 3 adds pnpm store prune", () => {
    expect(run(["3", "--dry-run"]).stdout).toContain("pnpm store prune");
  });

  it("rejects an unknown argument instead of guessing a tier", () => {
    const r = run(["--nuke-everything", "--dry-run"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("unknown argument");
  });
});
