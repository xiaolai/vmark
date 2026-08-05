/**
 * WI-18 — Mock-boundary identity ratchet gate (D4).
 *
 * Tests run the REAL script as a subprocess against tmpdir fixture trees —
 * no mocking anywhere (the gate that polices mocks must not itself be proven
 * with mocks). The baseline is an identity list of (test file, mocking API,
 * resolved module target) triples, never counts: counts permit like-for-like
 * swaps, the exact defect WI-16 exists to kill.
 *
 * Every failure-path case asserts on the MESSAGE, not just the exit code, so
 * a missing/crashing script (also exit 1) cannot fake a pass.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { invokedScripts } from "./lib/packageScripts.mjs";
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO, "scripts", "check-mock-boundaries.mjs");

/** Create a fixture tree: { "src/hooks/x.test.ts": "content", ... } */
function writeTree(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "mock-boundaries-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

/** Run the real gate against a fixture root. `baseline` may be an object
 *  (serialized to JSON) or a raw string (for the malformed-JSON case). */
function runGate(root, baseline) {
  const baselinePath = path.join(root, "baseline.json");
  writeFileSync(
    baselinePath,
    typeof baseline === "string" ? baseline : JSON.stringify(baseline, null, 2),
  );
  const res = spawnSync(
    process.execPath,
    [SCRIPT, "--root", root, "--baseline", baselinePath],
    { encoding: "utf8" },
  );
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

const EMPTY = { entries: [] };
const triple = (file, api, target) => ({ file, api, target });

describe("check-mock-boundaries.mjs (identity ratchet over fixture trees)", () => {
  // Case 1 — new @/stores mock not in baseline → exit 1 naming file + target
  it("fails on a vi.mock('@/stores/…') absent from the baseline, naming file and target", () => {
    const root = writeTree({
      "src/hooks/useFoo.test.ts": `import { vi } from "vitest";\nvi.mock("@/stores/fooStore");\n`,
    });
    const { status, stderr } = runGate(root, EMPTY);
    expect(status).toBe(1);
    expect(stderr).toContain("src/hooks/useFoo.test.ts");
    expect(stderr).toContain("src/stores/fooStore");
  });

  // Case 2 — identity swap at constant count → exit 1 naming the new target
  it("fails an identity swap: baselined mock A replaced by unbaselined mock B, same count", () => {
    const root = writeTree({
      "src/hooks/useFoo.test.ts": `import { vi } from "vitest";\nvi.mock("@/stores/bStore");\n`,
    });
    const { status, stderr } = runGate(root, {
      entries: [triple("src/hooks/useFoo.test.ts", "vi.mock", "src/stores/aStore")],
    });
    expect(status).toBe(1);
    expect(stderr).toContain("src/stores/bStore");
  });

  // Case 3 — unrecorded improvement → exit 1, "record the win"
  it("fails when a baselined mock no longer exists and the win was not recorded", () => {
    const root = writeTree({
      "src/hooks/useFoo.test.ts": `import { vi } from "vitest";\n// mock removed, entry kept\n`,
    });
    const { status, stderr } = runGate(root, {
      entries: [triple("src/hooks/useFoo.test.ts", "vi.mock", "src/stores/fooStore")],
    });
    expect(status).toBe(1);
    expect(stderr.toLowerCase()).toContain("record the win");
  });

  // Case 4 — legitimate boundary mock → not counted
  it("does not count vi.mock('@tauri-apps/api') — mocking the boundary is the sanctioned pattern", () => {
    const root = writeTree({
      "src/hooks/useBar.test.ts": `import { vi } from "vitest";\nvi.mock("@tauri-apps/api");\nvi.mock("@tauri-apps/api/event");\n`,
    });
    const { status, stdout } = runGate(root, EMPTY);
    expect(status).toBe(0);
    expect(stdout).toContain("✅");
  });

  // Case 5 — literal in a comment → not counted (parse, don't grep)
  it("does not count the literal inside comments — the scanner parses, it does not grep", () => {
    const root = writeTree({
      "src/hooks/useBaz.test.ts":
        `import { vi } from "vitest";\n` +
        `// vi.mock("@/stores/x") is banned here\n` +
        `/* and vi.mock("@/stores/y") in a block comment is prose too */\n`,
    });
    const { status } = runGate(root, EMPTY);
    expect(status).toBe(0);
  });

  // Case 6 — vi.doMock and vi.mock(import(...)) variants → both counted
  it("counts vi.doMock and the vi.mock(import(...)) dynamic variant", () => {
    const root = writeTree({
      "src/hooks/useQux.test.ts":
        `import { vi } from "vitest";\n` +
        `vi.doMock("@/stores/x");\n` +
        `vi.mock(import("@/stores/y"));\n`,
    });
    const { status, stderr } = runGate(root, EMPTY);
    expect(status).toBe(1);
    expect(stderr).toContain("src/stores/x");
    expect(stderr).toContain("src/stores/y");
    expect(stderr).toContain("vi.doMock");
  });

  // Case 7 — relative-path mock resolving into src/stores/ → counted
  it("counts a relative-path mock that resolves into src/stores/", () => {
    const root = writeTree({
      "src/hooks/useRel.test.ts": `import { vi } from "vitest";\nvi.mock("../stores/fooStore");\n`,
    });
    const { status, stderr } = runGate(root, EMPTY);
    expect(status).toBe(1);
    expect(stderr).toContain("src/stores/fooStore");
  });

  // Case 8 — __mocks__ directory shadowing a store module → counted
  it("counts a __mocks__ shadow file for a store module", () => {
    const root = writeTree({
      "src/stores/__mocks__/fooStore.ts": `export const useFooStore = () => ({});\n`,
    });
    const { status, stderr } = runGate(root, EMPTY);
    expect(status).toBe(1);
    expect(stderr).toContain("src/stores/__mocks__/fooStore.ts");
    expect(stderr).toContain("__mocks__");
  });

  // Case 9 — mock in a src/test/ helper (not *.test.*) → counted
  it("scans src/test/ helper files, not only *.test.* files", () => {
    const root = writeTree({
      "src/test/someHarness.ts": `import { vi } from "vitest";\nvi.mock("@/stores/fooStore");\n`,
    });
    const { status, stderr } = runGate(root, EMPTY);
    expect(status).toBe(1);
    expect(stderr).toContain("src/test/someHarness.ts");
    expect(stderr).toContain("src/stores/fooStore");
  });

  // Case 10 — exact identity match → exit 0
  it("passes when the tree's triples equal the baseline exactly", () => {
    const root = writeTree({
      "src/hooks/useFoo.test.ts": `import { vi } from "vitest";\nvi.mock("@/stores/fooStore");\n`,
    });
    const { status, stdout } = runGate(root, {
      entries: [triple("src/hooks/useFoo.test.ts", "vi.mock", "src/stores/fooStore")],
    });
    expect(status).toBe(0);
    expect(stdout).toContain("✅");
  });

  // Case 11 — fresh test file with one store mock, zero-entry baseline → exit 1
  it("fails a brand-new test file introducing a store mock (default is zero entries)", () => {
    const root = writeTree({
      "src/services/fresh.spec.tsx": `import { vi } from "vitest";\nvi.mock("@/stores/newStore");\n`,
    });
    const { status, stderr } = runGate(root, EMPTY);
    expect(status).toBe(1);
    expect(stderr).toContain("src/services/fresh.spec.tsx");
    expect(stderr).toContain("src/stores/newStore");
  });

  // Real-tree hardening: a nested git checkout (agent worktree) is another
  // tree — its test files must not leak into this tree's verdict.
  it("skips nested git checkouts so machine-local worktrees cannot break the gate", () => {
    const root = writeTree({
      "sub/.git": `gitdir: /elsewhere\n`,
      "sub/src/hooks/useFoo.test.ts": `import { vi } from "vitest";\nvi.mock("@/stores/fooStore");\n`,
    });
    const { status } = runGate(root, EMPTY);
    expect(status).toBe(0);
  });

  // Real-tree hardening: Stryker's sandbox (`.stryker-tmp/`, gitignored) is a
  // full COPY of the repo — scanning it double-counts every baselined mock and
  // turns a running mutation measurement into 200+ phantom violations.
  it("skips .stryker-tmp so a running mutation sandbox cannot break the gate", () => {
    const root = writeTree({
      ".stryker-tmp/sandbox-abc123/src/hooks/useFoo.test.ts":
        `import { vi } from "vitest";\nvi.mock("@/stores/fooStore");\n`,
    });
    const { status } = runGate(root, EMPTY);
    expect(status).toBe(0);
  });

  // ── Detector-evasion classes (the gate is only as good as what it can see) ──

  // A constant-backed target used to be invisible: `specifierOf` returned null
  // for anything that was not a literal, and a null spec was skipped silently.
  it("resolves a same-file const string binding used as the mock target", () => {
    const root = writeTree({
      "src/hooks/useConst.test.ts":
        `import { vi } from "vitest";\n` +
        `const STORE_PATH = "@/stores/fooStore";\n` +
        `vi.doMock(STORE_PATH);\n`,
    });
    const { status, stderr } = runGate(root, EMPTY);
    expect(status).toBe(1);
    expect(stderr).toContain("src/stores/fooStore");
    expect(stderr).toContain("vi.doMock");
  });

  it("resolves a const binding pointing at a boundary, and still does not count it", () => {
    const root = writeTree({
      "src/hooks/useConstBoundary.test.ts":
        `import { vi } from "vitest";\n` +
        `const TAURI = "@tauri-apps/api/event";\n` +
        `vi.mock(TAURI);\n`,
    });
    expect(runGate(root, EMPTY).status).toBe(0);
  });

  it("fails closed on a mock target it cannot resolve, naming the file", () => {
    // An expression target is not a store mock the gate has CLEARED — it is one
    // it cannot read. Silently skipping it is a detector-shaped hole.
    const root = writeTree({
      "src/hooks/useDynamic.test.ts":
        `import { vi } from "vitest";\n` +
        `const pick = (n: string) => \`@/stores/\${n}\`;\n` +
        `vi.mock(pick("fooStore"));\n`,
    });
    const { status, stderr } = runGate(root, EMPTY);
    expect(status).toBe(1);
    expect(stderr).toContain("src/hooks/useDynamic.test.ts");
    expect(stderr).toContain("non-literal mock target");
  });

  it("treats a target bound twice to different values as unresolvable", () => {
    const root = writeTree({
      "src/hooks/useAmbiguous.test.ts":
        `import { vi } from "vitest";\n` +
        `let P = "@tauri-apps/api";\n` +
        `P = "@/stores/fooStore";\n` +
        `const Q = "@/stores/barStore";\n` +
        `const P2 = P;\n` +
        `vi.mock(P2);\n` +
        `void Q;\n`,
    });
    const { status, stderr } = runGate(root, EMPTY);
    expect(status).toBe(1);
    expect(stderr).toContain("non-literal mock target");
  });

  it("counts a store mock through an ALIASED vitest import (`vi as v`)", () => {
    // Only a receiver literally spelled `vi` was recognized, so renaming the
    // import at the top of the file left the gate blind to the whole suite.
    const root = writeTree({
      "src/hooks/useAlias.test.ts":
        `import { vi as v } from "vitest";\n` + `v.mock("@/stores/fooStore");\n`,
    });
    const { status, stderr } = runGate(root, EMPTY);
    expect(status).toBe(1);
    expect(stderr).toContain("src/stores/fooStore");
    // The identity stays canonical so an alias cannot fork a baseline entry.
    expect(stderr).toContain("vi.mock");
  });

  it("counts a store mock through a vitest NAMESPACE import", () => {
    const root = writeTree({
      "src/hooks/useNamespace.test.ts":
        `import * as vitest from "vitest";\n` + `vitest.vi.doMock("@/stores/fooStore");\n`,
    });
    const { status, stderr } = runGate(root, EMPTY);
    expect(status).toBe(1);
    expect(stderr).toContain("src/stores/fooStore");
  });

  it("still counts the global `vi` when the file imports nothing (globals: true)", () => {
    const root = writeTree({
      "src/hooks/useGlobal.test.ts": `vi.mock("@/stores/fooStore");\n`,
    });
    expect(runGate(root, EMPTY).status).toBe(1);
  });

  it("does not count a `.mock()` call on an unrelated receiver", () => {
    const root = writeTree({
      "src/hooks/useOther.test.ts":
        `import { vi } from "vitest";\n` +
        `const jest = { mock: (_: string) => {} };\n` +
        `jest.mock("@/stores/fooStore");\n` +
        `void vi;\n`,
    });
    expect(runGate(root, EMPTY).status).toBe(0);
  });

  // Case 12 — malformed baseline → exit 1, fail closed
  it("fails closed on a truncated/malformed baseline file", () => {
    const root = writeTree({
      "src/hooks/ok.test.ts": `export {};\n`,
    });
    const { status, stderr } = runGate(root, `{"entries": [`);
    expect(status).toBe(1);
    expect(stderr.toLowerCase()).toContain("baseline");
  });
});

describe("wiring (case 13) — real package.json and real baseline", () => {
  it("exposes lint:mock-boundaries and chains it into check:all", () => {
    const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8"));
    expect(pkg.scripts["lint:mock-boundaries"]).toBe("node scripts/check-mock-boundaries.mjs");
    // Transitive: check:all composes check:static/servers/build, so a
    // literal substring check would break on regrouping (see
    // scripts/lib/packageScripts.mjs).
    expect(invokedScripts(pkg.scripts, "check:all")).toContain("lint:mock-boundaries");
  });

  it("ships a real identity baseline, registered in the WI-16 merge-base ratchet", async () => {
    const baseline = JSON.parse(
      readFileSync(path.join(REPO, "scripts", "mock-boundaries-baseline.json"), "utf8"),
    );
    expect(Array.isArray(baseline.entries)).toBe(true);
    // Registration is asserted against the manifest itself, not against prose
    // in the header: this baseline is only protected from same-commit
    // self-attestation while WI-16 actually covers it, in identity form.
    const { MANIFEST } = await import("./baselineRatchetManifest.mjs");
    const registered = MANIFEST.entries.find(
      (e) => e.path === "scripts/mock-boundaries-baseline.json",
    );
    expect(registered).toBeDefined();
    expect(registered.checks).toEqual([
      { mode: "identity", at: "entries", shape: "objects", key: ["file", "api", "target"], onAdd: "fail" },
    ]);
    expect(JSON.stringify(baseline["//"])).not.toContain("MANIFEST-PENDING");
    for (const e of baseline.entries) {
      expect(typeof e.file).toBe("string");
      expect(typeof e.api).toBe("string");
      expect(typeof e.target).toBe("string");
    }
  });
});
