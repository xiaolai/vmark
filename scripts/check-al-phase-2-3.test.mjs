// WI-AL2.0g — the phase 2 and phase 3 script-coverage pre-checks follow the split work items (2.1a, 3.1a) and still name every script together: CJK alone, emoji alone or RTL alone never satisfies a line that requires all of them, nor do words spread over two tests
// Also under WI-AL0.7: the phase gate self-tests.
/**
 * Runs the REAL `scripts/check-al-phase.sh <2|3> --no-exec` against fixture
 * trees (`--root`). Phases 2 and 3 are red on a bare fixture (most of their
 * Definition of Done is missing), so each case reads only the one assertion
 * line it is about. Words sit in test TITLES: the helpers read test code,
 * and a comment proves nothing (scripts/check-al-gate-helpers.test.mjs).
 *
 * @coordinates-with scripts/check-al-phase.sh — phase_2 and phase_3, the lines under test
 * @coordinates-with scripts/lib/al-gate.sh — al_test_has, the single-file helper
 * @module scripts/check-al-phase-2-3.test
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const PHASE = path.join(REPO, "scripts", "check-al-phase.sh");
const made = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A tree with one linked test per entry of `files`: each entry is the words its test title names. */
function fixture(wi, files) {
  const root = mkdtempSync(path.join(tmpdir(), "al-phase23-"));
  made.push(root);
  files.forEach((words, i) => {
    const rel = `src/fixture/scripts${i}.test.ts`;
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), `// ${wi} — fixture\nimport { it } from "vitest";\nit(${JSON.stringify(words.join(" "))}, () => {});\n`);
  });
  return root;
}

function run(phase, root) {
  const r = spawnSync("bash", [PHASE, String(phase), `--root=${root}`, "--no-exec"], {
    encoding: "utf8",
    cwd: REPO,
    timeout: 120_000,
    killSignal: "SIGKILL",
  });
  if (r.error) throw r.error;
  return `${r.stdout}${r.stderr}`;
}

const line = (out, label) => out.split("\n").find((l) => l.includes(label)) ?? "";

const CASES = [
  { phase: 2, wi: "WI-AL2.1a", label: "WI-AL2.1a: CJK and emoji fixtures", words: ["CJK", "emoji"] },
  { phase: 3, wi: "WI-AL3.1a", label: "WI-AL3.1a: CJK, emoji and RTL offsets exact", words: ["CJK", "emoji", "RTL"] },
];

describe("check-al-phase.sh 2 and 3 — every named script, in one test", () => {
  it.each(CASES)("phase $phase passes when one test names all of $words", ({ phase, wi, label, words }) => {
    const out = run(phase, fixture(wi, [words]));
    expect(line(out, label), out).toMatch(/^\s*✓/);
  });

  it.each(CASES.flatMap((c) => c.words.map((w) => ({ ...c, only: w }))))(
    "phase $phase fails when the only test names just $only",
    ({ phase, wi, label, only }) => {
      const out = run(phase, fixture(wi, [[only]]));
      expect(line(out, label), out).toMatch(/^\s*✗/);
    },
  );

  it.each(CASES)("phase $phase fails when $words are spread over separate tests", ({ phase, wi, label, words }) => {
    const out = run(phase, fixture(wi, words.map((w) => [w])));
    expect(line(out, label), out).toMatch(/^\s*✗/);
  });
});

describe("check-al-phase.sh 3 — each comment operation has a schema in code", () => {
  const SCHEMAS = "server/mcp/src/bridge/operationSchemas.ts";
  const OPS = ["comments.list", "comments.reply", "comments.mark_addressed"];
  const schemaTree = (body) => {
    const root = fixture("WI-AL3.3", []);
    mkdirSync(path.join(root, path.dirname(SCHEMAS)), { recursive: true });
    writeFileSync(path.join(root, SCHEMAS), body);
    return root;
  };

  it.each(OPS)("%s declared as a literal in the schema module passes", (op) => {
    const out = run(3, schemaTree(`export const OPS = [${OPS.map((o) => JSON.stringify(o)).join(", ")}];\n`));
    expect(line(out, `WI-AL3.3: ${op} schema`), out).toMatch(/^\s*✓/);
  });

  it.each(OPS)("%s named only in a comment of the schema module fails", (op) => {
    const out = run(3, schemaTree(`// ${OPS.join(" ")}\nexport const OPS = [];\n`));
    expect(line(out, `WI-AL3.3: ${op} schema`), out).toMatch(/^\s*✗/);
  });

  it("a dot in the operation name is literal: comments_list does not stand in for comments.list", () => {
    const out = run(3, schemaTree('export const OPS = ["comments_list"];\n'));
    expect(line(out, "WI-AL3.3: comments.list schema"), out).toMatch(/^\s*✗/);
  });
});

describe("check-al-phase.sh 3 — addresses on each write-tool schema", () => {
  const SCHEMAS = "server/mcp/src/bridge/operationSchemas.ts";
  const WRITES = ["document.write", "document.transform", "workflow.apply_patch", "selection.set"];
  const tree = (body) => {
    const root = fixture("WI-AL3.3", []);
    mkdirSync(path.join(root, path.dirname(SCHEMAS)), { recursive: true });
    writeFileSync(path.join(root, SCHEMAS), body);
    return root;
  };
  const schemas = (without) =>
    `const addresses = z.array(z.string()).optional();\nexport const S = {\n${WRITES.map(
      (op) => `  'vmark.${op}': z.object({\n    content: z.string(),\n${op === without ? "" : "    addresses,\n"}  }),\n`,
    ).join("")}  'vmark.workflow.validate': z.object({ addresses }),\n};\n`;

  it.each(WRITES)("%s with addresses in its object passes", (op) => {
    const out = run(3, tree(schemas(null)));
    expect(line(out, `WI-AL3.3: addresses on the ${op} schema`), out).toMatch(/^\s*✓/);
  });

  it.each(WRITES)("%s without addresses fails, though other schemas carry it", (op) => {
    const out = run(3, tree(schemas(op)));
    expect(line(out, `WI-AL3.3: addresses on the ${op} schema`), out).toMatch(/^\s*✗/);
  });
});
