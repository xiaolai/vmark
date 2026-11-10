/**
 * Purpose: the feature ledger's measurement primitives — the commands it runs
 *   (`find`, `tokei`) and the counts it takes from them, each failing closed: a
 *   failed command throws rather than becoming an authoritative 0.
 *
 * Code lines come from tokei over an explicit file list; files from ONE `find`
 * enumeration per feature, filtered in JS into the all / code / src / test
 * views, so the columns describe one population.
 *
 * @coordinates-with scripts/gen-feature-ledger.mjs — the generator these measure for
 * @coordinates-with scripts/lib/featureOwnership.mjs — CODE_EXTENSIONS and the test-file rule
 * @module scripts/lib/featureMeasure
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { isCodeFile, isTestFile } from "./featureOwnership.mjs";

const isTest = isTestFile;

/** Run a measurement command; a failure THROWS — `""` from a failed `find` or `git` must never become a count. */
export const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], ...opts });

// Code lines, tests excluded. ONLY executable languages count: `src/locales`
// holds ~26k lines of translation JSON, and counting that as "code" made
// Localization the largest feature in the repo and its test:code ratio 0.02 —
// a data corpus wearing a source-file costume. Data is measured, just not here.
//
// `CODE_LANGS` is the tokei-side spelling of `CODE_EXTENSIONS`: the two MUST
// name the same population, or the code column and the file/test columns
// measure different things — `.js`/`.jsx`/`.mjs`/`.mts` were code to tokei
// and invisible to `find` until they were added.
const CODE_LANGS = new Set(["TypeScript", "Tsx", "JSX", "JavaScript", "Rust"]);
// The extension list and the code-file test are the OWNERSHIP module's, not a
// copy: inventory and ownership must describe one population, and two lists
// could only ever agree by being kept in step by hand.

/**
 * Spine paths as ONE non-overlapping set. `find`, tokei and `git log` all
 * recurse, so `a` listed beside `a/b` counted every file under `a/b` twice
 * (#71). Duplicates and nested entries are dropped, and `./` and a trailing
 * `/` are stripped so one path spelled two ways is one path.
 */
export function normalizePaths(paths) {
  // `path.posix.normalize` collapses `.`, `..` and repeated separators, so
  // `a//b`, `a/./b` and `a/c/../b` are ONE path rather than three that each
  // measure the same files again. A path that normalises to
  // an absolute one, or that climbs out of the repository, is dropped here and
  // reported by `spineShapeErrors` — a measurement rooted outside the tree is
  // not this repository's.
  const clean = [...new Set(paths.map((p) => path.posix.normalize(p).replace(/^(\.\/)+/, "").replace(/\/+$/, "")))];
  return clean.filter((p) => !clean.some((q) => q !== p && p.startsWith(`${q}/`)));
}
/**
 * Code lines via tokei, over an EXPLICIT list of non-test source files.
 * `null` (`--`, not measured) ONLY when tokei is not installed; any other
 * failure throws.
 *
 * tokei used to be handed the feature's DIRECTORIES plus `--exclude *.test.*`
 * &co. That exclusion does not apply to a path named explicitly as a FILE —
 * measured on tokei 15.0.0 — and this spine names test files explicitly
 * (`src-tauri/src/content_search.test.rs` is one of "Find in files"'s paths).
 * So 2,582 lines of test code across five features were counted BOTH as
 * production Code and as Test lines, under a provenance table that says
 * "tests excluded". Passing the files removes the exclusion
 * flags entirely: the population tokei measures IS the population `isTest`
 * left in `srcFiles`, by construction rather than by two rules agreeing.
 */
export function tokeiCode(files, runner = run) {
  if (files.length === 0) return 0;
  let out;
  const where = files.length > 3 ? `${files.slice(0, 3).join(", ")} (+${files.length - 3} more)` : files.join(", ");
  try {
    out = runner("tokei", [...files, "--output", "json"]);
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw new Error(`tokei failed for ${where}: ${err?.stderr || err?.message || err}`);
  }
  let code = 0;
  for (const [lang, v] of Object.entries(JSON.parse(out))) {
    if (lang === "Total" || !CODE_LANGS.has(lang)) continue;
    code += v.code || 0;
    for (const child of v.children ? Object.values(v.children).flat() : []) code += child.stats?.code ?? 0;
  }
  return code;
}

/**
 * Files under `paths`: the `CODE_EXTENSIONS` sources by default, or every file
 * with `{ any: true }`. `cwd` is the tree the relative paths are read against —
 * without it an exported helper could validate one root with `existsSync` and
 * enumerate another with `find`.
 *
 * NUL-delimited, because a newline is a legal character in a filename and
 * splitting on one turned a single such file into two nonexistent paths — which
 * a later `readFileSync` would then blame on the wrong file.
 */
export function listFiles(paths, runner = run, { any = false, cwd } = {}) {
  // ONE enumeration, filtered in JS. `find` used to be run twice per path —
  // once with `-name` predicates for the code view and once without for the
  // all-files view — so the two views were separate measurements of a tree
  // that could change between them, and the extension list lived in `find`
  // argv where nothing else could reuse it.
  const out = runner("find", [...paths, "-type", "f", "-print0"], cwd ? { cwd } : {});
  const all = out ? out.split("\0").filter((f) => f !== "") : [];
  return any ? all : all.filter(isCodeFile);
}

/**
 * Every view of one feature's files, from ONE enumeration: `all` (any file),
 * `code` (the `CODE_EXTENSIONS` sources), `src` (code that is not a test) and
 * `test`. `src` is exactly what tokei is asked to measure, so the Code column
 * and the Src/Test-file columns cannot describe different populations.
 */
export function featureInventory(paths, runner = run, cwd) {
  const all = listFiles(paths, runner, { any: true, ...(cwd ? { cwd } : {}) });
  const code = all.filter(isCodeFile);
  return { all, code, src: code.filter((f) => !isTest(f)), test: code.filter(isTest) };
}

/** Line count the way `wc -l` and check-file-size count: a trailing newline is not an extra line; "" is 0. */
export function countLines(text) {
  if (text === "") return 0;
  const parts = text.split("\n");
  return text.endsWith("\n") ? parts.length - 1 : parts.length;
}
