#!/usr/bin/env node
/**
 * Syntax-aware probes for the plan DoD checkers (scripts/lib/dod-assertions.sh).
 *
 * grep sees text; these see CODE. A `#[path = "x.test.rs"]` inside a block
 * comment, an `it(` on its own line inside a template literal, a
 * `provision::transition` in a doc comment, a journey whose `name:` sits in
 * some other object — each satisfied the line-anchored greps the assertions
 * used to run, and each is exactly the placeholder a DoD checker exists to
 * refuse (audit 20260907 #26, #27, #31, #32). TypeScript and JavaScript go
 * through the TypeScript compiler's parser, the way the repo's other AST
 * gates do (check-ipc-contract, check-mock-boundaries); Rust has no parser in
 * this toolchain, so it gets scripts/lib/rustSource.mjs — comments (nested)
 * and literals blanked before a regex runs, so what it runs over is code.
 * `ts-code-grep` and `rust-code-grep` are the same probe per language, and
 * both take `--keep-strings` for an assertion whose SUBJECT is a literal (an
 * event name, a menu id, an env-var name) rather than an identifier, and
 * `--test-reach` for a TEST file: only the code its runnable cases reach
 * counts, literals included (scripts/lib/dodSyntaxReach.mjs). For Rust,
 * `--target=<os>` judges which cases run for that target, not this host.
 * Every TypeScript/JavaScript probe refuses a file the parser only recovered
 * (`parsesCleanly`): error recovery invents tokens, so malformed code never
 * satisfies a syntax-aware gate.
 *
 * What a probe proves, and what it does not: These probes recognize a
 * documented subset of test registration and evidence-reference forms.
 * Unsupported or ambiguous paths contribute no evidence. They do not prove
 * assertion adequacy or successful execution; the phase gate runs the linked
 * tests separately.
 * `ts-has-test-case` counts the cases a file REGISTERS through the subset
 * dodSyntaxRegister.mjs lists; `--test-reach` keeps what they read and the
 * bodies a supported plain call invokes (dodSyntaxTsReach.mjs; Rust:
 * dodSyntaxRustReach.mjs). A failure names on stderr each form it could not
 * read. `journey-shape` mirrors e2e/run-journeys.mjs's discovery contract
 * (`export default { name, run }`) statically, failing closed on a shape it
 * cannot resolve without executing the module.
 *
 * Usage (exit 0 = the property holds, 1 = it does not, 2 = unreadable input,
 * 64 = usage):
 *   node scripts/dod-syntax.mjs rust-mod-include <module.rs> <x.test.rs>
 *   node scripts/dod-syntax.mjs rust-code-grep [--keep-strings|--test-reach [--target=<os>]] [--ignore-case] <regex> <file.rs>...  (prints matching files)
 *   node scripts/dod-syntax.mjs ts-code-grep [--keep-strings|--test-reach] [--ignore-case] <regex> <file>...
 *   node scripts/dod-syntax.mjs ts-has-test-case <file> [title-substring]
 *   node scripts/dod-syntax.mjs journey-shape <file.mjs>
 *
 * @coordinates-with scripts/lib/dod-assertions.sh — the assertion helpers that call this
 * @coordinates-with scripts/lib/dodSyntaxRust.mjs — the Rust probes
 * @coordinates-with scripts/lib/dodSyntaxTs.mjs — the TypeScript / JavaScript probes
 * @coordinates-with scripts/lib/dodSyntaxJourney.mjs — the journey-shape probe
 * @coordinates-with scripts/lib/dodSyntaxReach.mjs — the `--test-reach` reduction
 * @coordinates-with scripts/lib/dodSyntaxRegister.mjs — the supported registration forms
 * @coordinates-with scripts/lib/rustSource.mjs — the Rust comment/literal lexer
 * @coordinates-with scripts/dod-syntax.test.mjs — the self-test
 * @coordinates-with e2e/run-journeys.mjs — the discovery contract journey-shape mirrors
 * @module scripts/dod-syntax
 */
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import ts from "typescript";
import { rustCodeMatches, rustModIncludes, statelessRe } from "./lib/dodSyntaxRust.mjs";
import { targetNamed } from "./lib/dodSyntaxRustAttrs.mjs";
import { declaredTestCases, parseSource, tsCode } from "./lib/dodSyntaxTs.mjs";
import { journeyShape } from "./lib/dodSyntaxJourney.mjs";
import { rustReachNotes, rustTestReach, tsReachNotes, tsTestReach } from "./lib/dodSyntaxReach.mjs";
import { isMainModule } from "./lib/isMainModule.mjs";

