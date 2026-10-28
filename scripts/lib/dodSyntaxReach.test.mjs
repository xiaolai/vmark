// The test-reach reduction behind `dod-syntax.mjs --test-reach`: a test file
// reduced to the code its runnable cases reach, resolved by binding (scope),
// not by name, so a same-named helper nothing calls stays blank.
import { describe, expect, it } from "vitest";
import { rustTestReach, tsTestReach } from "./dodSyntaxReach.mjs";
import { declaredTestCases, parseSource } from "./dodSyntaxTs.mjs";

const tsReach = (src, file = "a.test.ts") => tsTestReach(parseSource(file, src), src);

describe("tsTestReach resolves a name to the binding in scope", () => {
  it("a nested helper that shares a reached helper's name is not reached", () => {
    const out = tsReach([
      'function helper() { return "used"; }',
      'function other() { function helper() { return "stale"; } return helper; }',
      'it("t", () => { void helper(); });',
      "",
    ].join("\n"));
    expect(out).toContain('"used"');
    expect(out).not.toContain("stale");
  });

  it("a case's own local shadows the file-level declaration of the same name", () => {
    const out = tsReach('const label = "stale";\nit("t", () => { const label = "cjk"; void label; });\n');
    expect(out).toContain('"cjk"');
    expect(out).not.toContain("stale");
  });

  it("a shorthand property and a JS file still reach their declaration", () => {
    const src = 'const fixture = "cjk";\nit("t", () => { void { fixture }; });\n';
    expect(tsReach(src)).toContain('"cjk"');
    expect(tsReach(src, "a.test.mjs")).toContain('"cjk"');
  });

  it("a helper reached through another helper is reached transitively", () => {
    const out = tsReach('const inner = () => "rtl";\nconst outer = () => inner();\nit("t", () => { outer(); });\n');
    expect(out).toContain('"rtl"');
  });
});

describe("rustTestReach resolves a name to the item in scope", () => {
  it("a fn nested in another fn does not answer for a module-level call of its name", () => {
    const out = rustTestReach([
      'fn helper() -> &\'static str { "used" }',
      'fn unrelated() { fn helper() -> &\'static str { "stale" } let _ = helper(); }',
      "#[test]\nfn t() { let _ = helper(); }",
      "",
    ].join("\n"));
    expect(out).toContain('"used"');
    expect(out).not.toContain("stale");
  });

  it("an item in a module the test is not in is not reached by its bare name", () => {
    const out = rustTestReach([
      'mod other { pub fn helper() -> &\'static str { "stale" } }',
      'fn helper() -> &\'static str { "used" }',
      "#[test]\nfn t() { let _ = helper(); }",
      "",
    ].join("\n"));
    expect(out).toContain('"used"');
    expect(out).not.toContain("stale");
  });

  it("a path into a module, and a name only another module declares, are still reached", () => {
    const out = rustTestReach([
      'mod a { pub fn helper() -> &\'static str { "cjk" } }',
      'mod b { pub fn only_here() -> &\'static str { "rtl" } }',
      'fn helper() -> &\'static str { "used" }',
      "mod tests { use super::b::only_here;\n#[test]\nfn t() { let _ = a::helper(); let _ = only_here(); } }",
      "",
    ].join("\n"));
    expect(out).toContain('"cjk"');
    expect(out).toContain('"rtl"');
  });

  it("inside the test module, its own helper shadows the parent's", () => {
    const out = rustTestReach([
      'fn helper() -> &\'static str { "stale" }',
      'mod tests { fn helper() -> &\'static str { "used" }\n#[test]\nfn t() { let _ = helper(); } }',
      "",
    ].join("\n"));
    expect(out).toContain('"used"');
    expect(out).not.toContain("stale");
  });
});

