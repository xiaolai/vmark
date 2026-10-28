// WI-AL0.7 — the slice 1.4 gate asserts the editor collectors, view certificates, retention budgets, the save-path journal deadline, real-WebKit IME and plugin continuity, each failing on its own when its fact is missing
/**
 * Runs the REAL `scripts/check-al-slice.sh 1.4` against fixture trees
 * (`--root`), the pattern of `check-al-phase.test.mjs`: stub `pnpm` and
 * `cargo` first on PATH log their argv and exit 0, so the gate's discovery,
 * tier routing and assertions run for real while the test stays fast.
 *
 * One fixture satisfies every assertion; each case removes exactly one fact
 * and expects the gate red, naming that fact.
 *
 * @coordinates-with scripts/lib/al-slices.sh — al_slice_1_4, the assertions under test
 * @coordinates-with scripts/lib/al-gate.sh — al_test_has, the single-file helper
 * @module scripts/check-al-slice-1-4.test
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const SLICE = path.join(REPO, "scripts", "check-al-slice.sh");
const made = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function write(root, rel, body) {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), body);
}

const STUB = `#!/usr/bin/env bash
echo "$(basename "$0") $*" >> "$STUB_LOG"
if [[ "$(basename "$0")" == cargo ]]; then echo "test result: ok. 3 passed; 0 failed"; fi
exit 0
`;

/** A linked test naming `words` in its case title: the gate reads test CODE, and a comment proves nothing. */
const TS = (header, words) => `// ${header}\nimport { it } from "vitest";\nit(${JSON.stringify(words.join(" "))}, () => {});\n`;

/** Scenario words the protocol, collector, certificate, budget, deadline and objection-8 tests mention. */
const SCENARIOS = [
  "transform", "selection.set", "apply_patch", "concurrent_observation", "pending_observation", "observed_parent",
  "observed_preimage", "journaled", "capture fails", "source:unobserved-transaction", "wysiwyg:unobserved-transaction",
  "openView", "snapshotOnly", "capOverflow", "MAX_FROZEN_WINDOWS", "MAX_WINDOW_STEPS", "withJournalDeadline",
  "releaseWindow", "drained",
];
const PLUGIN = ["registerPlugin", "unregisterPlugin", "journalWarn", "wysiwyg:unobserved-transaction"];
const IME = ["compositionstart", "createSourceProvenance", "noteWysiwygFlush"];

const SCENARIO_TEST = "src/services/agentJournal/__tests__/slice.test.ts";
const PLUGIN_TEST = "src/services/agentJournal/collectors/__tests__/plugins.test.ts";
const IME_TEST = "src/services/agentJournal/collectors/__tests__/ime.webkit.test.ts";
const RUST_TEST = "src-tauri/src/agent_journal/budget.test.rs";

/** A tree satisfying every slice 1.4 assertion. */
function satisfied({ scenarios = SCENARIOS, plugin = PLUGIN } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "al-slice14-"));
  made.push(root);
  for (const tool of ["pnpm", "cargo"]) {
    write(root, `bin/${tool}`, STUB);
    chmodSync(path.join(root, "bin", tool), 0o755);
  }
  write(root, SCENARIO_TEST, TS("WI-AL1.4 — scenarios", scenarios));
  write(root, PLUGIN_TEST, TS("WI-AL1.4 — plugin continuity", plugin));
  write(root, IME_TEST, TS("WI-AL1.4 — IME in WebKit", IME));
  write(root, "src-tauri/src/lib.rs", "mod agent_journal;\n");
  write(root, "src-tauri/src/agent_journal/mod.rs", 'mod budget;\npub struct W;\nimpl W { pub fn clear_window_base(&self) {} }\n');
  write(root, "src-tauri/src/agent_journal/budget.rs", 'pub struct RetentionBudget;\n#[cfg(test)]\n#[path = "budget.test.rs"]\nmod tests;\n');
  write(root, RUST_TEST, '// WI-AL1.4 — retention budget\n#[test]\nfn pins() { let _ = "RetentionBudget window_bases"; }\n');
  write(root, "src/services/agentJournal/provenance/certificates.ts", "export class ViewCertificate {}\n");
  write(root, "src/services/agentJournal/saveJournal.ts", "withJournalDeadline(\"save\", () => 1);\n");
  write(root, "src/services/assembly/tiptapExtensions.ts", "wysiwygProvenanceExtension(tabId);\n");
  write(root, "src/components/Editor/useTiptapFlush.ts", "noteWysiwygFlush(editor, markdown, options);\n");
  write(root, "src/components/Editor/tiptapContentLoad.ts", "noteWysiwygLoaded(editor, markdown);\n");
  write(root, "src/components/Editor/SourceEditor.tsx", "createSourceProvenance(tabId, live);\n");
  return root;
}

function slice(root) {
  const log = path.join(root, "exec.log");
  const r = spawnSync("bash", [SLICE, "1.4", `--root=${root}`], {
    encoding: "utf8",
    cwd: REPO,
    env: { ...process.env, PATH: `${path.join(root, "bin")}:${process.env.PATH}`, STUB_LOG: log },
    timeout: 120_000,
    killSignal: "SIGKILL",
  });
  if (r.error) throw r.error;
  return { status: r.status, out: `${r.stdout}${r.stderr}`, log: existsSync(log) ? readFileSync(log, "utf8") : "" };
}

