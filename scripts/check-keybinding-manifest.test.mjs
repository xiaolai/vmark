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

  it("scans builder sites over CODE and keeps EVERY live label key per id (audit #45)", () => {
    // A commented-out `with_id` site must not pair, and a second live site
    // (the non-macOS File-menu tail's Exit wording for save-all-quit) must be
    // checked rather than hidden behind the first — which is why that id now
    // carries a recorded exemption instead of passing on the macOS label alone.
    expect(src).toContain("const source = readOrDie(rel);");
    expect(src).toContain("rustCode(source, { keepStrings: true })");
    expect(src).toContain("pairs.get(m[1]).add(m[2])");
    expect(src).toMatch(/\["save-all-quit", \{ menu: "Save All and Exit", defs: "Save All and Quit"/);
    expect(src).toContain("for (const m of menuLabels)");
  });

  it("narrows each array by its BALANCED closing bracket, never the first textual `];`", () => {
    // scripts/lib/arrayLiteralEnd.test.mjs proves the scanner; this pins that
    // the gate uses it rather than indexOf("];"), which parsed a truncated
    // array silently when a comment inside it mentioned `];`. The scanner is
    // told which LANGUAGE it is reading — one hand-rolled lexer was wrong for
    // TS regex literals and for Rust raw strings alike (audit R2 #136/#140).
    expect(src).toContain("arrayLiteralEnd(src, open, { lang:");
    expect(src).toContain('rel.endsWith(".rs") ? "rust" : "ts"');
    expect(src).not.toContain('indexOf("];"');
  });

  it("reads the definitions through the TypeScript parser, and fails closed on every other element shape", () => {
    // audit R2 #62/#64: the brace-splitter collected the `{…}` groups it found
    // and ignored a `...SPREAD` / identifier / factory-call element entirely,
    // while its field search could take `id` from a comment or a nested object.
    expect(src).toContain("ts.createSourceFile(`${name}.ts`, `(${region}])`");
    expect(src).toContain("is not an object literal");
    expect(src).toContain("ts.isSpreadAssignment(p)");
    expect(src).not.toContain("function splitObjectLiterals");
  });

  it("refuses contract-array text it did not read, so a mirror tuple cannot vanish", () => {
    // audit R2 #68: a commented-out tuple counted, and an unparsed one was
    // silently dropped. Comments are blanked first; the residue must be empty.
    expect(src).toContain("rustCode(readOrDie(RUST_PATH), { keepStrings: true })");
    expect(src).toContain("holds array element text this gate did not read");
  });

  it("checks the polarity and branch order of the cfg! conditional, not just its literals", () => {
    // audit R2 #60: `if !cfg!(target_os = "macos") { A } else { B }` carries the
    // same four literals in the same order and means the opposite. Verified by
    // mutation against the real builder: negating the cfg! fails the gate.
    expect(src).toContain("is not the platform-conditional shape this gate reads");
    expect(src).toContain("const between = (a, b) =>");
  });

  it("verifies that every dynamic-accelerator exemption still has a live binding", () => {
    // audit R2 #55: `search-genies` is excluded from every cross-language
    // comparison here, so a deleted useGenieShortcuts binding would take the
    // shortcut out of the gate with nothing to fail on.
    expect(src).toContain("stale DYNAMIC_MENU_IDS entry");
    expect(src).toContain('source: "src/hooks/useGenieShortcuts.ts"');
  });

  it("rejects two definitions claiming one menuId", () => {
    expect(src).toContain("is claimed by both");
  });

  it("the manifest threads the definitions LABEL through (the leg's input)", () => {
    expect(src).toContain('label: fields.get("label")');
  });

  // audit R2 #71 — the builder scan keeps string CONTENTS (the id and the key
  // are literals), so builder-shaped text inside a raw string matched. The
  // fully-blanked copy is the discriminator: `&t!(` survives blanking only
  // when it is real code.
  it("confirms each with_id/t! pair against the literal-blanked copy, so a raw string cannot label a menu item", () => {
    expect(src).toContain("const bare = rustCode(source);");
    expect(src).toContain('bare.slice(callAt, callAt + 4) !== "&t!("');
  });

  // audit R2 #72 — the en.yml scan took every two-space key in the FILE and
  // prefixed it `menu.`, so 149 keys from `errors:`/`window:`/`cli:` became
  // phantom menu labels; `errors:` sits after `menu:`, so a shared dotted tail
  // would have overwritten a real label. Measured after the fix: 197 real menu
  // keys, none lost, no value changed.
  // audit R3 #58/#59 — the gate carried a SECOND Rust comment/string lexer,
  // which knew nothing of nested block comments, raw strings or char literals.
  // A lone `'"'` in a menu file put it in string mode and silently swallowed
  // every later accel(...) call. There is one tokenizer now.
  it("reads accel(...) call sites through the shared Rust tokenizer, not a private lexer", () => {
    expect(src).toContain("rustSpans");
    expect(src).toContain("for (const span of rustSpans(src)) spans.set(span.start, span);");
    expect(src).not.toContain("function readRustString");
    expect(src).not.toContain('unterminated block comment');
  });

  // audit R3 #65 — the declaration anchor was a regex over RAW source, so a
  // declaration-shaped comment or string could point the parse at another array.
  it("locates each array declaration through the parser (TS) or blanked code (Rust)", () => {
    expect(src).toContain("function tsDeclarationOpen");
    expect(src).toContain("ts.isVariableDeclaration(node)");
    expect(src).toContain("decl.exec(rustCode(src))");
    expect(src).toContain('arrayLiteralEnd(src, open, { lang:');
  });

  // audit R3 #69 — the per-entry legs look each manifest id UP in the mirror,
  // so a tuple the mirror alone carries was never examined. Verified by
  // mutation: renaming a live DEFAULT_ACCELERATORS id fails the gate.
  it("rejects a contract-mirror tuple that maps to no synced entry", () => {
    expect(src).toContain("function reportOrphanMirrorAccel");
    expect(src).toContain("for (const [id, accel] of rustDefault)");
    expect(src).toContain("for (const [id, { mac, other }] of rustPlatform)");
    expect(src).toContain("the tuple is stale (delete it)");
  });

  // audit R3 #56 — a permanent docs exemption granted on a range nothing read.
  // Verified by mutation: narrowing the range row to `Mod + 1`..`Mod + 2` fails.
  it("verifies each DOCS_RANGE_DOCUMENTED exemption against a live range cell, both ways", () => {
    expect(src).toContain("stale DOCS_RANGE_DOCUMENTED entry");
    expect(src).toContain("function coveringRange");
    expect(src).toContain("no such menu id in the manifest");
    const ranges = readFileSync(join(ROOT, "website", "guide", "shortcuts.md"), "utf8")
      .match(/`([^`\n]+)`\s+through\s+`([^`\n]+)`/g);
    expect(ranges, "the docs must still carry the range the exemption cites").not.toBeNull();
  });

  // audit R3 #70 — the docs leg read defaultKey and defaultKeyOther but never
  // defaultKeyMac, and an empty defaultKey skipped the leg outright.
  it("documents every EFFECTIVE platform key, defaultKeyMac included", () => {
    expect(src).toContain("const docKeys = [...new Set([macKey, manOther ?? manKey])]");
    expect(src).toContain("for (const key of docKeys)");
  });

  // audit R3 #66 — zero definitions implies zero derived entries, so the
  // manifest check always fired first and the definitions check was dead.
  it("reports zero DEFINITIONS before zero derived entries, so both messages are reachable", () => {
    expect(src.indexOf("parsed zero shortcut definitions")).toBeLessThan(
      src.indexOf("derived zero menu-backed shortcuts"),
    );
  });

  // audit R3 #57 — the accelerator converter the whole gate compares by was a
  // hand-copied port under a "keep in sync" comment. It has one home now, and
  // keybindingFormat.test.mjs proves it agrees with the app's.
  it("imports prosemirrorToTauri rather than carrying its own copy", () => {
    expect(src).toContain("prosemirrorToTauri } from \"./lib/keybindingFormat.mjs\"");
    expect(src).not.toContain("function prosemirrorToTauri");
  });

  it("reads en.yml labels from the menu: block only, refuses a duplicate key, and unquotes the scalar", () => {
    expect(src).toContain("inMenu = /^menu:\\s*$/.test(line)");
    expect(src).toContain("duplicate key");
    expect(src).toContain("labels.set(key, unquote(m[2]))");
    const yml = readFileSync(join(ROOT, "src-tauri", "locales", "en.yml"), "utf8");
    const menuOnly = new Set();
    let inMenu = false;
    for (const line of yml.split("\n")) {
      if (/^[^\s#]/.test(line)) {
        inMenu = /^menu:\s*$/.test(line);
        continue;
      }
      if (!inMenu) continue;
      const m = /^\s{2}([A-Za-z0-9_.]+):/.exec(line);
      if (m) menuOnly.add(m[1]);
    }
    const everyIndentedKey = [...yml.matchAll(/^\s{2}([A-Za-z0-9_.]+):/gm)].map((m) => m[1]);
    expect(menuOnly.size).toBeGreaterThan(100);
    expect(everyIndentedKey.length).toBeGreaterThan(menuOnly.size);
  });
});
