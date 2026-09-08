/**
 * Header-reference TARGET resolution (WI-FL0.2) — does the thing a header
 * names exist? The grammar that finds the references lives in
 * `scripts/lib/headerReferences.mjs`; this module answers for one target.
 *
 * Purpose: one place that knows every base a reader could mean by a header
 * path, so the gate flags a target that MOVED, was RENAMED or was DELETED and
 * nothing else. Measured on adoption (4,700 references): 192 of 255 bare-name
 * targets named a file living in another directory (`settingsStore.ts` from a
 * hook), so a bare name or partial path is resolved by PATH SUFFIX over the
 * scan trees after the location-based bases fail — that is the convention the
 * repo actually uses, and a moved file with an unchanged tail is the one class
 * this trades away (reported per run so the trade stays visible).
 *
 * Key decisions:
 *   - Bases, in order: the file's directory, each ancestor up to its tree
 *     root, `src/`, `src-tauri/src/`, the tree's PACKAGE root (`src-tauri/`,
 *     `server/mcp/`) and the repo root. Cross-language references
 *     (`hooks/useTheme.ts` from Rust, `pdf_export/commands.rs` from TS) are
 *     ordinary here, so the two source roots apply to every tree.
 *   - A bare directory resolves (which subsumes `/index.ts` and `/mod.rs`);
 *     a trailing `/` demands one. Extensionless targets try
 *     `RESOLVE_EXTENSIONS`. `a/{b,c}.ts` must resolve for EVERY alternative;
 *     a `*` glob resolves when at least one file matches.
 *   - `./`, `../` and `@/` targets are anchored: no suffix fallback.
 *   - A target naming a declared npm dependency (`@tauri-apps/plugin-log`)
 *     resolves against the manifests, not `node_modules`, so no install is
 *     needed to check it.
 *   - Rust `a::b::c` resolves to `a/b/c.rs` or `a/b/c/mod.rs` under
 *     `src-tauri/src/`, the file's own module directory, or its directory;
 *     `crate::`, `self::` and `super::` are honoured.
 *
 * @coordinates-with scripts/lib/headerReferences.mjs — the grammar; calls these per reference
 * @coordinates-with scripts/check-header-references.test.mjs — drives each resolution rule
 * @module scripts/lib/headerReferenceTargets
 */
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const posix = path.posix;

/** Scan roots. `moduleBase` is what `@module` paths are relative to. */
export const TREES = [
  { dir: "src", moduleBase: "src", packageRoot: ".", lang: "ts" },
  { dir: "src-tauri/src", moduleBase: "src-tauri/src", packageRoot: "src-tauri", lang: "rust" },
  { dir: "server/mcp/src", moduleBase: "server/mcp/src", packageRoot: "server/mcp", lang: "ts" },
  { dir: "server/content/src", moduleBase: "server/content/src", packageRoot: "server/content", lang: "ts" },
  { dir: "scripts", moduleBase: ".", packageRoot: ".", lang: "ts" },
  { dir: ".claude/hooks", moduleBase: ".", packageRoot: ".", lang: "ts" },
  { dir: "e2e", moduleBase: ".", packageRoot: ".", lang: "ts" },
];
// `.sh` is NOT scanned, and that is a KNOWN GAP, not an oversight (audit R2
// #169): the DoD checkers and `lib/dod-assertions.sh` do carry `# Plan:` and
// `# @coordinates-with` headers. Adding `.sh` here (with the `#`-comment
// branch in headerReferences.mjs, which exists) was measured on 2026-09-08 and
// immediately reports TWELVE `# Plan: dev-docs/plans/*.md` headers whose plan
// file is no longer in this tree. Every one is MAINTAINER-LOCAL: `dev-docs/`
// is gitignored, so CI (where it is absent) skips them and only a maintainer
// machine sees them — and whether those plans are retired (rewrite the header
// as `Origin: … (retired)`) or merely missing from one checkout is a
// maintainer's call, not a gate's. Landing the scan needs that call first;
// appending them to the identity baseline is not an option, since its header
// forbids appending.
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".mjs", ".js", ".rs"]);
const SKIP_SEGMENTS = new Set(["node_modules", "dist", "target", "coverage", ".git", "generated"]);
/** Tried, in order, when a path target has no extension of its own. */
export const RESOLVE_EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".mjs", ".rs", ".d.ts"];
export const RUST_ROOT = "src-tauri/src";
const RUST_DIR_FILES = new Set(["mod.rs", "lib.rs", "main.rs"]);
const MANIFEST_KEYS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

