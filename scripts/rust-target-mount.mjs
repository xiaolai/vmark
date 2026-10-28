#!/usr/bin/env node
/**
 * Purpose: whether a Rust file of the crate is COMPILED into its library test
 * build for a named target — every `mod` declaration from `lib.rs` down to
 * the file judged for that target, not for this host. `al_test_for_target`
 * (scripts/lib/al-gate.sh) asks it about a witness this host cannot run; the
 * test fns inside the file are judged by `rust-code-grep --test-reach
 * --target=<os>` (scripts/dod-syntax.mjs).
 *
 * The walk: a file `d/mod.rs` is declared by `mod d;` in the parent
 * directory's `mod.rs`, in `d.rs`'s sibling directory-module file, or in
 * `lib.rs` at the crate root; `d/x.rs` by `mod x;` in `d/mod.rs` or `d.rs`
 * (`lib.rs` at the root); a `#[path = "…"]` mount (`#[path = "x.test.rs"]
 * mod x_tests;`) by `d/mod.rs`, `d/<stem>.rs`, `d.rs` (`"d/x.test.rs"`) or a
 * module one directory down (`"../x.test.rs"` in `d/<sub>/*.rs`).
 * One declaration must be LIVE for the target: code (not a comment or a
 * literal), at the top level of its file, its outer attributes and the
 * declaring file's inner attributes known and every `cfg` true there
 * (`attributeVerdict`, dodSyntaxRustAttrs.mjs). A declaration inside an inline
 * module, or gated on a predicate this probe cannot evaluate (a `feature`, a
 * custom cfg), does not count: the walk fails closed and says why.
 *
 * It establishes that the file is compiled for the target. It does not run
 * anything, and nothing here claims the target's tests were executed.
 *
 * Usage: node scripts/rust-target-mount.mjs <os> <file.rs>   (paths relative
 * to the working directory, the crate at src-tauri/src). Exit 0 and print the
 * chain, 1 with the reason on stderr, 64 on misuse.
 *
 * @coordinates-with scripts/lib/al-gate.sh — al_test_for_target, the caller
 * @coordinates-with scripts/lib/dodSyntaxRustAttrs.mjs — per-target attribute verdicts
 * @coordinates-with scripts/lib/dod-assertions.sh — rust_mount_owner, the host-side mount lookup
 * @module scripts/rust-target-mount
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { attributeVerdict, innerAttributes, onTarget, outerAttributes, TARGETS, targetNamed } from "./lib/dodSyntaxRustAttrs.mjs";
import { isMainModule } from "./lib/isMainModule.mjs";
import { rustCode } from "./lib/rustSource.mjs";

const CRATE = "src-tauri/src";
const MOD_DECL = /\bmod\s+([A-Za-z_]\w*)\s*;/g;

/** Brace depth of `bare` at `at`. */
const depthAt = (bare, at) => [...bare.slice(0, at)].reduce((d, c) => d + (c === "{") - (c === "}"), 0);

/**
 * The declarations of `want` ({ name } for a plain `mod name;`, { rel } for a
 * `#[path = "rel"]` mount) in `source`: `{ live }`, or `{ why }` for each one
 * that is not live for `target`.
 */
function declarations(source, want, target) {
  const bare = rustCode(source);
  const text = rustCode(source, { keepStrings: true });
  const fileAttrs = innerAttributes(bare, text, 0);
  const out = [];
  for (const m of bare.matchAll(MOD_DECL)) {
    const attrs = outerAttributes(bare, text, m.index);
    const pathAttr = attrs.map((a) => /^\s*path\s*=\s*"([^"]*)"\s*$/.exec(a)?.[1]).find((v) => v !== undefined);
    if (want.rel !== undefined ? pathAttr !== want.rel : pathAttr !== undefined || m[1] !== want.name) continue;
    const line = bare.slice(0, m.index).split("\n").length;
    if (depthAt(bare, m.index) !== 0) { out.push({ why: `line ${line}: inside an inline module, where the mount path is not read` }); continue; }
    const v = attributeVerdict([...fileAttrs, ...attrs], target);
    if (v.unknown) out.push({ why: `line ${line}: ${v.unknown}` });
    else if (v.disabled) out.push({ why: `line ${line}: compiled out on ${onTarget(target)}` });
    else out.push({ live: true });
  }
  return out;
}

