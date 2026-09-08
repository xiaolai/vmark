// Audit 20260907 #26/#27/#31/#32 — the syntax-aware probes behind the DoD
// assertion helpers, and the Rust lexer they and the keybinding gate share.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rustCode, rustSpans } from "./lib/rustSource.mjs";
import { declaredTestCases, journeyShape, parseSource, rustCodeMatches, rustModIncludes, statelessRe, tsCode } from "./dod-syntax.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO, "scripts", "dod-syntax.mjs");

const cases = (file, src) => declaredTestCases(parseSource(file, src));
const shape = (src) => journeyShape(parseSource("j.mjs", src));

describe("rustCode — comments and literals blanked, newlines kept", () => {
  it("blanks line comments, nested block comments and doc comments, keeping every newline", () => {
    const src = "a // one\n/* two /* nested */ still */ b\n//! doc\nc";
    expect(rustCode(src)).toBe("a       \n                             b\n       \nc");
    expect(rustCode(src).split("\n").length).toBe(src.split("\n").length);
  });

  it("blanks string, byte, raw and char literals but not lifetimes", () => {
    const src = String.raw`let s = "a\"b"; let b = b"x"; let r = r#"q"q"#; let c = '\''; let d = 'x'; fn f<'a>(x: &'a str) {}`;
    const out = rustCode(src);
    expect(out).not.toContain("a\\\"b");
    expect(out).not.toContain('q"q');
    expect(out).toContain("fn f<'a>(x: &'a str) {}");
    expect(out.length).toBe(src.length);
  });

  it("keeps literals when asked, still blanking comments", () => {
    const src = '#[path = "x.test.rs"] // include\nmod t;';
    expect(rustCode(src, { keepStrings: true })).toBe('#[path = "x.test.rs"]           \nmod t;');
  });

  it("does not mistake an identifier ending in r for a raw string", () => {
    expect(rustCode('let bar = 1; let r = bar"x";')).toBe('let bar = 1; let r = bar   ;');
  });

  // audit R2 #191 — `cr"…"` / `cr#"…"#` are C string literals (Rust 1.77).
  // Unrecognised, `cr#"…"#` was read as an ordinary `"` string, so an
  // unescaped quote inside it ended the literal and the rest became "code".
  it("blanks C string literals, raw and not", () => {
    const src = String.raw`let a = cr#"// not a comment "q" here"#; let b = c"x"; fn f() {}`;
    const out = rustCode(src);
    expect(out).not.toContain("not a comment");
    expect(out).not.toContain('"q"');
    expect(out).toContain("fn f() {}");
    expect(out.length).toBe(src.length);
  });

  // audit R2 #192 — the header claims any number of `#`; the 16-unit slice
  // this replaced stopped seeing the delimiter past 14 (13 for `br`).
  it("reads a raw-string delimiter with more hashes than a fixed window holds", () => {
    const hashes = "#".repeat(20);
    const src = `let s = r${hashes}"/* not a comment */"${hashes}; fn f() {}`;
    const out = rustCode(src);
    expect(out).not.toContain("not a comment");
    expect(out).toContain("fn f() {}");
    expect(out.length).toBe(src.length);
  });

  // audit R3 #193 — a char literal's body is one Unicode SCALAR, not one
  // UTF-16 unit. `'😀'` is two units, so a `src[i + 2] === "'"` test read it as
  // a LIFETIME and left the literal unblanked: its contents, and the closing
  // quote, then counted as code for every probe built on this lexer.
  it("blanks an astral char literal instead of reading it as a lifetime", () => {
    const src = "let a = '😀'; let b = \"kept\"; fn f<'a>(x: &'a str) {}";
    const out = rustCode(src);
    expect(out).not.toContain("😀");
    expect(out).toContain("fn f<'a>(x: &'a str) {}");
    expect(out.length).toBe(src.length);
    // The quote after the emoji closed the literal, so it cannot open a new one.
    expect(rustCode("let a = '😀'; let s = \"/* not a comment */\"; fn f() {}")).toContain("fn f() {}");
  });
});

