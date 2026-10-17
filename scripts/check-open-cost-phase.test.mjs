// WI-OC1.5 — self-test for scripts/check-open-cost-phase.sh, the open-cost
// plan's phase gate. Runs the REAL script as a subprocess against fixture trees
// (`--root`), so the gate is proven in both directions: it says no to a tree
// without the deliverables, and only a complete, verified phase says yes.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO, "scripts", "check-open-cost-phase.sh");
const PLAN = path.join(REPO, ".claude", "tdd-guardian", "plan-20261017-open-cost.md");

function run(args) {
  return spawnSync("bash", [SCRIPT, ...args], { cwd: REPO, encoding: "utf8" });
}

/** A fixture tree holding exactly the given files. */
function tree(files) {
  const root = mkdtempSync(path.join(tmpdir(), "open-cost-dod-"));
  for (const [rel, body] of files) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), body);
  }
  return root;
}

/** Phase OC1 delivered, as the smallest files that satisfy its assertions. */
const OC1 = [
  ["src/components/Editor/contentApplied.ts", "export function hasContentApplied() {}\n"],
  ["src/components/Editor/useTiptapFlush.ts", "if (!hasContentApplied(editor)) return;\n"],
  ["src/services/commands/menuListener.ts", "await Promise.all(bindings.map(mount));\n"],
  ["src/contexts/windowListening.ts", "export function useWindowListening() {}\n"],
  ["src/contexts/useWindowReady.ts", "publishWindowListening();\n"],
  ["src/components/Editor/DocumentSplit/DocumentSplitContainer.tsx", "return useWindowListening() ? <P /> : null;\n"],
  ["src/export/pandocFormats.ts", "export const PANDOC_FORMAT_KEYS = [];\n"],
  ["src/services/commands/exportCommands.ts", "import { PANDOC_FORMAT_KEYS } from \"./keys\";\n"],
  ["scripts/check-open-cost-phase.test.mjs", "// test\n"],
];

describe("check-open-cost-phase.sh", () => {
  it("exits 64 with usage on no argument, and on an unknown phase", () => {
    const none = run([]);
    expect(none.status).toBe(64);
    expect(none.stdout).toContain("Usage:");
    const unknown = run(["OC9"]);
    expect(unknown.status).toBe(64);
    expect(unknown.stderr).toContain("unknown phase");
  });

  it("reports a phase with nothing delivered as NOT STARTED, never as done", () => {
    const r = run(["OC1", `--root=${tree([])}`]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("NOT STARTED");
  });

  it("names what a partly delivered phase is missing", () => {
    const r = run(["OC1", `--root=${tree(OC1.filter(([rel]) => !rel.endsWith("pandocFormats.ts")))}`]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("INCOMPLETE");
    expect(r.stdout).toContain("missing: src/export/pandocFormats.ts");
  });

  it("fails a phase whose old mechanism is still in place", () => {
    const files = OC1.map(([rel, body]) =>
      rel.endsWith("menuListener.ts") ? [rel, `${body}if (options.shouldAbort?.()) return;\n`] : [rel, body]);
    const r = run(["OC1", `--root=${tree(files)}`]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("still matches /shouldAbort/");
  });

  it("calls a delivered phase UNVERIFIED away from the real repo, where linkage cannot run", () => {
    const r = run(["OC1", `--root=${tree(OC1)}`]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("UNVERIFIED");
    expect(r.stdout).not.toContain("✗");
  });

  it("asserts every work item the plan declares, in the phase that declares it", () => {
    const plan = readFileSync(PLAN, "utf8");
    const script = readFileSync(SCRIPT, "utf8");
    const declared = [...plan.matchAll(/\*\*WI-(OC(\d))\.(\d+) — /g)].map((m) => `WI-${m[1]}.${m[3]}`);
    expect(declared.length).toBeGreaterThan(0);
    for (const phase of new Set(declared.map((wi) => wi.slice(3, 6)))) {
      const block = script.match(new RegExp(`phase_${phase}\\(\\) \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
      const asserted = new Set([...block.matchAll(/\(WI-(OC\d\.\d+)\)/g)].map((m) => `WI-${m[1]}`));
      expect([...asserted].sort()).toEqual(declared.filter((wi) => wi.startsWith(`WI-${phase}.`)).sort());
    }
  });
});
