#!/usr/bin/env node
/**
 * Cross-language IPC contract gate — `pnpm lint:ipc-contract`, in `check:static`.
 *
 * VMark's frontend/backend seam is a set of STRING NAMES. `invoke("foo")` on the
 * TS side and `#[command] fn foo` on the Rust side are matched by the Tauri
 * runtime, so nothing in either compiler can see the join: a renamed Rust
 * command, or one dropped from `generate_handler!`, compiles perfectly on both
 * sides and fails only when a user clicks the thing. That is the entire bug
 * class this gate closes, and it is the only gate in the repo that reads both
 * languages at once.
 *
 * It enforces two properties, both measured at ZERO when it was written
 * (167/167 invoked commands resolve; 179 defined = 179 registered), so it ships
 * as zero-tolerance with NO baseline. Do not add one — a baseline here would be
 * a list of commands known to be broken at runtime.
 *
 *   1. Every literal `invoke("cmd")` names a real `#[command]` fn.
 *   2. Every `#[command]` fn is registered in `generate_handler!`.
 *
 * WHY A TYPESCRIPT AST AND NOT A REGEX. Measured on this repo: `invoke(` has
 * 224 real call sites, 99 of them with type arguments. A textual scan for
 * `invoke(` misses nested generics (`invoke<Record<string, unknown>>(`) because
 * the naive character class stops at the first `>`, and `ast-grep -p 'invoke($$$)'`
 * found 112 of 224 for the same reason. `.claude/rules/50-codebase-conventions.md`
 * already records three rounds of hand-rolled lexing shipping a fresh false
 * negative each time. So: parse.
 *
 * WHY THE RUST SIDE MATCHES TWO ATTRIBUTE SPELLINGS. Both `#[tauri::command]`
 * and the imported short form `#[command]` are live in this crate. Matching only
 * the qualified spelling reports 17 phantom "missing command" findings — that
 * mistake was made and caught while writing this file.
 *
 * WHAT IT DELIBERATELY DOES NOT FAIL ON: a Rust command that no literal
 * `invoke()` names. 10 call sites resolve the name from a `const` or a
 * `const … as const` map (`HOT_EXIT_COMMANDS.CAPTURE`), and MCP/e2e paths reach
 * others, so "never invoked" is not evidence of death. Those are reported under
 * --report only, never as a failure.
 */
import ts from "typescript";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = process.cwd();
const REPORT = process.argv.includes("--report");
const REGISTRY = "src-tauri/src/command_registry.rs";

const fail = (msg, code = 1) => {
  console.error(msg);
  process.exit(code);
};