describe("rustSpans — the tokenizer both consumers share", () => {
  const kinds = (src) => [...rustSpans(src)].map((s) => `${s.kind}:${src.slice(s.start, s.end)}`);

  it("yields every comment and literal in source order, with offsets that slice back", () => {
    const src = 'let s = "a"; // c\nlet t = \'x\';';
    expect(kinds(src)).toEqual(['string:"a"', "comment:// c", "char:'x'"]);
  });

  // The keybinding gate reads accelerators out of these values, so the decode
  // is part of the contract: a backslash takes the FOLLOWING character
  // literally, exactly as the Rust contract test's own read_string does.
  it("decodes a string's escapes the way the Rust contract mirror reads them", () => {
    const spans = [...rustSpans(String.raw`"a\"b\\c\n"`)];
    expect(spans.map((s) => s.value)).toEqual(['a"b\\cn']);
  });

  it("gives a raw string's body verbatim, escapes and all", () => {
    expect([...rustSpans(String.raw`r#"a"b\n"#`)].map((s) => s.value)).toEqual([String.raw`a"b\n`]);
  });

  // audit R3 #58/#59 — the three forms the gate's private lexer did not know.
  // Each one used to swallow the rest of the file: a nested comment closed
  // early, a raw string's inner quote opened a string, and `'"'` opened one too.
  it("does not lose the tail of a file to a nested comment, a raw string or a quote char", () => {
    for (const prefix of ["/* /* x */ still */", String.raw`r#"a"b"#`, `'"'`]) {
      const src = `${prefix} let s = "tail";`;
      expect(kinds(src)).toContain('string:"tail"');
    }
  });
});

describe("rust-mod-include", () => {
  it("accepts an active #[path] + mod include, with cfg attributes around it, on one line or several", () => {
    expect(rustModIncludes('#[cfg(test)]\n#[path = "commands.test.rs"]\nmod tests;\n', "commands.test.rs")).toBe(true);
    expect(rustModIncludes('#[cfg(test)] #[path = "commands.test.rs"] mod tests;\n', "commands.test.rs")).toBe(true);
    expect(rustModIncludes('#[path = "commands.test.rs"]\n#[cfg(test)]\npub(crate) mod tests;\n', "commands.test.rs")).toBe(true);
  });

  it.each([
    ["a // comment", '// #[path = "commands.test.rs"]\n// mod tests;\n'],
    ["a /* block comment */", '/*\n#[path = "commands.test.rs"]\nmod tests;\n*/\n'],
    ["no mod under it", '#[cfg(test)]\n#[path = "commands.test.rs"]\n'],
    ["an unrelated item between the attribute and a nearby mod", '#[path = "commands.test.rs"]\nfn helper() {}\nmod tests;\n'],
    ["another file's path", '#[path = "other.test.rs"]\nmod tests;\n'],
    ["the attribute inside a string", 'const S: &str = "#[path = \\"commands.test.rs\\"] mod tests;";\n'],
    // The escaped `\"` above breaks the regex by luck; a RAW string quotes the
    // snippet verbatim and matched until blanked source told code from literal.
    ["the whole include quoted in a raw string", String.raw`const S: &str = r#"#[path = "commands.test.rs"] mod tests;"#;` + "\n"],
    ["a cfg(any()) gate before the attribute", '#[cfg(any())]\n#[path = "commands.test.rs"]\nmod tests;\n'],
    ["a cfg(any()) gate between the attribute and the mod", '#[path = "commands.test.rs"]\n#[cfg(any())]\nmod tests;\n'],
    ["a feature gate this probe cannot evaluate", '#[cfg(feature = "slow")]\n#[path = "commands.test.rs"]\nmod tests;\n'],
  ])("rejects %s", (_label, src) => {
    expect(rustModIncludes(src, "commands.test.rs")).toBe(false);
  });

  it("accepts a non-cfg attribute on the item — only a cfg gate makes the include conditional", () => {
    expect(rustModIncludes('#[allow(dead_code)]\n#[cfg(test)]\n#[path = "commands.test.rs"]\nmod tests;\n', "commands.test.rs")).toBe(true);
    expect(rustModIncludes('#[path = "commands.test.rs"]\n#[rustfmt::skip]\nmod tests;\n', "commands.test.rs")).toBe(true);
  });

  it("finds a real include that follows a quoted decoy in the same file", () => {
    const src = String.raw`const S: &str = r#"#[path = "commands.test.rs"] mod decoy;"#;` + '\n#[cfg(test)]\n#[path = "commands.test.rs"]\nmod tests;\n';
    expect(rustModIncludes(src, "commands.test.rs")).toBe(true);
  });
});

