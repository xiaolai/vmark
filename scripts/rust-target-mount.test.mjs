// WI-AL0.7 — a witness judged for a named target counts only when its file is mounted for that target
/**
 * `rustMountChain` walks a Rust file's `mod` declarations up to the crate's
 * `lib.rs` and judges every one — its outer attributes and the inner
 * attributes of the file declaring it — for a NAMED target. A mount compiled
 * out there, or gated on a predicate the probe cannot evaluate (a feature),
 * breaks the chain: fail closed.
 *
 * @coordinates-with scripts/rust-target-mount.mjs — the walk under test
 * @module scripts/rust-target-mount.test
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { diskChildModules, rustMountChain } from "./rust-target-mount.mjs";
import { targetNamed } from "./lib/dodSyntaxRustAttrs.mjs";

const REPO = path.resolve(import.meta.dirname, "..");
const WIN = targetNamed("windows");
const MAC = targetNamed("macos");
const R = "src-tauri/src";
const TEST = `${R}/a/x.test.rs`;

/** A crate whose lib.rs mounts `a`, whose a/mod.rs mounts x.test.rs under `mount` attributes. */
const crate = ({ lib = "pub mod a;", mount = "#[cfg(test)]", modInner = "", tail = "" } = {}) => ({
  [`${R}/lib.rs`]: `${lib}\n`,
  [`${R}/a/mod.rs`]: `${modInner}\npub fn f() {}\n${mount}\n#[path = "x.test.rs"]\nmod x_tests;\n${tail}`,
  [TEST]: "#[test]\nfn t() {}\n",
});
/** The `.rs` files one directory below `dir` in the `files` map. */
const childModules = (files) => (dir) => Object.keys(files).filter((p) => p.startsWith(`${dir}/`) && p.slice(dir.length + 1).split("/").length === 2);
const chain = (files, target, file = TEST) => rustMountChain(file, target, (p) => files[p], undefined, childModules(files));

