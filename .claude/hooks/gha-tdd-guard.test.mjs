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
import { rmdirSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from "node:fs";
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
// checks (isFile on the sibling candidate) hit real paths. Names carry the
// pid so two concurrent vitest invocations on one checkout (a manual
// test:gates beside a running check:predelta) never create or delete each
// other's probes.
const TAG = `__guardspec_${process.pid}__`;
const DIR_AS_TEST = join(REPO, `src/lib/browser/${TAG}_dir.test.ts`);
const TESTS_DIR = join(REPO, "src/lib/browser/__tests__");
const TESTS_FILE = join(TESTS_DIR, `${TAG}_sub.test.ts`);

beforeAll(() => {
  mkdirSync(DIR_AS_TEST, { recursive: true }); // a DIRECTORY named like a test
  mkdirSync(TESTS_DIR, { recursive: true });
  // Safe noop body: if a crash ever leaves this behind, a stray collection
  // still passes rather than failing the suite.
  writeFileSync(TESTS_FILE, 'import { it } from "vitest";\nit("guard fixture", () => {});\n');
});

afterAll(() => {
  rmSync(DIR_AS_TEST, { recursive: true, force: true });
  // File-precise, then a NON-recursive rmdir: mkdirSync(recursive) succeeds
  // on a pre-existing __tests__/ too, and a recursive rm here would silently
  // delete any real tests that directory had acquired. rmdir refuses a
  // non-empty directory, which is exactly the safe outcome.
  rmSync(TESTS_FILE, { force: true });
  try {
    rmdirSync(TESTS_DIR);
  } catch {
    // non-empty or already gone — leave it alone
  }
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
    expect(runGuard(write(`src/lib/browser/${TAG}_sub.ts`)).status).toBe(0);
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
    expect(runGuard(write(`src/lib/browser/${TAG}_dir.ts`)).status).toBe(2);
  });
});

describe("gha-tdd-guard — embedded-browser scope is live", () => {
  it("blocks untested files in the browser/site/services globs and store scope", () => {
    for (const p of [
      "src/lib/browser/__probe__.ts",
      "src/lib/sites/__probe__.ts",
      "src/components/Browser/__probe__.tsx",
      "src/services/browser/__probe__.ts",
      // "src/stores/webWorkflowStore.ts" used to be asserted here as an
      // exact-path store scope. It never existed, so it blocked on the
      // no-such-file branch and this row proved nothing — WI-19 removed both
      // the scope entry and the claim.
    ]) {
      expect(runGuard(write(p)).status, `${p} should be scoped (blocked, no test)`).toBe(2);
    }
  });

  it("allows a scoped store that already has a test", () => {
    // browserApprovalStore.ts ships with a test in __tests__/ — the gate is
    // satisfied, proving the sibling-test lookup resolves __tests__/ too.
    // (browserStore.ts used to be the second case; the hibernation store was
    // judged fiction and deleted — E4/WI-6 — and its scope entry went with it.)
    expect(runGuard(write("src/stores/browserApprovalStore.ts")).status).toBe(0);
  });
});