describe("rust-code-grep", () => {
  const re = /provision::(transition|verify_checksum)/;
  it("matches a call site in code and not the same text in a comment or a string", () => {
    expect(rustCodeMatches("let next = provision::transition(&s, e);\n", re)).toBe(true);
    expect(rustCodeMatches("// let next = provision::transition(&s, e);\n", re)).toBe(false);
    expect(rustCodeMatches("/// Calls provision::verify_checksum later.\nfn f() {}\n", re)).toBe(false);
    expect(rustCodeMatches('log::info!("provision::transition ran");\n', re)).toBe(false);
  });
});

// audit R3 #111 — `RegExp.test` on a global/sticky regex advances `lastIndex`
// and resumes there, so ONE regex reused across a file list gives a
// position-dependent answer: a later file that DOES match is reported as no
// match. A silent false negative, in a probe whose only job is to report one.
describe("stateless regexes", () => {
  it("drops g/y so a reused regex cannot skip a later match", () => {
    expect(statelessRe(/a/gy).flags).toBe("");
    expect(statelessRe(/a/gim).flags).toBe("im");
    // Identity when there is nothing to strip — no needless allocation.
    const plain = /a/i;
    expect(statelessRe(plain)).toBe(plain);
  });

  it("reports the same answer however many times it is asked", () => {
    const re = /provision::transition/g;
    const src = "let next = provision::transition(&s, e);\n";
    expect(rustCodeMatches(src, re)).toBe(true);
    expect(rustCodeMatches(src, re)).toBe(true);
    expect(rustCodeMatches(src, re)).toBe(true);
  });

  it("does not leave the caller's regex advanced", () => {
    const re = /provision::transition/g;
    rustCodeMatches("let next = provision::transition(&s, e);\n", re);
    expect(re.lastIndex).toBe(0);
  });
});

describe("ts-has-test-case", () => {
  it("counts it()/test() calls with a title, including the case it.each returns, once each", () => {
    expect(cases("a.test.ts", 'it("a", () => {});\ntest("b", () => {});\n')).toBe(2);
    expect(cases("a.test.ts", 'it.each([[1], [2]])("case %s", () => {});\n')).toBe(1);
    expect(cases("a.test.ts", 'describe("d", () => { it.only(`t ${1}`, () => {}); });\n')).toBe(1);
    expect(cases("a.test.mjs", 'import { it } from "vitest";\nit("pins", () => {});\n')).toBe(1);
    expect(cases("a.test.tsx", 'it("renders", () => { render(<A />); });\n')).toBe(1);
  });

  it.each([
    ["a line comment", '// it("planned", () => {});\n'],
    ["a block comment spanning lines", '/*\nit("planned", () => {});\ntest("later", () => {});\n*/\n'],
    ["a string", "const note = 'see it(\"x\")';\n"],
    ["a template literal spanning lines", 'const s = `\nit("x", () => {});\n`;\n'],
    ["it.skip / it.todo", 'it.skip("a", () => {});\nit.todo("b");\n'],
    ["a describe.skip suite", 'describe.skip("d", () => { it("a", () => {}); });\n'],
    ["a non-test identifier", 'unit("a", () => {});\nitem("b", () => {});\n'],
    ["an empty file", ""],
    // audit R2 #112 — a title alone registers a todo, not a runnable case.
    ["a title with no handler", 'it("planned");\n'],
    ["a handler that is literally undefined", 'test("planned", undefined);\n'],
    ["a handler that is a literal", 'it("planned", 42);\nit("also", "nope");\n'],
    // audit R2 #113 — a locally declared `it` is not vitest's.
    ["a locally shadowed it", 'const it = (t, f) => t;\nit("looks real", () => {});\n'],
    ["a locally shadowed test function", 'function test(t, f) { return t; }\ntest("looks real", () => {});\n'],
  ])("does not count a case in %s", (_label, src) => {
    expect(cases("a.test.ts", src)).toBe(0);
  });

  it("still counts the option-object form, which puts the handler third", () => {
    expect(cases("a.test.ts", 'it("slow", { timeout: 5000 }, async () => {});\n')).toBe(1);
    expect(cases("a.test.ts", "it(\"named\", handler);\n")).toBe(1);
  });

  // audit R2 #79 — a DoD assertion that names a test by TITLE must not be
  // satisfied by a skipped one, a commented one, or one with no handler.
  it("filters by title when one is given", () => {
    const src = 'it("read is denied", () => {});\nit.skip("write is denied", () => {});\nit("other", () => {});\n';
    const count = (t) => declaredTestCases(parseSource("a.test.ts", src), { titleIncludes: t });
    expect(count("read is denied")).toBe(1);
    expect(count("write is denied")).toBe(0);
    expect(count("absent")).toBe(0);
  });
});