/**
 * Memoised lstat over one root: `kind(rel)` is "file" | "dir" | "link" | "none".
 * A symlink is never traversed or indexed — a link into `.` would recurse
 * forever, one out of the root would scan files outside it — but a header may
 * still legitimately name one, so it EXISTS without being a file or directory.
 */
export function fsAt(root) {
  const cache = new Map();
  const kind = (rel) => {
    if (!cache.has(rel)) {
      const s = lstatSync(path.join(root, rel), { throwIfNoEntry: false });
      cache.set(rel, !s ? "none" : s.isSymbolicLink() ? "link" : s.isDirectory() ? "dir" : s.isFile() ? "file" : "none");
    }
    return cache.get(rel);
  };
  return {
    exists: (rel) => kind(rel) !== "none",
    isDir: (rel) => kind(rel) === "dir",
    isFile: (rel) => kind(rel) === "file",
    listDir: (rel) => readdirSync(path.join(root, rel)),
    read: (rel) => readFileSync(path.join(root, rel), "utf8"),
  };
}

/** The scan tree a repo-relative file belongs to (longest matching root). */
export function treeFor(file, trees = TREES) {
  let best = null;
  for (const tree of trees) {
    if ((file === tree.dir || file.startsWith(`${tree.dir}/`)) && (!best || tree.dir.length > best.dir.length)) best = tree;
  }
  if (best) return best;
  return { dir: posix.dirname(file), moduleBase: ".", packageRoot: ".", lang: file.endsWith(".rs") ? "rust" : "ts" };
}

export function stripExtension(rel) {
  if (rel.endsWith(".d.ts")) return rel.slice(0, -5);
  const ext = posix.extname(rel);
  return ext ? rel.slice(0, -ext.length) : rel;
}

export const isRustDirFile = (file) => RUST_DIR_FILES.has(posix.basename(file));

/** Source files under `dir`, repo-relative, skipping `SKIP_SEGMENTS`. */
export function* walkSources(fs, dir) {
  for (const name of fs.listDir(dir).sort()) {
    if (SKIP_SEGMENTS.has(name)) continue;
    const rel = posix.join(dir, name);
    if (fs.isDir(rel)) yield* walkSources(fs, rel);
    else if (fs.isFile(rel) && SOURCE_EXTENSIONS.has(posix.extname(rel))) yield rel;
  }
}

/**
 * The extensions a target may grow when resolving it — `RESOLVE_EXTENSIONS` for
 * an EXTENSIONLESS file target, none otherwise.
 *
 * ONE rule, one place. It was written twice (here for the tail index, and in
 * `pathExistsAt` for location resolution), and the pair had already had the
 * same bug fixed in both copies: appending variants unconditionally let a
 * missing `foo.js` resolve through a `foo.js.ts` that exists for other reasons
 * (audit R2 #170, then R3 #171). Two copies of a resolution rule are two
 * resolvers, and only one of them gets the next fix.
 */
function extensionCandidates(spec, dirOnly) {
  return dirOnly || posix.extname(spec) !== "" ? [] : RESOLVE_EXTENSIONS;
}

/** Every file and directory under the scan trees, keyed by basename, for suffix matching. */
export function buildTailIndex(fs, trees = TREES) {
  const byName = new Map();
  const add = (p, isDir) => {
    const name = posix.basename(p);
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push({ path: p, isDir });
  };
  const visit = (dir) => {
    for (const name of fs.listDir(dir)) {
      if (SKIP_SEGMENTS.has(name)) continue;
      const rel = posix.join(dir, name);
      if (fs.isDir(rel)) {
        add(rel, true);
        visit(rel);
      } else if (fs.isFile(rel)) add(rel, false);
    }
  };
  for (const tree of trees) if (fs.isDir(tree.dir)) visit(tree.dir);
  return {
    /** Some indexed path IS `spec` or ends with `/<spec>` (extension variants when spec has none). */
    hasTail(spec, dirOnly) {
      const variants = [spec, ...extensionCandidates(spec, dirOnly).map((e) => spec + e)];
      return variants.some((v) =>
        (byName.get(posix.basename(v)) ?? []).some((e) => (!dirOnly || e.isDir) && (e.path === v || e.path.endsWith(`/${v}`))),
      );
    },
  };
}