describe("gha-tdd-guard — WI-19: SCOPED names paths that exist", () => {
  // The scope had drifted into fiction: four of its seven workflow entries
  // named paths that had not existed for months (src/lib/workflowRouting,
  // src/plugins/githubWorkflow, src/stores/workflowViewStore.ts,
  // src/stores/workflowEditStore.ts), plus src/stores/webWorkflowStore.ts and
  // the pre-WI-10 src/hooks/mcpBridge/v2/browser* location. A guard aimed at
  // nothing blocks nothing, and the shipped workflow-engine frontend was
  // unguarded the whole time.

  it("blocks an untested file in each REAL workflow scope", () => {
    for (const p of [
      "src/lib/workflow/__probe__.ts", // bespoke engine IR (parser, layout)
      "src/plugins/workflowPreview/__probe__.tsx", // the engine's graph view
      "src/services/workflow/__probe__.ts", // engine policy sync
      "src/components/WorkflowApproval/__probe__.tsx", // engine approval dialog
      "src/plugins/codemirror/sourceWorkflow__probe__.ts", // viewer + engine CM extensions
      "src/lib/ghaWorkflow/__probe__.ts", // GHA viewer core
      "src/components/Editor/WorkflowPanel/__probe__.tsx",
      "src/components/Editor/WorkflowEditor/__probe__.tsx",
    ]) {
      expect(runGuard(write(p)).status, `${p} should be scoped (blocked, no test)`).toBe(2);
    }
  });

  it("blocks the MCP browser handlers at their post-WI-10 location", () => {
    // They moved hooks/ → services/ in WI-10; the scope pattern did not follow,
    // so the automation handlers were silently unguarded.
    expect(runGuard(write("src/services/mcpBridge/v2/browser__probe__.ts")).status).toBe(2);
  });

  it("allows the real engine store, which ships with its test", () => {
    // Exact-path scope entry, satisfied — proves the entry resolves to a file
    // that exists, unlike the two store paths removed above.
    expect(runGuard(write("src/stores/workflowStore.ts")).status).toBe(0);
  });

  it("still honours the allow-list inside the new scopes", () => {
    expect(runGuard(write("src/lib/workflow/types.ts")).status).toBe(0);
    expect(runGuard(write("src/lib/workflow/parser.test.ts")).status).toBe(0);
    expect(runGuard(write("src/plugins/workflowPreview/workflow-node.css")).status).toBe(0);
  });

  // ── The CodeMirror workflow scope, derived from the tree, not from a list ──
  //
  // The scope entry was `sourceWorkflow*`, a NAME prefix. `sourceGhaIrSync.ts`
  // — 100+ lines that parse a GitHub Actions workflow into the IR the whole
  // viewer reads — is a workflow extension whose name simply does not start
  // that way, so it was unguarded. Enumerating by hand is how that happened;
  // this test globs the directory instead, so the next file to arrive under a
  // third naming convention fails here rather than escaping quietly.

  const CM_DIR = join(REPO, "src/plugins/codemirror");
  /** Imports that make a CodeMirror extension part of the workflow feature. */
  const WORKFLOW_LIBS = /ghaWorkflow|lib\/workflow|workflowPort/;

  /** Production CodeMirror extensions that belong to the workflow feature. */
  function realWorkflowExtensions() {
    return readdirSync(CM_DIR, { withFileTypes: true })
      .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
      .filter((e) => !/\.(test|spec)\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts"))
      .filter(
        (e) =>
          /workflow/i.test(e.name) || WORKFLOW_LIBS.test(readFileSync(join(CM_DIR, e.name), "utf8")),
      )
      .map((e) => e.name)
      .sort();
  }

  it("scopes EVERY workflow extension in src/plugins/codemirror, globbed from the tree", () => {
    const files = realWorkflowExtensions();
    // The specific miss, named so the regression is not merely counted.
    expect(files).toContain("sourceGhaIrSync.ts");
    expect(files.length).toBeGreaterThanOrEqual(6);

    for (const name of files) {
      // Probe a sibling that cannot have a test rather than the file itself:
      // a scoped file WITH a test also exits 0, so the real path cannot tell
      // "in scope and satisfied" from "not in scope at all". Renaming can only
      // make this assertion stricter, never let a gap through.
      const probe = name.replace(/(\.tsx?)$/, "__probe__$1");
      expect(
        runGuard(write(`src/plugins/codemirror/${probe}`)).status,
        `${name} must be TDD-scoped (probe: ${probe})`,
      ).toBe(2);
    }
  });

  it("leaves non-workflow CodeMirror extensions out of scope", () => {
    // The scope is the workflow feature, not the whole 40-file cluster.
    expect(runGuard(write("src/plugins/codemirror/markdownAutoPair__probe__.ts")).status).toBe(0);
  });

  it("does NOT block the removed dead paths — a scope aimed at nothing is not enforcement", () => {
    // These would have been blocked before WI-19 while protecting no code. If
    // one is ever recreated, it must be re-added deliberately, not inherited.
    for (const p of [
      "src/lib/workflowRouting/router.ts",
      "src/plugins/githubWorkflow/tiptap.ts",
      "src/stores/workflowViewStore.ts",
      "src/stores/workflowEditStore.ts",
      "src/stores/webWorkflowStore.ts",
      "src/hooks/mcpBridge/v2/browserNavigation.ts",
    ]) {
      expect(runGuard(write(p)).status, `${p} no longer exists; must not be scoped`).toBe(0);
    }
  });
});