/** The probes, re-exported: this file is the CLI and the one module the self-test imports. */
export { declaredTestCases, journeyShape, parseSource, rustCodeMatches, rustModIncludes, statelessRe, tsCode };

const USAGE =
  "usage: node scripts/dod-syntax.mjs rust-mod-include <module.rs> <x.test.rs>\n" +
  "       node scripts/dod-syntax.mjs rust-code-grep [--keep-strings|--test-reach [--target=<os>]] [--ignore-case] <regex> <file.rs>...\n" +
  "       node scripts/dod-syntax.mjs ts-code-grep [--keep-strings|--test-reach] [--ignore-case] <regex> <file>...\n" +
  "       node scripts/dod-syntax.mjs ts-has-test-case <file> [title-substring]\n" +
  "       node scripts/dod-syntax.mjs journey-shape <file.mjs>";

// ---------------------------------------------------------------- CLI

/** An exit code raised inside `main` — `--serve` must answer it, not die of it. */
class DodExit extends Error {
  constructor(code) {
    super(`exit ${code}`);
    this.code = code;
  }
}

function readOrExit(file) {
  try {
    return readFileSync(file, "utf8");
  } catch (err) {
    console.error(`dod-syntax: cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`);
    throw new DodExit(2);
  }
}

/** `main`, with an unreadable file reported as exit 2 rather than thrown. */
function runOnce(argv) {
  try {
    return main(argv);
  } catch (err) {
    if (err instanceof DodExit) return err.code;
    throw err;
  }
}

/**
 * `--serve`: answer many requests from ONE process. Loading the TypeScript
 * compiler costs ~0.36s, and a DoD phase issues dozens of probes, so one node
 * per probe spent most of a phase starting processes (41 probes, 11s, in the
 * feature-ledger phase 5 — its self-test took eleven minutes and timed out
 * under a parallel gate run). `scripts/lib/dod-assertions.sh` starts one
 * server per shell and falls back to a fresh process when it cannot.
 *
 * Request: one line — the caller's cwd, then argv, joined by U+001F.
 * Reply: `O <line>` per stdout line, `E <line>` per stderr line, then
 * `X <exit code>`. Each request runs with the caller's cwd, so relative paths
 * resolve exactly as they would in a process started there. The argv
 * `--ping` alone is the readiness handshake: `X 0`, cwd untouched, so a
 * caller learns the server is up before it trusts the stream with a probe.
 *
 * `--owner <pid>` (the starting shell's pid): the server exits once that
 * process is gone. End-of-file on stdin is not enough on its own: every
 * background job the shell starts inherits the request pipe's write end, and
 * the server outlived the shell for as long as any of them ran.
 */
async function serve(owner) {
  if (owner !== undefined) {
    setInterval(() => {
      try {
        process.kill(owner, 0);
      } catch (err) {
        if (err?.code === "ESRCH") process.exit(0);
      }
    }, 1000).unref();
  }
  const tagged = (tag, lines) => lines.flatMap((l) => String(l).split("\n")).map((l) => `${tag}\t${l}\n`).join("");
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    const [cwd, ...argv] = line.split("\u001f");
    if (argv.length === 1 && argv[0] === "--ping") {
      process.stdout.write("X\t0\n");
      continue;
    }
    const out = [];
    const err = [];
    const { log, error } = console;
    console.log = (...a) => out.push(a.join(" "));
    console.error = (...a) => err.push(a.join(" "));
    let code;
    try {
      process.chdir(cwd);
      code = runOnce(argv);
    } catch (e) {
      err.push(e instanceof Error ? e.message : String(e));
      code = 70;
    } finally {
      console.log = log;
      console.error = error;
    }
    process.stdout.write(`${tagged("O", out)}${tagged("E", err)}X\t${code}\n`);
  }
}

const GREP_FLAGS = new Set(["--keep-strings", "--test-reach", "--ignore-case"]);

/**
 * The `[--keep-strings|--test-reach [--target=<os>]] [--ignore-case] <pattern> <file…>`
 * shape both grep subcommands take (flags in any order, each at most once;
 * the text modes exclude each other; a target needs `--test-reach` and one
 * of `TARGETS`): `{ keepStrings, testReach, target, re, files }`, or
 * `{ usage: true }` / `{ badPattern }`. ONE parser, because two copies are how
 * the `lastIndex` defect (see `statelessRe`) reached both branches at once.
 */