/** The `.rs` files one directory below `dir`, read from disk relative to the working directory. */
export function diskChildModules(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .flatMap((e) => readdirSync(path.posix.join(dir, e.name)).filter((f) => f.endsWith(".rs")).map((f) => path.posix.join(dir, e.name, f)));
}

/** The files that may declare `file`, each with what its declaration names. */
function declarers(file, crate, children) {
  const dir = path.posix.dirname(file);
  const base = path.posix.basename(file);
  const atRoot = (d) => d === crate;
  if (base === "mod.rs") {
    const parent = path.posix.dirname(dir);
    const name = path.posix.basename(dir);
    return (atRoot(parent) ? [`${crate}/lib.rs`] : [`${parent}/mod.rs`, `${parent}.rs`]).map((f) => ({ file: f, want: { name } }));
  }
  const stem = base.replace(/\.rs$/, "");
  const plain = /^[A-Za-z_]\w*$/.test(stem)
    ? (atRoot(dir) ? [`${crate}/lib.rs`] : [`${dir}/mod.rs`, `${dir}.rs`]).map((f) => ({ file: f, want: { name: stem } }))
    : [];
  const owner = `${dir}/${stem.replace(/\.test$/, "")}.rs`;
  const mounts = [...new Set([`${dir}/mod.rs`, owner, ...(atRoot(dir) ? [`${crate}/lib.rs`] : [])])]
    .filter((f) => f !== file).map((f) => ({ file: f, want: { rel: base } }));
  const up = atRoot(dir) ? [] : [{ file: `${dir}.rs`, want: { rel: `${path.posix.basename(dir)}/${base}` } }];
  const down = children(dir).filter((f) => f !== file).map((f) => ({ file: f, want: { rel: `../${base}` } }));
  return [...plain, ...mounts, ...up, ...down];
}

/**
 * `{ chain }` — the files from `lib.rs` down to `file`, each declaring the
 * next live for `target` — or `{ error }`. Every live declarer is tried: one
 * whose own chain breaks (an orphan file that is never mounted) does not hide
 * another that reaches the crate root. `read(p)` returns a file's text or
 * undefined when it does not exist; `children(dir)` lists the `.rs` files one
 * directory below `dir`.
 */
export function rustMountChain(file, target, read, crate = CRATE, children = diskChildModules) {
  const why = [];
  const walk = (cur, below) => {
    if (cur === `${crate}/lib.rs`) return [cur, ...below];
    if (below.includes(cur) || below.length > 64) return null;
    let declared = false;
    for (const d of declarers(cur, crate, children)) {
      const source = read(d.file);
      if (source === undefined) continue;
      const found = declarations(source, d.want, target);
      why.push(...found.filter((x) => !x.live).map((x) => `${d.file} ${x.why}`));
      if (!found.some((x) => x.live)) continue;
      declared = true;
      const chain = walk(d.file, [cur, ...below]);
      if (chain) return chain;
    }
    if (!declared) why.push(`no live mount of ${cur}`);
    return null;
  };
  const chain = walk(file, []);
  if (chain) return { chain };
  return { error: `no live mount chain from ${crate}/lib.rs to ${file} for ${onTarget(target)} — ${[...new Set(why)].join("; ")}` };
}

if (isMainModule(import.meta.url)) {
  const [os, file, ...extra] = process.argv.slice(2);
  const target = targetNamed(os);
  if (!target || !file || extra.length > 0) {
    console.error(`usage: node scripts/rust-target-mount.mjs <${TARGETS.map((t) => t.os).join("|")}> <file.rs>`);
    process.exit(64);
  }
  const r = rustMountChain(file, target, (p) => (existsSync(p) ? readFileSync(p, "utf8") : undefined));
  if (r.error) {
    console.error(r.error);
    process.exit(1);
  }
  console.log(r.chain.join(" → "));
}