const find = (dir, names) => {
  const args = [dir, "-type", "f", "("];
  names.forEach((n, i) => {
    if (i) args.push("-o");
    args.push("-name", n);
  });
  args.push(")");
  try {
    const out = execFileSync("find", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
    return out ? out.split("\n") : [];
  } catch {
    return [];
  }
};

// ---------------------------------------------------------------- TS side
const isTsTest = (f) => /\.test\.|\.spec\.|__tests__|\/test\/|\.bench\./.test(f);
const tsFiles = find("src", ["*.ts", "*.tsx"]).filter((f) => !isTsTest(f));
if (tsFiles.length === 0) fail("no TypeScript sources found under src/ — refusing to pass vacuously", 64);

/** command name -> call sites */
const invoked = new Map();
let dynamicSites = 0;

for (const file of tsFiles) {
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

  // `const X = "cmd"` and `const M = { K: "cmd" }` in this file, so a name that
  // is not a literal at the call site can still be resolved when it is trivially
  // constant. Anything less tractable stays unresolved rather than guessed.
  const consts = new Map();
  // `const M = { … } as const` is an AsExpression wrapping the object, not an
  // object — and `as const` is exactly how the real map is written
  // (`HOT_EXIT_COMMANDS.CAPTURE`). Unwrapping is what makes the const-map
  // branch reach the case it exists for; without it the branch is decorative.
  const unwrap = (e) => {
    let cur = e;
    while (cur && (ts.isAsExpression(cur) || ts.isSatisfiesExpression?.(cur) ||
      ts.isTypeAssertionExpression?.(cur) || ts.isParenthesizedExpression(cur))) {
      cur = cur.expression;
    }
    return cur;
  };
  const collect = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const init = unwrap(n.initializer);
      if (ts.isStringLiteralLike(init)) consts.set(n.name.text, init.text);
      else if (ts.isObjectLiteralExpression(init)) {
        for (const p of init.properties) {
          if (!ts.isPropertyAssignment(p)) continue;
          const value = unwrap(p.initializer);
          if (!ts.isStringLiteralLike(value)) continue;
          const key = ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name) ? p.name.text : null;
          if (key) consts.set(`${n.name.text}.${key}`, value.text);
        }
      }
    }
    ts.forEachChild(n, collect);
  };
  collect(sf);

  const walk = (n) => {
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      const callee = ts.isIdentifier(e) ? e.text
        : ts.isPropertyAccessExpression(e) ? e.name.text : null;
      if (callee === "invoke") {
        const a0 = n.arguments[0];
        let name = null;
        if (a0 && ts.isStringLiteralLike(a0)) name = a0.text;
        else if (a0 && ts.isIdentifier(a0)) name = consts.get(a0.text) ?? null;
        else if (a0 && ts.isPropertyAccessExpression(a0) && ts.isIdentifier(a0.expression)) {
          name = consts.get(`${a0.expression.text}.${a0.name.text}`) ?? null;
        }
        const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
        if (name) {
          if (!invoked.has(name)) invoked.set(name, []);
          invoked.get(name).push(`${file}:${line + 1}`);
        } else dynamicSites++;
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
}

// ---------------------------------------------------------------- Rust side
const rsFiles = find("src-tauri/src", ["*.rs"]).filter((f) => !/\.test\.rs$/.test(f));
if (rsFiles.length === 0) fail("no Rust sources found under src-tauri/src — refusing to pass vacuously", 64);

/**
 * Blank out comments, preserving offsets and newlines so line numbers survive.
 *
 * This is load-bearing, not tidiness. `pty.rs` has a module doc comment that
 * mentions "`#[tauri::command]` generates a sibling macro"; scanning raw source
 * matched that PROSE and then bound it to the next `fn` in the file —
 * `session_gone`, an ordinary private helper — and reported it as an
 * unregistered command. The gate's first run failed on its own false positive.
 * Widening the attribute→fn lookahead is what made it reach; the actual defect
 * was reading a comment as code.
 */
const stripComments = (src) => {
  let out = "";
  let i = 0;
  const n = src.length;
  let inStr = null; // '"' | "'" | null
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (inStr) {
      if (c === "\\") { out += "  "; i += 2; continue; }
      if (c === inStr) inStr = null;
      out += c; i++; continue;
    }
    if (c === '"') { inStr = '"'; out += c; i++; continue; }
    if (c === "/" && c2 === "/") {
      while (i < n && src[i] !== "\n") { out += " "; i++; }
      continue;
    }
    if (c === "/" && c2 === "*") {
      let depth = 1; out += "  "; i += 2;
      while (i < n && depth > 0) {
        if (src[i] === "/" && src[i + 1] === "*") { depth++; out += "  "; i += 2; continue; }
        if (src[i] === "*" && src[i + 1] === "/") { depth--; out += "  "; i += 2; continue; }
        out += src[i] === "\n" ? "\n" : " "; i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
};

/** command fn name -> file */
const defined = new Map();
// Line-anchored: a real attribute sits on its own line. Combined with comment
// stripping this is belt and braces — either defence alone would have caught
// the `pty.rs` false positive.
const ATTR = /^[ \t]*#\[(?:tauri::)?command\b[^\]]*\]/gm;
for (const file of rsFiles) {
  const src = stripComments(readFileSync(file, "utf8"));
  let m;
  ATTR.lastIndex = 0;
  while ((m = ATTR.exec(src))) {
    // After stripping, only further attributes may sit between the marker and
    // the fn, so the window is small on purpose: a large one is what let the
    // scan wander into an unrelated function.
    const after = src.slice(m.index + m[0].length, m.index + m[0].length + 400);
    const fn = after.match(/^(?:\s*#\[[^\]]*\])*\s*(?:pub(?:\s*\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z0-9_]+)/);
    if (fn) defined.set(fn[1], path.relative(ROOT, path.resolve(file)));
  }
}

const registryPath = path.join(ROOT, REGISTRY);
if (!existsSync(registryPath)) fail(`${REGISTRY} not found — the registration site moved; update this gate`, 64);
const registrySrc = readFileSync(registryPath, "utf8");
const block = registrySrc.match(/generate_handler!\s*\[([\s\S]*?)\n\s*\]/);
if (!block) fail(`could not parse generate_handler![] out of ${REGISTRY} — refusing to pass`, 64);
const registered = new Set(
  block[1].split(",").map((s) => s.trim().split("::").pop()).filter(Boolean).filter((s) => !s.startsWith("//")),
);
if (registered.size === 0) fail(`generate_handler![] parsed to zero entries — refusing to pass vacuously`, 64);

// ---------------------------------------------------------------- assertions
const missing = [...invoked.keys()].filter((c) => !defined.has(c)).sort();
const unregistered = [...defined.keys()].filter((c) => !registered.has(c)).sort();
const uninvoked = [...defined.keys()].filter((c) => !invoked.has(c)).sort();

if (REPORT) {
  console.log(`TS literal-resolved commands : ${invoked.size}`);
  console.log(`TS unresolved (dynamic) sites: ${dynamicSites}`);
  console.log(`Rust #[command] fns          : ${defined.size}`);
  console.log(`registered in generate_handler!: ${registered.size}`);
  console.log(`\nnot invoked by a resolvable name (${uninvoked.length}) — informational, not a failure:`);
  uninvoked.forEach((c) => console.log(`  ${c}  (${defined.get(c)})`));
}

const problems = [];
for (const c of missing) {
  problems.push(`invoke("${c}") has no #[command] fn of that name\n      first call site: ${invoked.get(c)[0]}`);
}
for (const c of unregistered) {
  problems.push(`#[command] fn ${c} is not in generate_handler![]  (${defined.get(c)})\n      it can never be invoked at runtime`);
}

if (problems.length) {
  console.error(`IPC contract broken — ${problems.length} problem${problems.length === 1 ? "" : "s"}:\n`);
  problems.forEach((p, i) => console.error(`  ${i + 1}. ${p}\n`));
  console.error("These fail at runtime, not at compile time. Fix the name or the registration;");
  console.error("do not add a baseline — a baseline here lists commands known to be broken.");
  process.exit(1);
}

console.log(
  `IPC contract OK — ${invoked.size} invoked commands resolve, ` +
  `${defined.size} defined and registered` +
  (dynamicSites ? `, ${dynamicSites} dynamic call site${dynamicSites === 1 ? "" : "s"} unchecked` : ""),
);
