// Regression suite for the scoped TDD guard (gha-tdd-guard.mjs).
//
// This governance gate had NO executable tests despite recent changes to
// Windows normalization, symlink handling, malformed-input fail-closed
// behavior, and directory-vs-file validation — a silent regression here
// disables mandatory TDD enforcement. Each case drives the guard as a real
// subprocess (JSON on stdin → exit code), the same contract Claude Code uses.
//
// Exit codes: 0 allow · 2 block.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

// Vitest runs with cwd = repo root; import.meta.url is a virtual URL under the
// jsdom transform, so anchor on cwd instead.
const REPO = process.cwd();
const GUARD = join(REPO, ".claude/hooks/gha-tdd-guard.mjs");

/** Run the guard with a payload (object → JSON, or a raw string) on stdin. */
function runGuard(payload) {
  const input = typeof payload === "string" ? payload : JSON.stringify(payload);
  const res = spawnSync(process.execPath, [GUARD], { input, encoding: "utf8" });
  return { status: res.status, stderr: res.stderr ?? "" };
}

const write = (file_path) => ({ tool_name: "Write", tool_input: { file_path } });

// Temp fixtures created under a real in-scope dir so the guard's filesystem
// checks (isFile on the sibling candidate) hit real paths.
const DIR_AS_TEST = join(REPO, "src/lib/browser/__guardspec_dir__.test.ts");
const TESTS_DIR = join(REPO, "src/lib/browser/__tests__");
const TESTS_FILE = join(TESTS_DIR, "__guardspec_sub__.test.ts");

beforeAll(() => {
  mkdirSync(DIR_AS_TEST, { recursive: true }); // a DIRECTORY named like a test
  mkdirSync(TESTS_DIR, { recursive: true });
  // Safe noop body: if a crash ever leaves this behind, a stray collection
  // still passes rather than failing the suite.
  writeFileSync(TESTS_FILE, 'import { it } from "vitest";\nit("guard fixture", () => {});\n');
});

afterAll(() => {
  rmSync(DIR_AS_TEST, { recursive: true, force: true });
  rmSync(TESTS_DIR, { recursive: true, force: true });
});

describe("gha-tdd-guard — pass-through (not our business)", () => {
  it("allows non-mutation tools", () => {
    expect(runGuard({ tool_name: "Read", tool_input: { file_path: "src/lib/browser/x.ts" } }).status).toBe(0);
  });

  it("allows an out-of-scope path", () => {
    expect(runGuard(write("src/components/Sidebar/Foo.tsx")).status).toBe(0);
  });

  it("allows a path outside the repository", () => {
    expect(runGuard(write("/etc/passwd")).status).toBe(0);
  });

  it("allows a mutation tool with no file_path (e.g. NotebookEdit shape)", () => {
    // Blocking here would spuriously refuse every NotebookEdit, which carries
    // notebook_path (not file_path) and can never target a scoped .ts/.tsx.
    expect(runGuard({ tool_name: "Write", tool_input: {} }).status).toBe(0);
  });
});

describe("gha-tdd-guard — fail closed on unusable input", () => {
  it("blocks on malformed JSON", () => {
    expect(runGuard("this is not json{").status).toBe(2);
  });

  it("blocks on a non-object payload", () => {
    expect(runGuard("42").status).toBe(2);
  });

  it("passes through an array payload (no valid tool_name)", () => {
    // Documents current behavior: an array is JSON-valid, carries no
    // tool_name, so the guard treats it as not-our-business rather than a
    // scoped edit. (A real hook payload is always an object.)
    expect(runGuard("[]").status).toBe(0);
  });
});

describe("gha-tdd-guard — scope + allow-list", () => {
  it("blocks a scoped source with no sibling test", () => {
    const r = runGuard(write("src/lib/browser/__no_such_source__.ts"));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("no test file found");
  });

  it("allows a scoped source that HAS a sibling test", () => {
    // src/lib/browser/url.ts ships alongside url.test.ts.
    expect(runGuard(write("src/lib/browser/url.ts")).status).toBe(0);
  });

  it("allows a scoped source when the test lives in __tests__/", () => {
    expect(runGuard(write("src/lib/browser/__guardspec_sub__.ts")).status).toBe(0);
  });

  it("allows the test file itself", () => {
    expect(runGuard(write("src/lib/browser/url.test.ts")).status).toBe(0);
  });

  it("allows a type-only file (types.ts)", () => {
    expect(runGuard(write("src/lib/sites/types.ts")).status).toBe(0);
  });

  it("allows a .d.ts declaration file", () => {
    expect(runGuard(write("src/lib/browser/shims.d.ts")).status).toBe(0);
  });
});

describe("gha-tdd-guard — directory named like a test does not satisfy the gate", () => {
  it("blocks when the sibling test path is a DIRECTORY, not a file", () => {
    // isFile() must reject a directory named foo.test.ts.
    expect(runGuard(write("src/lib/browser/__guardspec_dir__.ts")).status).toBe(2);
  });
});

describe("gha-tdd-guard — embedded-browser scope is live", () => {
  it("blocks untested files in the browser/site/services globs and store scope", () => {
    for (const p of [
      "src/lib/browser/__probe__.ts",
      "src/lib/sites/__probe__.ts",
      "src/components/Browser/__probe__.tsx",
      "src/services/browser/__probe__.ts",
      "src/stores/webWorkflowStore.ts", // exact-path store scope; no test exists
    ]) {
      expect(runGuard(write(p)).status, `${p} should be scoped (blocked, no test)`).toBe(2);
    }
  });

  it("allows a scoped store that already has a test", () => {
    // browserStore.ts / browserApprovalStore.ts ship with tests — the gate is
    // satisfied, proving the sibling-test lookup resolves __tests__/ too.
    expect(runGuard(write("src/stores/browserStore.ts")).status).toBe(0);
    expect(runGuard(write("src/stores/browserApprovalStore.ts")).status).toBe(0);
  });
});