/** Package names declared by the root manifest and every tree's package manifest. */
export function dependencyNames(fs, trees = TREES) {
  const names = new Set();
  for (const dir of new Set([".", ...trees.map((t) => t.packageRoot)])) {
    const manifest = posix.join(dir, "package.json");
    if (!fs.isFile(manifest)) continue;
    let pkg;
    try {
      pkg = JSON.parse(fs.read(manifest));
    } catch (err) {
      // A manifest this gate cannot read would turn every dependency-shaped
      // target into an "unresolved" finding — or into silence, if none is
      // referenced. Neither is what happened; say what did.
      throw new Error(`${manifest}: cannot parse package manifest — ${err.message}`);
    }
    for (const key of MANIFEST_KEYS) for (const name of Object.keys(pkg[key] ?? {})) names.add(name);
  }
  return names;
}

/** `tools/{a,b}.ts` → `["tools/a.ts", "tools/b.ts"]`; no braces → `[target]`. */
export function expandBraces(target) {
  const m = /^([^{]*)\{([^{}]*)\}(.*)$/.exec(target);
  if (!m) return [target];
  return m[2].split(",").flatMap((alt) => expandBraces(`${m[1]}${alt.trim()}${m[3]}`));
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Number of entries under `base` matching a `*`-glob path, segment by segment.
 * `require` constrains the FINAL frontier to `"file"` or `"dir"`: the module
 * header's contract is that "a `*` glob resolves when at least one FILE
 * matches", and counting every entry let `foo/*.ts` resolve through a
 * DIRECTORY named `x.ts` — while a glob with a trailing slash, which asks for
 * a directory, accepted a file (audit R2 #173).
 *
 * A segment holding no `*` is PATH ARITHMETIC, not a directory entry: `readdir`
 * never lists `.` or `..`, so an anchored glob (`./foo/*.ts`, `../foo/*.ts`)
 * matched nothing at its very first segment and could never resolve
 * (audit R2 #172).
 */
export function globHits(fs, base, pattern, { require } = {}) {
  let frontier = [posix.normalize(base)];
  for (const seg of pattern.split("/").filter(Boolean)) {
    const next = [];
    if (seg.includes("*")) {
      const re = new RegExp(`^${seg.split("*").map(escapeRe).join(".*")}$`);
      for (const dir of frontier) {
        if (!fs.isDir(dir)) continue;
        for (const name of fs.listDir(dir)) if (re.test(name)) next.push(posix.join(dir, name));
      }
    } else {
      for (const dir of frontier) {
        const rel = posix.normalize(posix.join(dir, seg));
        if (!escapesRoot(rel) && fs.exists(rel)) next.push(rel);
      }
    }
    frontier = next;
    if (frontier.length === 0) return 0;
  }
  if (require === "file") frontier = frontier.filter((rel) => fs.isFile(rel));
  else if (require === "dir") frontier = frontier.filter((rel) => fs.isDir(rel));
  return frontier.length;
}

const uniq = (xs) => [...new Set(xs)];
const isAnchored = (t) => t.startsWith("./") || t.startsWith("../") || t.startsWith("@/");
/** A normalised path that climbs out of the root — by SEGMENT, so `..config` is an ordinary name. */
const escapesRoot = (rel) => rel === ".." || rel.startsWith("../");

/** Directories a path target is tried against, in the order a reader would. */
export function resolutionBases(target, file, tree) {
  const dir = posix.dirname(file);
  if (target.startsWith("./") || target.startsWith("../")) return [dir];
  if (target.startsWith("@/")) return uniq(["src", tree.dir]);
  const bases = [];
  let d = dir;
  while (true) {
    bases.push(d);
    if (d === tree.dir || d === "." || !d.startsWith(tree.dir)) break;
    d = posix.dirname(d);
  }
  bases.push("src", RUST_ROOT, tree.packageRoot, ".");
  return uniq(bases);
}

function pathExistsAt(fs, base, spec, dirOnly) {
  const rel = posix.normalize(posix.join(base, spec));
  if (escapesRoot(rel)) return false;
  if (dirOnly) return fs.isDir(rel);
  if (fs.exists(rel)) return true;
  return extensionCandidates(spec, dirOnly).some((ext) => fs.isFile(rel + ext));
}

/**
 * The root PACKAGE a module specifier names: `@tauri-apps/api/core` →
 * `@tauri-apps/api`, `yaml/util` → `yaml`. A manifest declares the package,
 * never its subpaths, so an exact-key lookup rejected every deep import a
 * header could legitimately name (audit R2 #175).
 */
function packageRoot(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/**
 * How each brace alternative resolved, weakest LAST: the route reported for the
 * whole target is the one worth knowing about, not whichever alternative
 * happened to come last. A single mutable `via` made the provenance
 * order-dependent, so `{a,b}` where `a` needed the suffix fallback and `b` was
 * a dependency reported "dependency" and hid the trade the header says is
 * reported per run (audit R2 #174).
 */
const VIA_RANK = { tail: 2, dependency: 1, location: 0 };

/**
 * Resolve a path-shaped target. `ctx` is `{ fs, index, deps }`. Returns
 * `{ status: "resolved", via: "location" | "tail" | "dependency" }` or
 * `{ status: "unresolved", reason }`.
 */
export function resolvePathTarget(target, ref, tree, ctx) {
  const dirOnly = target.endsWith("/");
  const routes = ["location"];
  for (const variant of expandBraces(target.replace(/\/+$/, ""))) {
    const spec = variant.startsWith("@/") ? variant.slice(2) : variant;
    const bases = resolutionBases(variant, ref.file, tree);
    const isGlob = spec.includes("*");
    const globRequire = dirOnly ? "dir" : "file";
    if (bases.some((b) => (isGlob ? globHits(ctx.fs, b, spec, { require: globRequire }) > 0 : pathExistsAt(ctx.fs, b, spec, dirOnly)))) continue;
    if (!isGlob && !isAnchored(variant) && ctx.index.hasTail(spec, dirOnly)) {
      routes.push("tail");
      continue;
    }
    if (!dirOnly && !isGlob && (ctx.deps.has(variant) || ctx.deps.has(packageRoot(variant)))) {
      routes.push("dependency");
      continue;
    }
    const what = isGlob ? (dirOnly ? "no directory matches" : "no file matches") : dirOnly ? "no directory" : "no file, directory or dependency";
    return { status: "unresolved", reason: `${what} "${variant}" from ${bases.join(", ")}` };
  }
  return { status: "resolved", via: routes.reduce((a, b) => (VIA_RANK[b] > VIA_RANK[a] ? b : a)) };
}

/** The directory a Rust file's OWN submodules live in. */
export function rustModuleDir(file) {
  const dir = posix.dirname(file);
  return isRustDirFile(file) ? dir : posix.join(dir, stripExtension(posix.basename(file)));
}

/** `a::b::c` → `a/b/c.rs` | `a/b/c/mod.rs` | a directory, under the Rust bases. */
export function resolveRustModuleTarget(target, ref, tree, ctx) {
  const segs = target.split("::").filter(Boolean);
  const modDir = tree.lang === "rust" ? rustModuleDir(ref.file) : posix.dirname(ref.file);
  let bases;
  if (segs[0] === "crate") {
    segs.shift();
    bases = [RUST_ROOT];
  } else if (segs[0] === "self") {
    segs.shift();
    bases = [modDir];
  } else if (segs[0] === "super") {
    let b = modDir;
    while (segs[0] === "super") {
      // `super` climbs one module; it cannot climb out of the crate root, so a
      // chain that would is unresolved rather than a match on whatever
      // repository file happens to sit above `src-tauri/src`.
      if (b === RUST_ROOT || !b.startsWith(`${RUST_ROOT}/`)) {
        return { status: "unresolved", reason: `"${target}": a super:: climbs above ${RUST_ROOT}` };
      }
      segs.shift();
      b = posix.dirname(b);
    }
    bases = [b];
  } else {
    bases = uniq([RUST_ROOT, modDir, posix.dirname(ref.file)]);
  }
  // `crate::`, `self::`, `super::super::` — a qualifier with no module after
  // it names nothing. The empty relative path used to join to the base itself,
  // which is a directory that exists, so a prefix-only target "resolved"
  // (audit R2 #177).
  if (segs.length === 0) {
    return { status: "unresolved", reason: `"${target}": names no module after its qualifier` };
  }
  const rel = segs.join("/");
  const hit = bases.some((b) => {
    const p = posix.normalize(posix.join(b, rel));
    return !escapesRoot(p) && (ctx.fs.isFile(`${p}.rs`) || ctx.fs.isFile(`${p}/mod.rs`) || ctx.fs.isDir(p));
  });
  if (hit) return { status: "resolved", via: "location" };
  return { status: "unresolved", reason: `no module "${target}" (${rel}.rs or ${rel}/mod.rs) under ${bases.join(", ")}` };
}