const without = (list, word) => list.filter((w) => w !== word);

describe("check-al-slice.sh 1.4", () => {
  it("passes on a satisfied tree, running the app, browser and Rust tiers", () => {
    const r = slice(satisfied());
    expect(r.status, r.out).toBe(0);
    expect(r.log).toContain(`pnpm vitest run --config vitest.browser.config.ts ${IME_TEST}`);
    expect(r.log).toContain("cargo test --manifest-path src-tauri/Cargo.toml --lib -- agent_journal::budget::");
  });

  it.each([
    ["src/services/assembly/tiptapExtensions.ts", "WYSIWYG observer"],
    ["src/components/Editor/useTiptapFlush.ts", "flush reports"],
    ["src/components/Editor/tiptapContentLoad.ts", "load anchors"],
    ["src/components/Editor/SourceEditor.tsx", "Source collector"],
    ["src/services/agentJournal/saveJournal.ts", "deadline on the save path"],
    ["src/services/agentJournal/provenance/certificates.ts", "ViewCertificate"],
  ])("fails when %s no longer wires its fact (%s)", (file, label) => {
    const root = satisfied();
    write(root, file, "export {};\n");
    const r = slice(root);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(new RegExp(`✗ [^\\n]*${label}`));
  });

  it.each([
    ["src/services/assembly/tiptapExtensions.ts", "wysiwygProvenanceExtension(tabId);", "WYSIWYG observer"],
    ["src/components/Editor/useTiptapFlush.ts", "noteWysiwygFlush(editor, markdown, options);", "flush reports"],
    ["src/components/Editor/tiptapContentLoad.ts", "noteWysiwygLoaded(editor, markdown);", "load anchors"],
    ["src/components/Editor/SourceEditor.tsx", "createSourceProvenance(tabId, live);", "Source collector"],
    ["src/services/agentJournal/saveJournal.ts", 'withJournalDeadline("save", () => 1);', "deadline on the save path"],
  ])("fails when %s only has its call commented out", (file, call, label) => {
    const root = satisfied();
    write(root, file, `// ${call}\n/* ${call} */\nexport {};\n`);
    const r = slice(root);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(new RegExp(`✗ [^\\n]*${label}`));
  });

  it("fails when the journal no longer releases a closed tab's window base", () => {
    const root = satisfied();
    write(root, "src-tauri/src/agent_journal/mod.rs", "mod budget;\n");
    const r = slice(root);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/✗ [^\n]*clear_window_base/);
  });

  it.each([
    ["source:unobserved-transaction", "Source collector gap"],
    ["wysiwyg:unobserved-transaction", "WYSIWYG collector gap"],
    ["openView", "certificate issued by openView"],
    ["snapshotOnly", "snapshotOnly"],
    ["capOverflow", "capOverflow"],
    ["MAX_FROZEN_WINDOWS", "frozen-window budget"],
    ["MAX_WINDOW_STEPS", "window step budget"],
    ["withJournalDeadline", "hung journal"],
    ["releaseWindow", "released on close"],
    ["drained", "drained capture"],
  ])("fails when no linked test covers %s", (word, label) => {
    const plugin = word === "wysiwyg:unobserved-transaction" ? without(PLUGIN, word) : PLUGIN;
    const r = slice(satisfied({ scenarios: without(SCENARIOS, word), plugin }));
    expect(r.status).toBe(1);
    expect(r.out).toMatch(new RegExp(`✗ [^\\n]*${label}`));
  });

  it("fails when no linked Rust test covers the retention budget", () => {
    const root = satisfied();
    write(root, RUST_TEST, "// WI-AL1.4 — retention budget\n#[test]\nfn pins() {}\n");
    const r = slice(root);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/✗ [^\n]*retention budget/);
  });

  it.each(["registerPlugin", "unregisterPlugin", "journalWarn"])(
    "plugin continuity needs one test with every fact: %s moved to another file fails",
    (word) => {
      const r = slice(satisfied({ scenarios: [...SCENARIOS, word], plugin: without(PLUGIN, word) }));
      expect(r.status).toBe(1);
      expect(r.out).toMatch(/✗ [^\n]*plugin set changed while live/);
    },
  );

  it("plugin continuity is an app test: a linked gate self-test naming every fact does not satisfy it", () => {
    const root = satisfied({ plugin: ["wysiwyg:unobserved-transaction"] });
    write(root, "scripts/plugins.test.mjs", TS("WI-AL1.4 — names the words, proves nothing", PLUGIN));
    const r = slice(root);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/✗ [^\n]*plugin set changed while live/);
  });

  it("IME must run in real WebKit: the same test outside the browser tier fails", () => {
    const root = satisfied();
    renameSync(path.join(root, IME_TEST), path.join(root, IME_TEST.replace(".webkit.test.", ".test.")));
    const r = slice(root);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/✗ [^\n]*real WebKit/);
  });

  it.each(IME)("the WebKit IME test must drive both collectors: without %s it fails", (word) => {
    const root = satisfied();
    write(root, IME_TEST, TS("WI-AL1.4 — IME in WebKit", without(IME, word)));
    const r = slice(root);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/✗ [^\n]*real WebKit/);
  });
});
