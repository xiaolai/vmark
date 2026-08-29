// WI-UI4.3 — the keybinding gate, including its new LABEL-PARITY leg (one
// label per command). The gate is a fail-fast CLI, so it is exercised as a
// subprocess against the real tree, and the label leg's properties are pinned
// against the source it ships.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GATE = join(ROOT, "scripts", "check-keybinding-manifest.mjs");
const src = readFileSync(GATE, "utf8");

describe("check-keybinding-manifest", () => {
  it("is green against the real tree (accels AND labels aligned)", () => {
    const out = execFileSync("node", [GATE], { cwd: ROOT, encoding: "utf8" });
    expect(out).toContain("Keybinding drift gate passed");
  });

  it("the label leg strips a trailing ellipsis before comparing", () => {
    // `Settings…` (menu) must equal `Settings` (flat label): the comparison
    // canonicalises with replace(/…$/).
    expect(src).toMatch(/replace\(\/…\$\/, ""\)/);
  });

  it("reports drift as one-command-one-label, naming both sources", () => {
    expect(src).toContain("one command, one label (WI-UI4.3)");
    expect(src).toContain("label drift for");
  });

  it("every LABEL_EXEMPT entry records BOTH expected labels AND a stated reason", () => {
    const block = src.slice(src.indexOf("const LABEL_EXEMPT"), src.indexOf("]);", src.indexOf("const LABEL_EXEMPT")));
    const entries = [...block.matchAll(/\["([a-z0-9-]+)",\s*\{\s*menu:\s*"([^"]*)",\s*defs:\s*"([^"]*)",\s*reason:\s*"([^"]*)"\s*\}\]/g)];
    expect(entries.length).toBeGreaterThan(10);
    for (const [, id, menu, defs, reason] of entries) {
      expect(menu.trim().length, `${id} menu`).toBeGreaterThan(0);
      expect(defs.trim().length, `${id} defs`).toBeGreaterThan(0);
      expect(reason.trim().length, id).toBeGreaterThan(10);
    }
  });

  it("the label leg has no silent skip: unpaired ids fail unless allow-listed with a reason", () => {
    expect(src).toContain("UNPAIRED_OK");
    expect(src).toContain("has no label pair in the Rust builder");
    // an exempt entry that drifts from its RECORDED menu label fails
    expect(src).toContain("recorded menu label");
  });

  it("the manifest threads the definitions LABEL through (the leg's input)", () => {
    expect(src).toContain('label: stringField(body, "label")');
  });
});