describe("rustMountChain", () => {
  it("returns the chain from lib.rs to a mounted test file", () => {
    expect(chain(crate(), WIN)).toEqual({ chain: [`${R}/lib.rs`, `${R}/a/mod.rs`, TEST] });
  });

  it.each([
    ["the test mount compiled out there", { mount: "#[cfg(not(windows))]" }, "compiled out"],
    ["the test mount gated on a feature", { mount: '#[cfg(any(not(windows), feature = "win-paths"))]' }, "not a predicate"],
    ["an intermediate mod compiled out there", { lib: "#[cfg(unix)]\npub mod a;" }, "compiled out"],
    ["the declaring file disabled by an inner attribute", { modInner: "#![cfg(unix)]" }, "compiled out"],
    ["the mount only in a comment", { mount: "/*", tail: "*/\n" }, "no live"],
    ["a mount inside an inline module", { mount: "mod inner {", tail: "}\n" }, "inline module"],
    ["no lib.rs declaration", { lib: "pub mod b;" }, "no live"],
  ])("refuses %s", (_n, opts, why) => {
    const r = chain(crate(opts), WIN);
    expect(r.error).toMatch(new RegExp(why));
  });

  it("judges each target on its own", () => {
    const files = crate({ mount: "#[cfg(not(windows))]" });
    expect(chain(files, MAC).chain).toHaveLength(3);
    expect(chain(files, WIN).error).toBeDefined();
  });

  it("accepts one live mount among cfg-split alternatives", () => {
    const files = crate({ mount: '#[cfg(unix)]\n#[path = "x.test.rs"]\nmod x_unix;\n#[cfg(windows)]' });
    expect(chain(files, WIN).chain).toHaveLength(3);
    expect(chain(files, MAC).chain).toHaveLength(3);
  });

  it("follows the directory-module file and a plain sibling module", () => {
    const files = {
      [`${R}/lib.rs`]: "mod a;\n",
      [`${R}/a.rs`]: 'mod b;\n#[cfg(test)]\n#[path = "a/x.test.rs"]\nmod x_tests;\n',
      [`${R}/a/b.rs`]: "pub fn g() {}\n",
      [TEST]: "#[test]\nfn t() {}\n",
    };
    expect(chain(files, WIN)).toEqual({ chain: [`${R}/lib.rs`, `${R}/a.rs`, TEST] });
    expect(chain(files, WIN, `${R}/a/b.rs`)).toEqual({ chain: [`${R}/lib.rs`, `${R}/a.rs`, `${R}/a/b.rs`] });
  });

  it("tries every declarer: an unmounted orphan that also mounts the file does not hide the live chain", () => {
    const files = {
      [`${R}/lib.rs`]: "mod a;\n",
      [`${R}/a.rs`]: '#[cfg(test)]\n#[path = "a/x.test.rs"]\nmod x_tests;\n',
      [`${R}/a/x.rs`]: '#[cfg(test)]\n#[path = "x.test.rs"]\nmod x_tests;\n',
      [TEST]: "#[test]\nfn t() {}\n",
    };
    expect(chain(files, WIN)).toEqual({ chain: [`${R}/lib.rs`, `${R}/a.rs`, TEST] });
  });

  it("refuses when every declarer's own chain breaks", () => {
    const files = {
      [`${R}/lib.rs`]: "#[cfg(unix)]\nmod a;\n",
      [`${R}/a.rs`]: '#[cfg(test)]\n#[path = "a/x.test.rs"]\nmod x_tests;\n',
      [`${R}/a/x.rs`]: '#[cfg(test)]\n#[path = "x.test.rs"]\nmod x_tests;\n',
      [TEST]: "#[test]\nfn t() {}\n",
    };
    expect(chain(files, WIN).error).toMatch(/compiled out/);
  });

  it("follows a child directory's module mounting a test beside its directory as ../x.test.rs", () => {
    const files = {
      [`${R}/lib.rs`]: "pub mod a;\n",
      [`${R}/a/mod.rs`]: "mod adm;\n",
      [`${R}/a/adm/mod.rs`]: '#[cfg(test)]\n#[path = "../x.test.rs"]\nmod x_tests;\n',
      [TEST]: "#[test]\nfn t() {}\n",
    };
    expect(chain(files, WIN)).toEqual({ chain: [`${R}/lib.rs`, `${R}/a/mod.rs`, `${R}/a/adm/mod.rs`, TEST] });
    const compiledOut = { ...files, [`${R}/a/adm/mod.rs`]: '#[cfg(unix)]\n#[path = "../x.test.rs"]\nmod x_tests;\n' };
    expect(chain(compiledOut, WIN).error).toMatch(/compiled out/);
  });

  it("mounts a real test that a child directory's module mounts from beside it", () => {
    const file = `${R}/agent_journal/page_lifecycle.test.rs`;
    const read = (p) => (existsSync(path.join(REPO, p)) ? readFileSync(path.join(REPO, p), "utf8") : undefined);
    const children = (dir) => diskChildModules(path.join(REPO, dir)).map((f) => path.relative(REPO, f));
    const r = rustMountChain(file, MAC, read, undefined, children);
    expect(r.chain?.at(-2), r.error).toBe(`${R}/agent_journal/admission/mod.rs`);
  });

  it("mounts the real Windows witness for windows and for macos", () => {
    const file = `${R}/agent_journal/git_export/names.test.rs`;
    for (const t of [WIN, MAC]) {
      const r = rustMountChain(file, t, (p) => (existsSync(path.join(REPO, p)) ? readFileSync(path.join(REPO, p), "utf8") : undefined));
      expect(r.chain?.at(-1), r.error).toBe(file);
    }
  });

  it("the CLI prints the chain, explains a break, and refuses misuse", () => {
    const root = mkdtempSync(path.join(tmpdir(), "rust-mount-"));
    afterAll(() => rmSync(root, { recursive: true, force: true }));
    for (const [rel, body] of Object.entries(crate({ mount: "#[cfg(unix)]" }))) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), body);
    }
    const cli = (...a) => spawnSync("node", [path.join(REPO, "scripts/rust-target-mount.mjs"), ...a], { cwd: root, encoding: "utf8" });
    expect(cli("macos", TEST).stdout).toContain(`${R}/lib.rs → ${R}/a/mod.rs → ${TEST}`);
    const win = cli("windows", TEST);
    expect(win.status).toBe(1);
    expect(win.stderr).toMatch(/compiled out on the named target \(windows\)/);
    expect(cli("plan9", TEST).status).toBe(64);
    expect(cli("windows").status).toBe(64);
  });
});