describe("rustTestReach resolves a path by its qualifier and a bare name past local bindings", () => {
  const rust = (...l) => rustTestReach(`${l.join("\n")}\n`);
  const fnStr = (name, text, vis = "") => `${vis}fn ${name}() -> &'static str { "${text}" }`;

  it.each([
    ["a path into one module", [`mod a { ${fnStr("helper", "used", "pub ")} }`, `mod b { ${fnStr("helper", "stale", "pub ")} }`, fnStr("helper", "stale"), "#[test]\nfn t() { let _ = a::helper(); }"]],
    ["a self:: path", [fnStr("helper", "used"), `mod b { ${fnStr("helper", "stale", "pub ")} }`, "#[test]\nfn t() { let _ = self::helper(); }"]],
    ["a super:: path from the test module", [fnStr("helper", "used"), `mod b { ${fnStr("helper", "stale", "pub ")} }`, `mod tests { ${fnStr("helper", "stale")}\n#[test]\nfn t() { let _ = super::helper(); } }`]],
    ["a crate:: path into a nested module", [`mod a { pub mod inner { ${fnStr("helper", "used", "pub ")} } ${fnStr("helper", "stale", "pub ")} }`, "#[test]\nfn t() { let _ = crate::a::inner::helper(); }"]],
    ["a type path to an associated fn", [fnStr("new", "stale"), `struct Foo; impl Foo { ${fnStr("new", "used")} }`, `struct Bar; impl Bar { ${fnStr("new", "stale")} }`, "#[test]\nfn t() { let _ = Foo::new(); }"]],
    ["a Self:: path inside an impl", [fnStr("make", "stale"), `struct Foo; impl Foo { ${fnStr("make", "used")} fn go() { let _ = Self::make(); } }`, "#[test]\nfn t() { Foo::go(); }"]],
    ["a use-imported name", [`mod a { ${fnStr("helper", "used", "pub ")} }`, `mod b { ${fnStr("helper", "stale", "pub ")} }`, "mod tests { use super::a::helper;\n#[test]\nfn t() { let _ = helper(); } }"]],
    ["a glob-imported name", [`mod a { ${fnStr("only", "used", "pub ")} }`, `mod b { ${fnStr("only", "stale", "pub ")} }`, "mod tests { use super::a::*;\n#[test]\nfn t() { let _ = only(); } }"]],
    ["a renamed import", [`mod a { ${fnStr("helper", "used", "pub ")} }`, `mod b { ${fnStr("other", "stale", "pub ")} }`, "mod tests { use super::a::{helper as other};\n#[test]\nfn t() { let _ = other(); } }"]],
  ])("reaches only the item %s names", (_how, src) => {
    const out = rust(...src);
    expect(out).toContain('"used"');
    expect(out).not.toContain("stale");
  });

  it.each([
    ["a let binding", "#[test]\nfn t() { let helper = 1; let _ = helper; }"],
    ["a let mut binding in a tuple pattern", "#[test]\nfn t() { let (mut helper, _x) = (1, 2); helper += 1; }"],
    ["an if-let binding", "#[test]\nfn t() { if let Some(helper) = Some(1) { let _ = helper; } }"],
    ["a closure parameter", "#[test]\nfn t() { let f = |helper: u8| helper + 1; let _ = f(1); }"],
    ["a for-loop binding", "#[test]\nfn t() { for helper in 0..2 { let _ = helper; } }"],
    ["a fn parameter", "#[test]\nfn t() { check(1); }\nfn check(helper: u8) -> u8 { helper }"],
    ["a match-arm binding", "#[test]\nfn t() { let f: Option<fn() -> u8> = None; match f { Some(helper) => { helper(); } None => {} } }"],
    ["a match-arm binding with a guard and an expression arm", "#[test]\nfn t() { match Some(1) { Some(helper) if helper > 0 => helper, _ => 0 }; }"],
    ["a match-arm binding in an or-pattern", "#[test]\nfn t() { match (1, 2) { (helper, _) | (_, helper) => helper }; }"],
  ])("a name bound by %s is that binding, not a same-named item elsewhere", (_how, test) => {
    const out = rust(`mod other { ${fnStr("helper", "stale", "pub ")} }`, fnStr("helper", "stale"), test);
    expect(out).not.toContain("stale");
  });

  it("a match arm's binding does not hide the item from another arm or after the match", () => {
    expect(rust(fnStr("helper", "used"), "#[test]\nfn t() { match Some(1) { Some(helper) => { let _ = helper; } None => { let _ = helper(); } } }")).toContain('"used"');
    expect(rust(fnStr("helper", "used"), "#[test]\nfn t() { match 1 { helper => helper }; let _ = helper(); }")).toContain('"used"');
  });

  it("a method call reaches no method and no free fn: its receiver's type is not resolved", () => {
    const out = rust(
      fnStr("helper", "stale"),
      'struct A; impl A { fn helper(&self) -> &\'static str { "stale" } fn go(&self) { self.inner(); } fn inner(&self) -> &\'static str { "stale" } }',
      "fn make() -> A { A }",
      "#[test]\nfn t() { let a = A; let _ = a.helper(); make().go(); let _ = std::mem::zeroed().helper(); }",
    );
    expect(out).not.toContain("stale");
  });

  it("a use before the shadowing let, or after its block, still reaches the item", () => {
    expect(rust(fnStr("helper", "used"), "#[test]\nfn t() { let _ = helper(); let helper = 1; let _ = helper; }")).toContain('"used"');
    expect(rust(fnStr("helper", "used"), "#[test]\nfn t() { if let Some(helper) = Some(1) { let _ = helper; } let _ = helper(); }")).toContain('"used"');
  });

  it("a name no scope declares and nothing imports reaches no item", () => {
    expect(rust(`mod other { ${fnStr("helper", "stale", "pub ")} }`, "#[test]\nfn t() { let _ = helper(); }")).not.toContain("stale");
  });
});

describe("testRoots reads every runnable chain and every live hook", () => {
  it("counts it.skipIf(false).each(...)(...) and test.runIf(true)(...) as cases", () => {
    const src = 'it.skipIf(false).each([1])("t %s", (n) => { void n; });\ntest.runIf(true)("u", () => {});\n';
    expect(declaredTestCases(parseSource("a.test.ts", src))).toBe(2);
    expect(tsReach(src)).toMatch(/"t %s"/);
  });

  it("refuses a skipIf whose condition is not a literal — whether it runs is not known", () => {
    const src = 'it.skipIf(process.env.CI).each([1])("t %s", (n) => { void n; });\n';
    expect(declaredTestCases(parseSource("a.test.ts", src))).toBe(0);
    expect(tsReach(src)).not.toMatch(/"t %s"/);
  });

  it("still refuses a skipped chained case", () => {
    const src = 'it.skip.each([1])("t %s", () => {});\nit.each([1]).skip?.("x", () => {});\n';
    expect(declaredTestCases(parseSource("a.test.ts", src))).toBe(0);
  });

  it("drops the hooks of a suite with no runnable case, though another suite has one", () => {
    const out = tsReach([
      'describe("empty", () => { beforeEach(() => { void "stale"; }); it.skip("s", () => {}); });',
      'describe("live", () => { beforeEach(() => { void "cjk"; }); it("t", () => {}); });',
      'describe("outer", () => { beforeEach(() => { void "rtl"; }); describe("inner", () => { it("u", () => {}); }); });',
      "",
    ].join("\n"));
    expect(out).toContain('"cjk"');
    expect(out).toContain('"rtl"');
    expect(out).not.toContain("stale");
  });
});