// audit R2 #44 — a DoD assertion whose subject is a symbol in TypeScript was a
// plain grep, so a doc comment naming it, or a commented-out line, satisfied it.
describe("ts-code-grep / tsCode", () => {
  const code = (src, opts) => tsCode(parseSource("a.ts", src), src, opts);

  it("blanks comments and literals, keeping offsets and newlines", () => {
    const src = 'const a = "wired";\n// wired\n/* wired */\nconst b = wired();\n';
    const out = code(src);
    expect(out.length).toBe(src.length);
    expect(out.split("\n").length).toBe(src.split("\n").length);
    expect(out.match(/wired/g)).toEqual(["wired"]); // only the call survives
  });

  it("keeps string literals when the subject IS one", () => {
    const src = 'window.addEventListener("use-selection-for-find", h);\n// use-selection-for-find\n';
    expect(code(src, { keepStrings: true }).match(/use-selection-for-find/g)).toHaveLength(1);
    expect(code(src)).not.toMatch(/use-selection-for-find/);
  });

  it("does not read a comment marker out of a regex or a nested template", () => {
    const src = "const re = /a\\/\\/b/;\nconst t = `x${[`y`].length}// not a comment`;\nconst live = keepMe();\n";
    expect(code(src)).toMatch(/keepMe\(\)/);
  });

  it("exits 1 when the symbol is only in a comment, 0 when it is code", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dod-syntax-ts-"));
    const commented = path.join(dir, "commented.ts");
    writeFileSync(commented, "// clearHistory is planned\nexport const x = 1;\n");
    const live = path.join(dir, "live.ts");
    writeFileSync(live, "export function clearHistory() {}\n");
    const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
    expect(run("ts-code-grep", "clearHistory", commented).status).toBe(1);
    expect(run("ts-code-grep", "clearHistory", live).status).toBe(0);
    expect(run("ts-code-grep", "(unclosed", live).status).toBe(64);
  });
});

describe("journey-shape", () => {
  it("accepts the shipped shape, a top-level const, and run as an arrow or a named function", () => {
    expect(shape('export default {\n  name: "j",\n  async run(client, ctx) {},\n};\n').ok).toBe(true);
    expect(shape('const journey = { name: "j", run: async () => {} };\nexport default journey;\n').ok).toBe(true);
    expect(shape('async function run() {}\nexport default { name: "j", run };\n').ok).toBe(true);
  });

  it.each([
    ["an empty placeholder", "placeholder\n", /does not parse|no `export default`/],
    ["no default export", 'export const name = "j";\n', /no `export default`/],
    ["a name in another object", 'export default { run() {} };\nconst other = { name: "j" };\n', /`name`/],
    ["an empty name", 'export default { name: "", run() {} };\n', /`name`/],
    ["a computed name", 'const n = "j";\nexport default { name: n, run() {} };\n', /`name`/],
    ["run that is not a function", 'export default { name: "j", run: 42 };\n', /`run`/],
    ["run only in a comment", 'export default {\n  name: "j",\n  // async run(client) {},\n};\n', /`run`/],
    // audit R2 #115 — a `let` can be reassigned after the literal, and an
    // object can be mutated, so neither is what the runner imports.
    ["a let binding", 'let journey = { name: "j", run() {} };\njourney = { name: "", run: 1 };\nexport default journey;\n', /object literal/],
    ["a mutated const", 'const journey = { name: "j", run() {} };\njourney.run = 42;\nexport default journey;\n', /mutated/],
    // audit R2 #116 — JavaScript keeps the LAST property, and a spread can
    // override one that is right there in the source.
    ["a duplicated name where the last one is empty", 'export default { name: "j", run() {}, name: "" };\n', /`name`/],
    ["a spread that may override name", 'export default { name: "j", run() {}, ...override };\n', /spread/],
    ["a computed key that may override run", 'export default { name: "j", run() {}, [k]: 1 };\n', /computed key/],
  ])("rejects %s with a reason", (_label, src, reason) => {
    const r = shape(src);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(reason);
  });

  it("the two real journeys the plan names are discoverable", () => {
    for (const f of ["e2e/journeys/38-export-html-to-disk.mjs", "e2e/journeys/39-knowledge-base-runtime-state.mjs"]) {
      const res = spawnSync(process.execPath, [SCRIPT, "journey-shape", path.join(REPO, f)], { encoding: "utf8" });
      expect(res.status, res.stderr).toBe(0);
    }
  });
});

