/**
 * WI-16 — Manifest-driven baseline ratchet over every committed baseline (D2).
 *
 * Tests run the REAL script as a subprocess against scratch git repositories in
 * tmpdir — init, commit a base revision, mutate the working tree, compare. No
 * mocking: the gate that exists because self-attestation is unverifiable must
 * not itself be proven by a stub.
 *
 * Every failure case asserts on the MESSAGE, not just the exit code, so a
 * script that crashed on startup (also exit 1) cannot fake a pass.
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

/** Scratch repo whose single commit ("base") holds `baseFiles`. */
function scratchRepo(baseFiles) {
  const dir = mkdtempSync(path.join(tmpdir(), "baseline-ratchet-"));
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

/** Apply working-tree changes on top of the base commit. `null` deletes. */
function mutate(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    if (content === null) rmSync(path.join(dir, rel), { force: true });
    else writeFiles(dir, { [rel]: content });
  }
}

function run(dir, manifest, { baseRef = "main" } = {}) {
  const manifestPath = path.join(dir, "ratchet-manifest.json");
  writeFileSync(
    manifestPath,
    typeof manifest === "string" ? manifest : JSON.stringify(manifest, null, 2),
  );
  const res = spawnSync(
    process.execPath,
    [SCRIPT, baseRef, "--root", dir, "--manifest", manifestPath],
    { encoding: "utf8" },
  );
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

const manifestOf = (entries, allowRaise = []) => ({ entries, allowRaise });

// ─── per-key-count ───

describe("per-key-count mode", () => {
  const entry = {
    path: "scripts/demo-baseline.json",
    checks: [{ mode: "per-key-count", at: "files" }],
  };

  it("fails a raised count, naming the file and the key", () => {
    const dir = scratchRepo({ "scripts/demo-baseline.json": { files: { "a.ts": 400, "b.ts": 500 } } });
    mutate(dir, { "scripts/demo-baseline.json": { files: { "a.ts": 450, "b.ts": 500 } } });
    const { status, stderr } = run(dir, manifestOf([entry]));
    expect(status).toBe(1);
    expect(stderr).toContain("scripts/demo-baseline.json");
    expect(stderr).toContain("files.a.ts");
    expect(stderr).toContain("400");
    expect(stderr).toContain("450");
  });

  it("passes a lowered count", () => {
    const dir = scratchRepo({ "scripts/demo-baseline.json": { files: { "a.ts": 400 } } });
    mutate(dir, { "scripts/demo-baseline.json": { files: { "a.ts": 320 } } });
    expect(run(dir, manifestOf([entry])).status).toBe(0);
  });

  it("passes an unchanged count and a removed key", () => {
    const dir = scratchRepo({ "scripts/demo-baseline.json": { files: { "a.ts": 400, "b.ts": 500 } } });
    mutate(dir, { "scripts/demo-baseline.json": { files: { "a.ts": 400 } } });
    expect(run(dir, manifestOf([entry])).status).toBe(0);
  });

  it("allows a new key but reports it loudly", () => {
    const dir = scratchRepo({ "scripts/demo-baseline.json": { files: { "a.ts": 400 } } });
    mutate(dir, { "scripts/demo-baseline.json": { files: { "a.ts": 400, "new.ts": 320 } } });
    const { status, stdout } = run(dir, manifestOf([entry]));
    expect(status).toBe(0);
    expect(stdout).toContain("new.ts");
  });

  it("flattens nested count maps so a per-channel raise is caught", () => {
    // The plugin-store-coupling shape: unit → channel → count.
    const nested = {
      path: "scripts/coupling-baseline.json",
      checks: [{ mode: "per-key-count", at: "units" }],
    };
    const dir = scratchRepo({
      "scripts/coupling-baseline.json": { units: { codemirror: { services: 6, components: 1 } } },
    });
    mutate(dir, {
      "scripts/coupling-baseline.json": { units: { codemirror: { services: 9, components: 1 } } },
    });
    const { status, stderr } = run(dir, manifestOf([nested]));
    expect(status).toBe(1);
    expect(stderr).toContain("units.codemirror.services");
  });

  it("ignores comment keys instead of choking on their string values", () => {
    const dir = scratchRepo({
      "scripts/demo-baseline.json": { "//": "prose", files: { "_comment": "why", "a.ts": 400 } },
    });
    mutate(dir, {
      "scripts/demo-baseline.json": { "//": "different prose", files: { "_comment": "why", "a.ts": 400 } },
    });
    expect(run(dir, manifestOf([entry])).status).toBe(0);
  });
});

// ─── scalar ───

describe("scalar mode", () => {
  const entry = {
    path: "scripts/demo-baseline.json",
    checks: [{ mode: "scalar", at: "maxThings" }],
  };
  const at = (n) => ({ "scripts/demo-baseline.json": { maxThings: n } });

  it.each([
    ["raised", 7, 9, 1],
    ["equal", 7, 7, 0],
    ["lowered", 7, 4, 0],
  ])("%s: %i → %i exits %i", (_label, base, head, expected) => {
    const dir = scratchRepo(at(base));
    mutate(dir, at(head));
    const { status, stderr } = run(dir, manifestOf([entry]));
    expect(status).toBe(expected);
    if (expected === 1) {
      expect(stderr).toContain("maxThings");
      expect(stderr).toContain("scripts/demo-baseline.json");
    }
  });
});

// ─── identity ───

describe("identity mode", () => {
  const strings = {
    path: "scripts/surfaces-baseline.json",
    checks: [{ mode: "identity", at: "surfaces", shape: "strings", onAdd: "fail" }],
  };

  it("fails a like-for-like swap at constant count, naming the added entry", () => {
    const dir = scratchRepo({ "scripts/surfaces-baseline.json": { surfaces: ["Alpha", "Beta"] } });
    mutate(dir, { "scripts/surfaces-baseline.json": { surfaces: ["Alpha", "Gamma"] } });
    const { status, stderr } = run(dir, manifestOf([strings]));
    expect(status).toBe(1);
    expect(stderr).toContain("Gamma");
  });

  it("passes a pure removal", () => {
    const dir = scratchRepo({ "scripts/surfaces-baseline.json": { surfaces: ["Alpha", "Beta"] } });
    mutate(dir, { "scripts/surfaces-baseline.json": { surfaces: ["Alpha"] } });
    expect(run(dir, manifestOf([strings])).status).toBe(0);
  });

  it("keys array-of-object entries on their composite identity", () => {
    const objects = {
      path: "scripts/mocks-baseline.json",
      checks: [
        { mode: "identity", at: "entries", shape: "objects", key: ["file", "target"], onAdd: "fail" },
      ],
    };
    const base = { entries: [{ file: "a.test.ts", target: "src/stores/x" }] };
    const dir = scratchRepo({ "scripts/mocks-baseline.json": base });
    mutate(dir, {
      "scripts/mocks-baseline.json": { entries: [{ file: "a.test.ts", target: "src/stores/y" }] },
    });
    const { status, stderr } = run(dir, manifestOf([objects]));
    expect(status).toBe(1);
    expect(stderr).toContain("src/stores/y");
  });

  it("reads a dotted identity field from nested objects", () => {
    const edges = {
      path: ".dependency-cruiser-known-violations.json",
      checks: [
        {
          mode: "identity",
          at: "",
          shape: "objects",
          key: ["from", "to", "rule.name"],
          onAdd: "report",
        },
      ],
    };
    const one = { from: "a.ts", to: "b.ts", rule: { name: "plugin-isolation" } };
    const dir = scratchRepo({ ".dependency-cruiser-known-violations.json": [one] });
    mutate(dir, {
      ".dependency-cruiser-known-violations.json": [
        one,
        { from: "c.ts", to: "d.ts", rule: { name: "plugin-isolation" } },
      ],
    });
    const { status, stdout } = run(dir, manifestOf([edges]));
    expect(status).toBe(0);
    expect(stdout).toContain("c.ts");
    expect(stdout).toContain("plugin-isolation");
  });

  it("takes the identity of an object-keyed allowlist from its keys, skipping comments", () => {
    const keyed = {
      path: "scripts/merge-drop-allowlist.json",
      checks: [{ mode: "identity", at: "", shape: "object-keys", onAdd: "report" }],
    };
    const dir = scratchRepo({
      "scripts/merge-drop-allowlist.json": { _comment: "prose", "src/a.ts": "relocated to b" },
    });
    mutate(dir, {
      "scripts/merge-drop-allowlist.json": {
        _comment: "changed prose",
        "src/a.ts": "relocated to b",
        "src/c.ts": "relocated to d",
      },
    });
    const { status, stdout } = run(dir, manifestOf([keyed]));
    expect(status).toBe(0);
    expect(stdout).toContain("src/c.ts");
    expect(stdout).not.toContain("_comment");
  });
});

// ─── manifest ↔ disk staleness (both directions) ───

describe("two-way manifest staleness", () => {
  it("fails when a baseline-looking file on disk is not in the manifest", () => {
    const dir = scratchRepo({ "scripts/demo-baseline.json": { files: {} } });
    mutate(dir, { "scripts/rogue-baseline.json": { files: { "a.ts": 400 } } });
    const { status, stderr } = run(
      dir,
      manifestOf([{ path: "scripts/demo-baseline.json", checks: [{ mode: "per-key-count", at: "files" }] }]),
    );
    expect(status).toBe(1);
    expect(stderr).toContain("scripts/rogue-baseline.json");
    expect(stderr).toMatch(/manifest/i);
  });

  it.each([
    ["allowlist", "scripts/rogue-allowlist.json"],
    ["budget", "scripts/rogue-budget.json"],
    ["TypeScript allowlist", "scripts/rogueAllowlist.ts"],
    ["root known-violations", ".rogue-known-violations.json"],
  ])("discovers an unregistered %s file", (_label, rel) => {
    const dir = scratchRepo({ "scripts/demo-baseline.json": { files: {} } });
    mutate(dir, { [rel]: rel.endsWith(".ts") ? "export const X = [];\n" : { a: 1 } });
    const { status, stderr } = run(
      dir,
      manifestOf([{ path: "scripts/demo-baseline.json", checks: [{ mode: "per-key-count", at: "files" }] }]),
    );
    expect(status).toBe(1);
    expect(stderr).toContain(rel);
  });

  it("does not flag test files or nested helper directories as baselines", () => {
    const dir = scratchRepo({ "scripts/demo-baseline.json": { files: {} } });
    mutate(dir, {
      "scripts/check-thing-baseline.test.mjs": "// a test, not a baseline\n",
      "scripts/__tests__/fixtureAllowlist.ts": "export const X = [];\n",
    });
    const { status } = run(
      dir,
      manifestOf([{ path: "scripts/demo-baseline.json", checks: [{ mode: "per-key-count", at: "files" }] }]),
    );
    expect(status).toBe(0);
  });

  it("fails when a manifest entry names a file that does not exist", () => {
    const dir = scratchRepo({ "scripts/demo-baseline.json": { files: {} } });
    const { status, stderr } = run(
      dir,
      manifestOf([
        { path: "scripts/demo-baseline.json", checks: [{ mode: "per-key-count", at: "files" }] },
        { path: "scripts/deleted-baseline.json", checks: [{ mode: "scalar", at: "n" }] },
      ]),
    );
    expect(status).toBe(1);
    expect(stderr).toContain("scripts/deleted-baseline.json");
  });

  it("passes when a baseline was deleted from both the tree and the manifest", () => {
    const dir = scratchRepo({
      "scripts/demo-baseline.json": { files: {} },
      "scripts/gone-baseline.json": { n: 3 },
    });
    mutate(dir, { "scripts/gone-baseline.json": null });
    const { status } = run(
      dir,
      manifestOf([{ path: "scripts/demo-baseline.json", checks: [{ mode: "per-key-count", at: "files" }] }]),
    );
    expect(status).toBe(0);
  });
});

// ─── fail-closed paths ───

describe("fails closed", () => {
  const entry = { path: "scripts/demo-baseline.json", checks: [{ mode: "scalar", at: "n" }] };

  it("exits 1 on malformed JSON in the working tree", () => {
    const dir = scratchRepo({ "scripts/demo-baseline.json": { n: 3 } });
    mutate(dir, { "scripts/demo-baseline.json": "{ not json" });
    const { status, stderr } = run(dir, manifestOf([entry]));
    expect(status).toBe(1);
    expect(stderr).toContain("scripts/demo-baseline.json");
    expect(stderr).toMatch(/pars|json/i);
  });

  it("exits 1 on malformed JSON at the merge base", () => {
    const dir = scratchRepo({ "scripts/demo-baseline.json": "{ not json" });
    mutate(dir, { "scripts/demo-baseline.json": { n: 3 } });
    const { status, stderr } = run(dir, manifestOf([entry]));
    expect(status).toBe(1);
    expect(stderr).toMatch(/pars|json/i);
  });

  it("exits 1 with an explanatory message when the base ref cannot be resolved", () => {
    const dir = scratchRepo({ "scripts/demo-baseline.json": { n: 3 } });
    const { status, stderr } = run(dir, manifestOf([entry]), { baseRef: "origin/does-not-exist" });
    expect(status).toBe(1);
    expect(stderr).toContain("origin/does-not-exist");
    expect(stderr).toMatch(/history|fetch|merge-base/i);
    expect(stderr).not.toMatch(/skip/i);
  });

  it("exits 1 on an unknown comparison mode rather than skipping the file", () => {
    const dir = scratchRepo({ "scripts/demo-baseline.json": { n: 3 } });
    const { status, stderr } = run(
      dir,
      manifestOf([{ path: "scripts/demo-baseline.json", checks: [{ mode: "vibes", at: "n" }] }]),
    );
    expect(status).toBe(1);
    expect(stderr).toContain("vibes");
  });

  it("exits 1 when the head file lost a section the manifest still checks", () => {
    const dir = scratchRepo({ "scripts/demo-baseline.json": { files: { "a.ts": 400 } } });
    mutate(dir, { "scripts/demo-baseline.json": { other: {} } });
    const { status, stderr } = run(
      dir,
      manifestOf([{ path: "scripts/demo-baseline.json", checks: [{ mode: "per-key-count", at: "files" }] }]),
    );
    expect(status).toBe(1);
    expect(stderr).toContain("files");
  });
});

// ─── lifecycle: new files, shape changes, empty baselines ───

describe("lifecycle", () => {
  it("allows a baseline added since the base commit, reporting it as new reality", () => {
    const dir = scratchRepo({ "scripts/demo-baseline.json": { files: {} } });
    mutate(dir, { "scripts/fresh-baseline.json": { files: { "a.ts": 900 } } });
    const { status, stdout } = run(
      dir,
      manifestOf([
        { path: "scripts/demo-baseline.json", checks: [{ mode: "per-key-count", at: "files" }] },
        { path: "scripts/fresh-baseline.json", checks: [{ mode: "per-key-count", at: "files" }] },
      ]),
    );
    expect(status).toBe(0);
    expect(stdout).toContain("scripts/fresh-baseline.json");
  });

  it("reports a shape change loudly when the checked path did not exist at base", () => {
    const dir = scratchRepo({ "scripts/surfaces-baseline.json": { maxSurfaces: 14 } });
    mutate(dir, { "scripts/surfaces-baseline.json": { surfaces: ["Alpha", "Beta"] } });
    const { status, stdout } = run(
      dir,
      manifestOf([
        {
          path: "scripts/surfaces-baseline.json",
          checks: [{ mode: "identity", at: "surfaces", shape: "strings", onAdd: "fail" }],
        },
      ]),
    );
    expect(status).toBe(0);
    expect(stdout).toMatch(/shape/i);
    expect(stdout).toContain("surfaces");
  });

  it("passes an empty baseline that is still empty", () => {
    const dir = scratchRepo({ "scripts/demo-baseline.json": { entries: [] } });
    const { status } = run(
      dir,
      manifestOf([
        {
          path: "scripts/demo-baseline.json",
          checks: [{ mode: "identity", at: "entries", shape: "strings", onAdd: "fail" }],
        },
      ]),
    );
    expect(status).toBe(0);
  });
});

// ─── allowRaise: the one-shot, self-cleaning re-measurement exemption ───

describe("allowRaise", () => {
  const entry = { path: "scripts/demo-baseline.json", checks: [{ mode: "scalar", at: "maxThings" }] };
  const reason = "re-measurement: plugin-wide licenses retired, same debt frozen per-edge";

  it("permits exactly the declared raise, reporting it", () => {
    const dir = scratchRepo({ "scripts/demo-baseline.json": { maxThings: 7 } });
    mutate(dir, { "scripts/demo-baseline.json": { maxThings: 75 } });
    const { status, stdout } = run(
      dir,
      manifestOf([entry], [
        { path: "scripts/demo-baseline.json", key: "maxThings", from: 7, to: 75, reason },
      ]),
    );
    expect(status).toBe(0);
    expect(stdout).toContain("maxThings");
    expect(stdout).toContain(reason);
  });

  it("still fails a raise beyond the declared ceiling", () => {
    const dir = scratchRepo({ "scripts/demo-baseline.json": { maxThings: 7 } });
    mutate(dir, { "scripts/demo-baseline.json": { maxThings: 90 } });
    const { status, stderr } = run(
      dir,
      manifestOf([entry], [
        { path: "scripts/demo-baseline.json", key: "maxThings", from: 7, to: 75, reason },
      ]),
    );
    expect(status).toBe(1);
    expect(stderr).toContain("90");
  });

  it("fails as stale once the base moved past it, demanding deletion", () => {
    // Base already carries the raised value: the exemption did its one job.
    const dir = scratchRepo({ "scripts/demo-baseline.json": { maxThings: 75 } });
    const { status, stderr } = run(
      dir,
      manifestOf([entry], [
        { path: "scripts/demo-baseline.json", key: "maxThings", from: 7, to: 75, reason },
      ]),
    );
    expect(status).toBe(1);
    expect(stderr).toMatch(/stale/i);
    expect(stderr).toContain("maxThings");
  });

  it("requires a reason", () => {
    const dir = scratchRepo({ "scripts/demo-baseline.json": { maxThings: 7 } });
    mutate(dir, { "scripts/demo-baseline.json": { maxThings: 75 } });
    const { status, stderr } = run(
      dir,
      manifestOf([entry], [{ path: "scripts/demo-baseline.json", key: "maxThings", from: 7, to: 75 }]),
    );
    expect(status).toBe(1);
    expect(stderr).toMatch(/reason/i);
  });
});

// ─── custom: the TypeScript allowlist ───

describe("custom comparator: i18n identical allowlist (TypeScript source)", () => {
  const entry = {
    path: "scripts/i18nIdenticalAllowlist.ts",
    format: "text",
    checks: [{ mode: "custom", comparator: "tsIdenticalAllowlist", onAdd: "report" }],
  };

  const source = (entries) => `
export interface IdenticalException {
  kind: "json" | "yaml";
  ns: string;
  key: string;
  locales: string[];
  reason: string;
}
export const IDENTICAL_ALLOWLIST: IdenticalException[] = [
${entries
  .map(
    ([ns, key]) => `  {
    kind: "json",
    ns: "${ns}",
    key: "${key}",
    locales: ALL_LOCALES,
    reason: "untranslatable literal",
  },`,
  )
  .join("\n")}
];
`;

  it("reports an added exemption by namespace and key, ignoring the interface declaration", () => {
    const dir = scratchRepo({
      "scripts/i18nIdenticalAllowlist.ts": source([["settings.json", "formats.externalEditor.placeholder"]]),
    });
    mutate(dir, {
      "scripts/i18nIdenticalAllowlist.ts": source([
        ["settings.json", "formats.externalEditor.placeholder"],
        ["common.json", "ci.runnerLabels"],
      ]),
    });
    const { status, stdout } = run(dir, manifestOf([entry]));
    expect(status).toBe(0);
    expect(stdout).toContain("common.json");
    expect(stdout).toContain("ci.runnerLabels");
    // The `key: string;` interface field must not be read as an exemption.
    expect(stdout).not.toContain("kind: string");
  });

  it("passes when an exemption is deleted", () => {
    const dir = scratchRepo({
      "scripts/i18nIdenticalAllowlist.ts": source([
        ["settings.json", "a.b"],
        ["common.json", "c.d"],
      ]),
    });
    mutate(dir, { "scripts/i18nIdenticalAllowlist.ts": source([["settings.json", "a.b"]]) });
    expect(run(dir, manifestOf([entry])).status).toBe(0);
  });

  it("fails an added exemption when the manifest marks the list append-forbidden", () => {
    const strict = { ...entry, checks: [{ ...entry.checks[0], onAdd: "fail" }] };
    const dir = scratchRepo({ "scripts/i18nIdenticalAllowlist.ts": source([["settings.json", "a.b"]]) });
    mutate(dir, {
      "scripts/i18nIdenticalAllowlist.ts": source([
        ["settings.json", "a.b"],
        ["common.json", "c.d"],
      ]),
    });
    const { status, stderr } = run(dir, manifestOf([strict]));
    expect(status).toBe(1);
    expect(stderr).toContain("c.d");
  });

  // ── Evasions the `ns: "…" … key: "…"` regex admitted ──
  // It recorded only DOUBLE-quoted ns-then-key pairs, so an exemption written
  // any other way was simply not in the identity set — added invisibly. And
  // because it matched lazily ACROSS entries, one malformed entry could pair
  // its `ns` with the NEXT entry's `key`.
  const strictEntry = {
    path: "scripts/i18nIdenticalAllowlist.ts",
    format: "text",
    checks: [{ mode: "custom", comparator: "tsIdenticalAllowlist", onAdd: "fail" }],
  };

  /** A source with fully hand-written entries, so quote style and field order
   *  can be varied per entry. */
  const rawSource = (entries) =>
    `const ALL_LOCALES = ["de", "es"];\nexport const IDENTICAL_ALLOWLIST: IdenticalException[] = [\n${entries.join(
      "\n",
    )}\n];\n`;

  const dq = (ns, key) =>
    `  { kind: "json", ns: "${ns}", key: "${key}", locales: ALL_LOCALES, reason: "x" },`;

  it("sees an exemption added with SINGLE quotes", () => {
    const dir = scratchRepo({ "scripts/i18nIdenticalAllowlist.ts": rawSource([dq("a.json", "a.b")]) });
    mutate(dir, {
      "scripts/i18nIdenticalAllowlist.ts": rawSource([
        dq("a.json", "a.b"),
        `  { kind: 'json', ns: 'sneaky.json', key: 'sneaky.key', locales: ALL_LOCALES, reason: 'x' },`,
      ]),
    });
    const { status, stderr } = run(dir, manifestOf([strictEntry]));
    expect(status).toBe(1);
    expect(stderr).toContain("sneaky.key");
  });

  it("sees an exemption whose properties are written in a different order", () => {
    const dir = scratchRepo({ "scripts/i18nIdenticalAllowlist.ts": rawSource([dq("a.json", "a.b")]) });
    mutate(dir, {
      "scripts/i18nIdenticalAllowlist.ts": rawSource([
        dq("a.json", "a.b"),
        `  { key: "reordered.key", locales: ALL_LOCALES, reason: "x", ns: "reordered.json", kind: "json" },`,
      ]),
    });
    const { status, stderr } = run(dir, manifestOf([strictEntry]));
    expect(status).toBe(1);
    expect(stderr).toContain("reordered.key");
  });

  it("sees an exemption widened to more locales", () => {
    // Same ns and key, more languages exempted — a real broadening of the
    // claim, and identical under an (ns, key) identity.
    const narrow = `  { kind: "json", ns: "a.json", key: "a.b", locales: ["de"], reason: "x" },`;
    const wide = `  { kind: "json", ns: "a.json", key: "a.b", locales: ["de", "fr", "ja"], reason: "x" },`;
    const dir = scratchRepo({ "scripts/i18nIdenticalAllowlist.ts": rawSource([narrow]) });
    mutate(dir, { "scripts/i18nIdenticalAllowlist.ts": rawSource([wide]) });
    const { status, stderr } = run(dir, manifestOf([strictEntry]));
    expect(status).toBe(1);
    expect(stderr).toContain("fr");
  });

  it("sees an exemption switched from a json namespace to the yaml bundle", () => {
    const asJson = `  { kind: "json", ns: "a.json", key: "a.b", locales: ["de"], reason: "x" },`;
    const asYaml = `  { kind: "yaml", ns: "a.json", key: "a.b", locales: ["de"], reason: "x" },`;
    const dir = scratchRepo({ "scripts/i18nIdenticalAllowlist.ts": rawSource([asJson]) });
    mutate(dir, { "scripts/i18nIdenticalAllowlist.ts": rawSource([asYaml]) });
    expect(run(dir, manifestOf([strictEntry])).status).toBe(1);
  });

  it("ignores locale REORDERING and reason edits — neither changes the claim", () => {
    const before = `  { kind: "json", ns: "a.json", key: "a.b", locales: ["fr", "de"], reason: "old wording" },`;
    const after = `  { kind: "json", ns: "a.json", key: "a.b", locales: ["de", "fr"], reason: "new, longer wording" },`;
    const dir = scratchRepo({ "scripts/i18nIdenticalAllowlist.ts": rawSource([before]) });
    mutate(dir, { "scripts/i18nIdenticalAllowlist.ts": rawSource([after]) });
    expect(run(dir, manifestOf([strictEntry])).status).toBe(0);
  });

  it("does not mistake prose inside a reason for an exemption", () => {
    // Real reasons contain quotes, braces and colons — one of the shipped ones
    // literally contains `"{{index}} / {{count}}"`.
    const tricky =
      `  { kind: "json", ns: "a.json", key: "a.b", locales: ["de"],\n` +
      `    reason: 'Pure interpolation ("{{index}} / {{count}}") — looks like ns: "ghost.json", key: "ghost.key".' },`;
    const dir = scratchRepo({ "scripts/i18nIdenticalAllowlist.ts": rawSource([tricky]) });
    mutate(dir, { "scripts/i18nIdenticalAllowlist.ts": rawSource([tricky, dq("b.json", "b.c")]) });
    const { status, stderr } = run(dir, manifestOf([strictEntry]));
    expect(status).toBe(1);
    expect(stderr).toContain("b.c");
    expect(stderr).not.toContain("ghost.key");
  });

  it("fails closed when the allowlist array cannot be parsed", () => {
    const dir = scratchRepo({ "scripts/i18nIdenticalAllowlist.ts": rawSource([dq("a.json", "a.b")]) });
    mutate(dir, {
      "scripts/i18nIdenticalAllowlist.ts": `export const IDENTICAL_ALLOWLIST = [\n  { ns: "a.json",\n`,
    });
    const { status } = run(dir, manifestOf([strictEntry]));
    expect(status).toBe(1);
  });
});

// ─── the shipped manifest describes the real tree ───

describe("shipped manifest", () => {
  it("covers every baseline the discovery globs find in this repository", () => {
    const res = spawnSync(process.execPath, [SCRIPT, "--list"], { cwd: REPO, encoding: "utf8" });
    expect(res.status).toBe(0);
    // --list prints "registered <path>" / "UNREGISTERED <path>" lines.
    expect(res.stdout).not.toContain("UNREGISTERED");
    expect(res.stdout).not.toContain("MISSING");
  });

  it("checks every section of the file-size baseline, not just one", async () => {
    // Registering a file while checking only part of it is the quiet version
    // of not registering it: `--list` would still read as covered.
    const { MANIFEST } = await import("./baselineRatchetManifest.mjs");
    const entry = MANIFEST.entries.find((e) => e.path === "scripts/file-size-baseline.json");
    expect(entry.checks).toEqual([
      { mode: "scalar", at: "limit" },
      { mode: "scalar", at: "testLimit" },
      { mode: "per-key-count", at: "files" },
      { mode: "per-key-count", at: "testFiles" },
    ]);
  });

  it("gives every registered baseline at least one well-formed check", async () => {
    const { MANIFEST } = await import("./baselineRatchetManifest.mjs");
    const modes = new Set(["scalar", "per-key-count", "identity", "custom"]);
    for (const entry of MANIFEST.entries) {
      expect(entry.checks.length, entry.path).toBeGreaterThan(0);
      for (const check of entry.checks) {
        expect(modes, `${entry.path}: ${check.mode}`).toContain(check.mode);
        if (check.mode === "identity") {
          expect(["strings", "objects", "object-keys"]).toContain(check.shape);
          expect(["fail", "report"]).toContain(check.onAdd);
        }
      }
    }
  });

  it("requires a reason on every allowRaise exemption", async () => {
    const { MANIFEST } = await import("./baselineRatchetManifest.mjs");
    for (const entry of MANIFEST.allowRaise) {
      expect(entry.reason?.trim(), `${entry.path}:${entry.key}`).toBeTruthy();
      expect(MANIFEST.entries.some((e) => e.path === entry.path)).toBe(true);
    }
  });
});