function grepArgs(rest) {
  const flags = new Set();
  let i = 0;
  let target;
  for (; GREP_FLAGS.has(rest[i]) || rest[i]?.startsWith("--target="); i++) {
    const key = rest[i].split("=")[0];
    if (flags.has(key)) return { usage: true };
    flags.add(key);
    if (key === "--target") target = targetNamed(rest[i].slice("--target=".length)) ?? null;
  }
  const [pattern, ...files] = rest.slice(i);
  if (!pattern || files.length === 0) return { usage: true };
  const keepStrings = flags.has("--keep-strings");
  const testReach = flags.has("--test-reach");
  if ((keepStrings && testReach) || target === null || (target && !testReach)) return { usage: true };
  try {
    return { keepStrings, testReach, target, re: statelessRe(new RegExp(pattern, flags.has("--ignore-case") ? "i" : "")), files };
  } catch (err) {
    return { badPattern: `dod-syntax: invalid pattern ${JSON.stringify(pattern)}: ${err.message}` };
  }
}

/**
 * True when the parser read `sf` without error; otherwise names the first
 * diagnostic on stderr. A file the parser only RECOVERED is not code: error
 * recovery invents the missing tokens, so whatever survives in it — a symbol,
 * a test case — is a guess, and no syntax-aware probe may count it.
 */
function parsesCleanly(file, sf) {
  if (sf.parseDiagnostics.length === 0) return true;
  console.error(`${file}: does not parse: ${ts.flattenDiagnosticMessageText(sf.parseDiagnostics[0].messageText, " ")}`);
  return false;
}

/** True when `matched`; otherwise names on stderr each form in `file` the probe could not read. */
function explained(file, matched, notes) {
  if (!matched) for (const n of notes()) console.error(`${file}: no evidence from ${n}`);
  return matched;
}

/** Report the matching files; exit 0 when at least one matched, 1 otherwise. */
function reportHits(hits) {
  for (const h of hits) console.log(h);
  return hits.length > 0 ? 0 : 1;
}

export function main(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "rust-mod-include": {
      const [mod, base] = rest;
      if (!mod || !base || rest.length !== 2) break;
      if (rustModIncludes(readOrExit(mod), base)) return 0;
      console.error(`${mod}: no active #[path = "${base}"] followed by \`mod …;\` outside comments`);
      return 1;
    }
    case "rust-code-grep": {
      const args = grepArgs(rest);
      if (args.usage) break;
      if (args.badPattern) {
        console.error(args.badPattern);
        return 64;
      }
      return reportHits(
        args.files.filter((f) => {
          const source = readOrExit(f);
          if (!args.testReach) return rustCodeMatches(source, args.re, { keepStrings: args.keepStrings });
          return explained(f, args.re.test(rustTestReach(source, args.target)), () => rustReachNotes(source, args.target));
        }),
      );
    }
    case "ts-code-grep": {
      const args = grepArgs(rest);
      if (args.usage || args.target) break;
      if (args.badPattern) {
        console.error(args.badPattern);
        return 64;
      }
      return reportHits(
        args.files.filter((f) => {
          const source = readOrExit(f);
          const sf = parseSource(f, source);
          if (!parsesCleanly(f, sf)) return false;
          if (!args.testReach) return args.re.test(tsCode(sf, source, { keepStrings: args.keepStrings }));
          return explained(f, args.re.test(tsTestReach(sf, source)), () => tsReachNotes(sf));
        }),
      );
    }
    case "ts-has-test-case": {
      const [file, titleIncludes] = rest;
      if (!file || rest.length < 1 || rest.length > 2) break;
      const sf = parseSource(file, readOrExit(file));
      if (!parsesCleanly(file, sf)) return 1;
      if (declaredTestCases(sf, { titleIncludes }) > 0) return 0;
      const what = titleIncludes === undefined ? "" : ` whose title contains ${JSON.stringify(titleIncludes)}`;
      console.error(
        `${file}: declares no runnable it()/test() case${what} ` +
          "(a title with no handler, a comment, a string, skip and todo do not count)",
      );
      for (const n of tsReachNotes(sf, { titleIncludes })) console.error(`${file}: not counted: ${n}`);
      return 1;
    }
    case "journey-shape": {
      const [file] = rest;
      if (!file || rest.length !== 1) break;
      const r = journeyShape(parseSource(file, readOrExit(file)));
      if (r.ok) return 0;
      console.error(`${file}: ${r.reason}`);
      return 1;
    }
    default:
      break;
  }
  console.error(USAGE);
  return 64;
}

if (isMainModule(import.meta.url)) {
  const [cmd, flag, pid, ...extra] = process.argv.slice(2);
  if (cmd === "--serve") {
    const owner = flag === "--owner" ? Number(pid) : undefined;
    if ((flag !== undefined && !(Number.isInteger(owner) && owner > 0)) || extra.length > 0) {
      console.error("usage: node scripts/dod-syntax.mjs --serve [--owner <pid>]");
      process.exit(64);
    }
    await serve(owner);
  } else process.exit(runOnce(process.argv.slice(2)));
}
