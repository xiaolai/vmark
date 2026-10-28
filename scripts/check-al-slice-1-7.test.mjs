// WI-AL0.7 — the slice 1.7 gate asserts the history UI's component tests (attribution of every principal state, both restore actions, the not-recorded status, blocked rows under their last certified revision, earlier checkpoints restoring untitled entries into a new document, live updates across windows), the Rust history listing and generation broadcast, the session label's guide claim, the guide in all ten locales, and runs lint:i18n and lint:doc-joins, each failing on its own when its fact is missing
/**
 * Runs the REAL `scripts/check-al-slice.sh 1.7` against fixture trees
 * (`--root`), the pattern of `check-al-slice-1-4.test.mjs`: stub `pnpm` and
 * `cargo` first on PATH log their argv and exit 0, so the gate's discovery,
 * tier routing and assertions run for real while the test stays fast.
 *
 * One fixture satisfies every assertion; each case removes exactly one fact
 * and expects the gate red, naming that fact.
 *
 * @coordinates-with scripts/lib/al-slices.sh — al_slice_1_7, the assertions under test
 * @coordinates-with scripts/lib/al-gate.sh — al_test_has, the single-file helper
 * @module scripts/check-al-slice-1-7.test
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

const PANEL = "src/components/McpHistory/__tests__";
/** Each component test, the facts its file names. */
const COMPONENTS = {
  DocumentHistoryList: ["provider", "connection", "session", "anonymous", "unrecognized", "ambiguous",
    "restore this version", "before this change", "blocked", "origin", "lastCertified", "unavailable"],
  JournalStatusNotice: ["degraded", "read-only", "refused", "timeout", "queued"],
  EarlierCheckpoints: ["earlier checkpoints", "untitled", "new document", "clear"],
  McpHistoryButton: ["generation", "two windows"],
};
/** Each Rust test module, the facts its file names. */
const RUST = {
  controller_doc_history: ["newest", "truncated", "blocked", "last_certified", "degraded", "actor"],
  generation_events: ["generation", "broadcast", "coalesce"],
};
const CLAIMS = ["VMARK_SESSION_LABEL", "session label"];
const CLAIMS_TEST = "scripts/lib/docJoins/guideClaims.test.mjs";
const LOCALES = ["", "de/", "es/", "fr/", "it/", "ja/", "ko/", "pt-BR/", "zh-CN/", "zh-TW/"];

/** Linked tests naming `words` in CODE (a case title, a literal): the gate blanks comments. */
const header = "// WI-AL1.7 — history UI\n";
const tsTest = (words) => `${header}import { it } from "vitest";\nit(${JSON.stringify(words.join(" "))}, () => {});\n`;
const rustTest = (words) => `${header}#[test]\nfn case() { let _ = ${JSON.stringify(words.join(" "))}; }\n`;
const guide = "## Edit Checkpoints\n\nSet `VMARK_SESSION_LABEL` to choose the session label.\n";

/** A tree satisfying every slice 1.7 assertion. */
function satisfied({ components = COMPONENTS, rust = RUST, claims = CLAIMS } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "al-slice17-"));
  made.push(root);
  for (const tool of ["pnpm", "cargo"]) {
    write(root, `bin/${tool}`, STUB);
    chmodSync(path.join(root, "bin", tool), 0o755);
  }
  for (const [name, words] of Object.entries(components)) write(root, `${PANEL}/${name}.test.tsx`, tsTest(words));
  write(root, "src-tauri/src/lib.rs", "mod agent_journal;\n");
  write(root, "src-tauri/src/agent_journal/mod.rs", Object.keys(rust).map((m) => `mod ${m};\n`).join(""));
  for (const [name, words] of Object.entries(rust)) {
    write(root, `src-tauri/src/agent_journal/${name}.rs`, `#[cfg(test)]\n#[path = "${name}.test.rs"]\nmod tests;\n`);
    write(root, `src-tauri/src/agent_journal/${name}.test.rs`, rustTest(words));
  }
  write(root, CLAIMS_TEST, tsTest(claims));
  for (const l of LOCALES) write(root, `website/${l}guide/mcp-setup.md`, guide);
  return root;
}

