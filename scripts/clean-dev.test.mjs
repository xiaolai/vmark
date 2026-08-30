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
import { mkdirSync, rmdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
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

describe("--help", () => {
  // The help text used to be a hardcoded `sed -n '2,30p'` line range, which
  // overshot the header and printed four lines of shell (`set -uo pipefail`,
  // the `cd`, `ROOT=`). A fixed range silently rots every time the header
  // grows, so the fix is to stop at the first non-comment line instead.
  it("prints the header without leaking shell code", () => {
    const r = run(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Reclaim dev-box disk");
    expect(r.stdout).not.toContain("set -uo pipefail");
    expect(r.stdout).not.toContain("ROOT=");
    expect(r.stdout).not.toMatch(/^cd /m);
  });

  it("still documents every tier", () => {
    const out = run(["--help"]).stdout;
    for (const tier of ["1", "2", "3"]) expect(out).toMatch(new RegExp(`^\\s*${tier}\\s`, "m"));
  });
});

describe("spike probe artifacts", () => {
  // Spike probes (60-ai-governance.md §7) are separate cargo/npm projects nested
  // under dev-docs/grills/, so the app's `cargo clean` cannot reach them and
  // Cargo never GCs. Three had accumulated 818 MB whose probe sources no longer
  // existed. The sweep must take the artifact dirs and NOTHING else: the spike
  // reports are the evidence §7 requires.
  //
  // dev-docs/ is maintainer-local and gitignored, so on CI it does not exist
  // at all. Cleanup removes the fixture only, then prunes empty ancestors
  // non-recursively — see the afterEach below.
  const FIXTURE = path.join(REPO, "dev-docs/grills/__clean-dev-fixture__");

  function withFixture() {
    mkdirSync(path.join(FIXTURE, "probe/target/debug"), { recursive: true });
    mkdirSync(path.join(FIXTURE, "probe/node_modules/left-pad"), { recursive: true });
    mkdirSync(path.join(FIXTURE, "probe/src"), { recursive: true });
    writeFileSync(path.join(FIXTURE, "spike-report.md"), "# findings\n");
  }

  afterEach(() => {
    // Remove only what is certainly ours (the fixture itself), then prune
    // now-empty ancestors with a NON-recursive rmdir: it refuses any
    // directory that still has content — a maintainer's real dev-docs, or a
    // sibling gate test's live fixture (check-ui-phase.test.mjs probes this
    // same tree) — which is exactly the safe outcome. The previous cleanup
    // recursively removed the topmost dir it had created (up to dev-docs/
    // itself on a tree where it was absent), deleting sibling fixtures
    // mid-test under the parallel pool.
    rmSync(FIXTURE, { recursive: true, force: true });
    for (const dir of [path.dirname(FIXTURE), path.join(REPO, "dev-docs")]) {
      try {
        rmdirSync(dir);
      } catch {
        break; // non-empty or already gone — leave it alone
      }
    }
  });

  const actions = (args) =>
    run(args)
      .stdout.split("\n")
      .filter((l) => l.startsWith("DRY-RUN:"))
      .join("\n");

  it("tier 1 sweeps orphaned target/ and node_modules/ under dev-docs/grills", () => {
    withFixture();
    const out = actions(["1", "--dry-run"]);
    expect(out).toContain("dev-docs/grills/__clean-dev-fixture__/probe/target");
    expect(out).toContain("dev-docs/grills/__clean-dev-fixture__/probe/node_modules");
  });

  it("keeps the spike report and the probe source — they are the evidence", () => {
    withFixture();
    const out = actions(["1", "--dry-run"]);
    expect(out).not.toContain("spike-report.md");
    expect(out).not.toContain("probe/src");
  });

  it("does not recurse into a swept directory", () => {
    // Listing target/debug separately would mean the prune is missing, and the
    // second rm -rf would operate on an already-deleted path.
    withFixture();
    expect(actions(["1", "--dry-run"])).not.toContain("probe/target/debug");
  });

  it("is a no-op when dev-docs/grills is absent", () => {
    if (existsSync(path.join(REPO, "dev-docs/grills"))) return;
    const r = run(["1", "--dry-run"]);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("dev-docs/grills");
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

  it("tier 1 removes the regenerable report trees", () => {
    // coverage/ (52 MB) and reports/ (16 MB) are rebuilt by `pnpm test:coverage`
    // and `pnpm dup` / `mutation:ts`. They are project-local and need no
    // network, which is exactly tier 1's remit — dist/ was already here.
    const out = actions(["1", "--dry-run"]);
    expect(out).toMatch(/\bcoverage\b/);
    expect(out).toMatch(/\breports\b/);
  });

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
