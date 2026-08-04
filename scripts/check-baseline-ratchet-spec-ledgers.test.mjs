/**
 * WI-0.3 — the markdown spec tier's ratchet entries: ledger-record identity,
 * corpus no-remove coverage, and the TS-ledger source comparators.
 *
 * Same discipline as check-baseline-ratchet.test.mjs: the REAL script runs as
 * a subprocess against scratch git repositories, and failure cases assert on
 * the MESSAGE, not only the exit code.
 */
import { describe, it, expect } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO, "scripts", "check-baseline-ratchet.mjs");

function writeFiles(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, typeof content === "string" ? content : JSON.stringify(content, null, 2));
  }
}

function scratchRepo(baseFiles) {
  const dir = mkdtempSync(path.join(tmpdir(), "baseline-ratchet-spec-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-b", "main");
  git("config", "user.email", "gate@example.test");
  git("config", "user.name", "Gate Fixture");
  git("config", "commit.gpgsign", "false");
  writeFiles(dir, baseFiles);
  git("add", "-A");
  git("commit", "-m", "base");
  return dir;
}

function mutate(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    if (content === null) rmSync(path.join(dir, rel), { force: true });
    else writeFiles(dir, { [rel]: content });
  }
}

function run(dir, entries) {
  const manifestPath = path.join(dir, "ratchet-manifest.json");
  writeFileSync(manifestPath, JSON.stringify({ entries, allowRaise: [] }, null, 2));
  const res = spawnSync(process.execPath, [SCRIPT, "main", "--root", dir, "--manifest", manifestPath], {
    encoding: "utf8",
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

const record = (over = {}) => ({
  exampleId: "cm-1",
  path: "root.children[0]",
  kind: "type",
  detail: "a vs b",
  vmarkValue: "a",
  referenceValue: "b",
  verdict: "extension",
  reason: "a stated reason long enough to satisfy the ledger's own checks",
  ...over,
});

describe("spec ledger records (identity, additions report)", () => {
  const LEDGER = "ledgers/specDeltas.json";
  const entry = {
    path: LEDGER,
    checks: [{ mode: "custom", comparator: "specConformanceRecords", onAdd: "report" }],
  };

  it("reports an added record and passes", () => {
    const dir = scratchRepo({ [LEDGER]: { deltas: [record()] } });
    mutate(dir, { [LEDGER]: { deltas: [record(), record({ exampleId: "cm-2" })] } });
    const { status, stdout } = run(dir, [entry]);
    expect(status).toBe(0);
    expect(stdout).toContain("cm-2");
  });

  it("passes a removal silently (tightening)", () => {
    const dir = scratchRepo({ [LEDGER]: { deltas: [record(), record({ exampleId: "cm-2" })] } });
    mutate(dir, { [LEDGER]: { deltas: [record()] } });
    expect(run(dir, [entry]).status).toBe(0);
  });

  it("a same-record VALUE rewrite changes the identity (reported as an addition)", () => {
    // Field-name-only identities let a commit rewrite vmarkValue/referenceValue
    // invisibly; values are now part of the identity tuple.
    const dir = scratchRepo({ [LEDGER]: { deltas: [record()] } });
    mutate(dir, { [LEDGER]: { deltas: [record({ vmarkValue: "REWRITTEN" })] } });
    const { status, stdout } = run(dir, [entry]);
    expect(status).toBe(0);
    expect(stdout).toContain("REWRITTEN");
  });

  it("fails closed on a record missing its identity fields", () => {
    const dir = scratchRepo({ [LEDGER]: { deltas: [record()] } });
    mutate(dir, { [LEDGER]: { deltas: [{ exampleId: "cm-9" }] } });
    const { status, stderr } = run(dir, [entry]);
    expect(status).toBe(1);
    expect(stderr).toContain("missing string field");
  });

  it("extracts BOTH stability and fidelity records from the roundtrip ledger", () => {
    const RT = "ledgers/specRoundtripDeltas.json";
    const rtEntry = {
      path: RT,
      checks: [{ mode: "custom", comparator: "specRoundtripRecords", onAdd: "report" }],
    };
    const base = {
      stability: [{ exampleId: "cm-43", pass1Sha256: "aa", pass2Sha256: "bb", reason: "long enough reason text here" }],
      fidelity: [record()],
    };
    const dir = scratchRepo({ [RT]: base });
    mutate(dir, {
      [RT]: {
        ...base,
        stability: [...base.stability, { exampleId: "cm-47", pass1Sha256: "cc", pass2Sha256: "dd", reason: "another stated reason, long enough" }],
      },
    });
    const { status, stdout } = run(dir, [rtEntry]);
    expect(status).toBe(0);
    expect(stdout).toContain('\"stability\",\"cm-47\"');
  });
});

describe("vendored corpora (no-remove: coverage only grows)", () => {
  const CORPUS = "corpus/commonmark.json";
  const entry = {
    path: CORPUS,
    checks: [
      { mode: "custom", comparator: "specCorpusExamples", direction: "no-remove", onAdd: "report" },
    ],
  };
  const corpus = (examples) => ({ source: "s", revision: "r", license: "l", examples });
  const ex = (n, markdown) => ({ example: n, section: "S", markdown, html: "" });

  it("fails when an example is REMOVED, naming it", () => {
    const dir = scratchRepo({ [CORPUS]: corpus([ex(1, "*a*\n"), ex(2, "# b\n")]) });
    mutate(dir, { [CORPUS]: corpus([ex(1, "*a*\n")]) });
    const { status, stderr } = run(dir, [entry]);
    expect(status).toBe(1);
    expect(stderr).toContain("removed or changed");
    expect(stderr).toContain("- 2 |");
  });

  it("fails when an example's markdown is silently EDITED (content-addressed identity)", () => {
    const dir = scratchRepo({ [CORPUS]: corpus([ex(1, "*a*\n")]) });
    mutate(dir, { [CORPUS]: corpus([ex(1, "*a mutated*\n")]) });
    const { status, stderr } = run(dir, [entry]);
    expect(status).toBe(1);
    expect(stderr).toContain("removed or changed");
  });

  it("passes and reports a pure addition", () => {
    const dir = scratchRepo({ [CORPUS]: corpus([ex(1, "*a*\n")]) });
    mutate(dir, { [CORPUS]: corpus([ex(1, "*a*\n"), ex(2, "new\n")]) });
    const { status, stdout } = run(dir, [entry]);
    expect(status).toBe(0);
    expect(stdout).toContain("new entr");
  });
});

describe("TS ledger comparators (source text at both refs)", () => {
  const ED = "src/conformance/expectedDeltas.ts";
  const edEntry = {
    path: ED,
    format: "text",
    checks: [{ mode: "custom", comparator: "tsExpectedDeltas", onAdd: "report" }],
  };
  const edSource = (entries) =>
    `export const EXPECTED_DELTAS: readonly ExpectedDelta[] = [\n${entries}\n] as const;\n`;
  const edEntryText = (id) =>
    `  { fixtureId: "${id}", path: "root", kind: "type", detail: "a vs b",\n` +
    `    documentValue: "a", sourcePositionValue: "b", reason: "why (with, commas)" },`;

  it("reports an added expectedDeltas entry", () => {
    const dir = scratchRepo({ [ED]: edSource(edEntryText("cm-x")) });
    mutate(dir, { [ED]: edSource(`${edEntryText("cm-x")}\n${edEntryText("cm-y")}`) });
    const { status, stdout } = run(dir, [edEntry]);
    expect(status).toBe(0);
    expect(stdout).toContain("cm-y");
  });

  it("fails closed when the declaration is missing", () => {
    const dir = scratchRepo({ [ED]: edSource(edEntryText("cm-x")) });
    mutate(dir, { [ED]: "export const SOMETHING_ELSE = [];\n" });
    const { status, stderr } = run(dir, [edEntry]);
    expect(status).toBe(1);
    expect(stderr).toContain("EXPECTED_DELTAS");
  });

  it("a COMMENTED-OUT declaration is not mistaken for the real one", () => {
    // `indexOf` once matched `// const EXPECTED_DELTAS = []` in a comment,
    // returned an empty identity set, and — since removals pass — silently
    // disabled the ratchet.
    const decoy = "// const EXPECTED_DELTAS = [] — see below\n";
    const dir = scratchRepo({ [ED]: decoy + edSource(edEntryText("cm-x")) });
    mutate(dir, { [ED]: decoy + edSource(`${edEntryText("cm-x")}\n${edEntryText("cm-z")}`) });
    const { status, stdout } = run(dir, [edEntry]);
    expect(status).toBe(0);
    expect(stdout).toContain("cm-z"); // parsed the REAL declaration, saw the addition
  });

  it("a file containing ONLY the commented decoy fails closed", () => {
    const dir = scratchRepo({ [ED]: edSource(edEntryText("cm-x")) });
    mutate(dir, { [ED]: "// const EXPECTED_DELTAS = []\nexport const OTHER = 1;\n" });
    const { status, stderr } = run(dir, [edEntry]);
    expect(status).toBe(1);
    expect(stderr).toContain("EXPECTED_DELTAS");
  });

  it("reads the record-of-arrays fidelity ledger as document|rule identities", () => {
    const FL = "src/fidelity/fidelityLedger.ts";
    const flEntry = {
      path: FL,
      format: "text",
      checks: [{ mode: "custom", comparator: "tsFidelityLedger", onAdd: "report" }],
    };
    const flSource = (body) =>
      `export const FIDELITY_LEDGER: Record<string, LedgerEntry[]> = {\n${body}\n};\n`;
    const doc = (file, rules) =>
      `  "${file}": [\n${rules.map((r) => `    { rule: "${r}", reason: "stated, with {braces} and, commas" },`).join("\n")}\n  ],`;
    const dir = scratchRepo({ [FL]: flSource(doc("a.md", ["ruleOne"])) });
    mutate(dir, { [FL]: flSource(`${doc("a.md", ["ruleOne"])}\n${doc("b.md", ["ruleTwo"])}`) });
    const { status, stdout } = run(dir, [flEntry]);
    expect(status).toBe(0);
    expect(stdout).toContain('\"b.md\",\"ruleTwo\"');
  });
});

describe("the shipped spec-tier entries point at real files with parseable shapes", () => {
  it("every spec-tier manifest path exists and its comparator accepts the real file", async () => {
    const { MANIFEST } = await import("./baselineRatchetManifest.mjs");
    const modes = await import("./baselineRatchetSpecLedgers.mjs");
    const { readFileSync } = await import("node:fs");
    const specEntries = MANIFEST.entries.filter((e) =>
      e.path.includes("markdownPipeline"),
    );
    // 2 ledgers + 2 TS ledgers + 11 corpus files (WI-0.3 base + WI-2.x).
    expect(specEntries.length).toBe(15);
    for (const entry of specEntries) {
      const raw = readFileSync(path.join(REPO, entry.path), "utf8");
      for (const check of entry.checks) {
        const comparator = modes[check.comparator];
        expect(comparator, check.comparator).toBeTypeOf("function");
        const doc = entry.format === "text" ? raw : JSON.parse(raw);
        expect(comparator(doc, entry.path).size).toBeGreaterThan(0);
      }
    }
  });
});