function slice(root) {
  const log = path.join(root, "exec.log");
  const r = spawnSync("bash", [SLICE, "1.7", `--root=${root}`], {
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

describe("check-al-slice.sh 1.7", () => {
  it("passes on a satisfied tree, running the app, gates and Rust tiers and both lints", () => {
    const r = slice(satisfied());
    expect(r.status, r.out).toBe(0);
    expect(r.log).toContain(`${PANEL}/McpHistoryButton.test.tsx`);
    expect(r.log).toContain(`pnpm vitest run --config vitest.gates.config.ts ${CLAIMS_TEST}`);
    expect(r.log).toContain("agent_journal::generation_events::");
    expect(r.log).toContain("pnpm lint:i18n");
    expect(r.log).toContain("pnpm lint:doc-joins");
  });

  it.each([
    ["DocumentHistoryList", "connection", "who made each revision"],
    ["DocumentHistoryList", "session", "who made each revision"],
    ["DocumentHistoryList", "anonymous", "who made each revision"],
    ["DocumentHistoryList", "unrecognized", "who made each revision"],
    ["DocumentHistoryList", "ambiguous", "who made each revision"],
    ["DocumentHistoryList", "before this change", "both restore actions"],
    ["DocumentHistoryList", "origin", "blocked rows"],
    ["DocumentHistoryList", "lastCertified", "blocked rows"],
    ["DocumentHistoryList", "unavailable", "blocked rows"],
    ["JournalStatusNotice", "read-only", "history-not-recorded status"],
    ["JournalStatusNotice", "refused", "history-not-recorded status"],
    ["JournalStatusNotice", "timeout", "history-not-recorded status"],
    ["JournalStatusNotice", "queued", "history-not-recorded status"],
    ["EarlierCheckpoints", "new document", "untitled entries restore into a new document"],
    ["EarlierCheckpoints", "clear", "untitled entries restore into a new document"],
    ["McpHistoryButton", "two windows", "live updates across windows"],
  ])("fails when the %s test no longer names %s (%s)", (name, word, label) => {
    const r = slice(satisfied({ components: { ...COMPONENTS, [name]: without(COMPONENTS[name], word) } }));
    expect(r.status).toBe(1);
    expect(r.out).toMatch(new RegExp(`✗ [^\\n]*${label}`));
  });

  it.each([
    ["controller_doc_history", "last_certified", "history listing"],
    ["controller_doc_history", "actor", "history listing"],
    ["generation_events", "coalesce", "generation broadcast"],
  ])("fails when the %s Rust test no longer names %s (%s)", (mod, word, label) => {
    const r = slice(satisfied({ rust: { ...RUST, [mod]: without(RUST[mod], word) } }));
    expect(r.status).toBe(1);
    expect(r.out).toMatch(new RegExp(`✗ [^\\n]*${label}`));
  });

  it("fails when the guide-claims test no longer pins VMARK_SESSION_LABEL", () => {
    const r = slice(satisfied({ claims: without(CLAIMS, "VMARK_SESSION_LABEL") }));
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/✗ [^\n]*session label's guide claim/);
  });

  it.each(LOCALES.slice(1))("fails when the %s guide no longer documents VMARK_SESSION_LABEL", (locale) => {
    const root = satisfied();
    write(root, `website/${locale}guide/mcp-setup.md`, "## Edit Checkpoints\n\nNothing about labels.\n");
    const r = slice(root);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(new RegExp(`✗ [^\\n]*website/${locale}guide/mcp-setup.md`));
  });

  it("the attribution test must be a component test: a linked service test naming every fact fails", () => {
    const root = satisfied();
    const moved = "src/services/agentJournal/__tests__/DocumentHistoryList.test.tsx";
    mkdirSync(path.dirname(path.join(root, moved)), { recursive: true });
    renameSync(path.join(root, `${PANEL}/DocumentHistoryList.test.tsx`), path.join(root, moved));
    const r = slice(root);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/✗ [^\n]*who made each revision/);
  });

  it("facts split across component tests do not satisfy one assertion", () => {
    const components = {
      ...COMPONENTS,
      JournalStatusNotice: without(COMPONENTS.JournalStatusNotice, "timeout"),
      EarlierCheckpoints: [...COMPONENTS.EarlierCheckpoints, "timeout"],
    };
    const r = slice(satisfied({ components }));
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/✗ [^\n]*history-not-recorded status/);
  });
});
