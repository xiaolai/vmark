// WI-FL0.3–0.6 — the doc-join runner's own tests (gates tier, node). The four
// join modules carry their own fixture tests under scripts/lib/docJoins/.
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT, JOIN_MODULES, JOIN_REGISTRY, loadJoins, registeredJoins, runJoins } from "./check-doc-joins.mjs";

function fakeJoin(id, impl) {
  return { id, DEFAULT_PATHS: {}, run: impl };
}

describe("runJoins", () => {
  it("tags every finding and info line with its join id", async () => {
    const joins = [
      fakeJoin("clean", async () => ({ findings: [], info: ["3 rows"] })),
      fakeJoin("drifted", async () => ({ findings: ["row X: doc says On, code says false"], info: [] })),
    ];
    const { findings, info } = await runJoins(joins, { root: ROOT });
    expect(findings).toEqual([{ join: "drifted", message: "row X: doc says On, code says false" }]);
    expect(info).toEqual([{ join: "clean", message: "3 rows" }]);
  });

  it("turns a throwing join into a finding rather than a crash", async () => {
    const joins = [fakeJoin("broken", async () => { throw new Error("table not found"); })];
    const { findings } = await runJoins(joins, { root: ROOT });
    expect(findings).toEqual([{ join: "broken", message: "join threw: table not found" }]);
  });

  it("treats a join that returns no findings array as a contract violation", async () => {
    const joins = [fakeJoin("silent", async () => undefined)];
    const { findings } = await runJoins(joins, { root: ROOT });
    expect(findings[0].message).toMatch(/contract violation/);
  });

  it("validates the whole result before reading it: a string `findings` is ONE finding, not one per character", async () => {
    const joins = [fakeJoin("stringy", async () => ({ findings: "row X drifted", info: [] }))];
    const { findings } = await runJoins(joins, { root: ROOT });
    expect(findings).toEqual([{ join: "stringy", message: "join returned no `findings` array (contract violation)" }]);
  });

  it("requires `info` to be an array too — the contract names both lists", async () => {
    const joins = [fakeJoin("no-info", async () => ({ findings: [] }))];
    const { findings, info } = await runJoins(joins, { root: ROOT });
    expect(findings).toEqual([{ join: "no-info", message: "join returned no `info` array (contract violation)" }]);
    expect(info).toEqual([]);
  });

  it("passes each join its own DEFAULT_PATHS and the root", async () => {
    let seen;
    const joins = [{ id: "spy", DEFAULT_PATHS: { doc: "x.md" }, run: async (ctx) => { seen = ctx; return { findings: [], info: [] }; } }];
    await runJoins(joins, { root: "/repo" });
    expect(seen).toEqual({ root: "/repo", paths: { doc: "x.md" } });
  });
});

describe("loadJoins", () => {
  it("refuses a module missing part of the contract", async () => {
    const root = mkdtempSync(join(tmpdir(), "docjoins-"));
    mkdirSync(join(root, "lib"));
    writeFileSync(join(root, "lib/half.mjs"), 'export const id = "half"; export async function run() { return { findings: [] }; }\n');
    await expect(loadJoins(root, ["lib/half.mjs"])).rejects.toThrow(/does not export `DEFAULT_PATHS`/);
  });

  it("every declared join module exists and honours the contract", async () => {
    const joins = await loadJoins(ROOT, JOIN_MODULES);
    expect(joins.map((j) => j.id)).toEqual(["lint-table", "settings-defaults", "readme-claims", "journey-inventory"]);
    for (const j of joins) expect(typeof j.DEFAULT_PATHS).toBe("object");
  });

  it("the static registry and the path-loaded modules are the SAME joins, one descriptor each", async () => {
    // One list carries both the module and its path, so the report can never
    // attribute a finding to the wrong file by zipping two arrays by position.
    const byPath = await loadJoins(ROOT, JOIN_MODULES);
    const byRegistry = registeredJoins();
    expect(byRegistry.map((j) => [j.rel, j.id])).toEqual(byPath.map((j) => [j.rel, j.id]));
    expect(JOIN_REGISTRY.map(([rel, mod]) => [rel, mod.id])).toEqual(byPath.map((j) => [j.rel, j.id]));
  });

  it("refuses two joins sharing an id — findings are attributed by id", () => {
    const dup = { id: "twin", DEFAULT_PATHS: {}, run: async () => ({ findings: [], info: [] }) };
    expect(() => registeredJoins([["a.mjs", dup], ["b.mjs", dup]])).toThrow(/"twin" is used by both a\.mjs and b\.mjs/);
    expect(() => registeredJoins([["a.mjs", { ...dup, id: "" }]])).toThrow(/`id` is not a non-empty string/);
  });
});

describe("on the live tree", () => {
  it("the gate is clean", () => {
    const out = execFileSync("node", ["scripts/check-doc-joins.mjs"], { cwd: ROOT, encoding: "utf8" });
    expect(out).toMatch(/✓ check-doc-joins: 4 joins clean/);
  });

  it("exits 64 on an unknown flag", () => {
    let code = 0;
    try {
      execFileSync("node", ["scripts/check-doc-joins.mjs", "--bogus"], { cwd: ROOT, encoding: "utf8", stdio: "pipe" });
    } catch (err) {
      code = err.status;
    }
    expect(code).toBe(64);
  });
});