describe("the CLI", () => {
  it("exits 64 on usage errors, 2 on an unreadable file, and 1/0 on the property", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dod-syntax-"));
    const mod = path.join(dir, "m.rs");
    writeFileSync(mod, '#[path = "m.test.rs"]\nmod tests;\n');
    const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
    expect(run().status).toBe(64);
    expect(run("bogus", mod).status).toBe(64);
    expect(run("rust-mod-include", mod).status).toBe(64);
    expect(run("rust-mod-include", path.join(dir, "missing.rs"), "m.test.rs").status).toBe(2);
    expect(run("rust-mod-include", mod, "m.test.rs").status).toBe(0);
    expect(run("rust-mod-include", mod, "other.test.rs").status).toBe(1);
    const call = path.join(dir, "call.rs");
    writeFileSync(call, "fn f() { provision::transition(); }\n");
    const grep = run("rust-code-grep", "provision::transition", mod, call);
    expect(grep.status).toBe(0);
    expect(grep.stdout.trim()).toBe(call);
    expect(run("rust-code-grep", "(unclosed", call).status).toBe(64);
    // audit R2 #47 — a probe whose subject IS a literal needs --keep-strings.
    const env = path.join(dir, "env.rs");
    writeFileSync(env, 'fn f() { let _ = std::env::var("DBUS_SESSION_BUS_ADDRESS"); }\n');
    expect(run("rust-code-grep", "DBUS_SESSION_BUS_ADDRESS", env).status).toBe(1);
    expect(run("rust-code-grep", "--keep-strings", 'var\\("DBUS_SESSION_BUS_ADDRESS"\\)', env).status).toBe(0);
    const quoted = path.join(dir, "quoted.rs");
    writeFileSync(quoted, '// let _ = std::env::var("DBUS_SESSION_BUS_ADDRESS");\n');
    expect(run("rust-code-grep", "--keep-strings", "DBUS_SESSION_BUS_ADDRESS", quoted).status).toBe(1);
  });

  // audit R2 #118 — the parser RECOVERS from a syntax error and invents nodes,
  // so counting cases in a file that does not parse counts a guess.
  it("refuses a TS file that does not parse instead of counting recovered nodes", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dod-syntax-parse-"));
    const broken = path.join(dir, "broken.test.ts");
    writeFileSync(broken, 'it("real", () => {});\nfunction (\n');
    const res = spawnSync(process.execPath, [SCRIPT, "ts-has-test-case", broken], { encoding: "utf8" });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/does not parse/);
  });

  it("takes an optional title substring and reports which title it wanted", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dod-syntax-title-"));
    const file = path.join(dir, "t.test.ts");
    writeFileSync(file, 'it("read is denied", () => {});\nit.skip("write is denied", () => {});\n');
    const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
    expect(run("ts-has-test-case", file, "read is denied").status).toBe(0);
    expect(run("ts-has-test-case", file, "write is denied").status).toBe(1);
    expect(run("ts-has-test-case", file, "write is denied").stderr).toMatch(/whose title contains/);
    expect(run("ts-has-test-case", file, "a", "b").status).toBe(64);
  });
});
