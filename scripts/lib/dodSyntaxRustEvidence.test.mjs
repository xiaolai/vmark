// Evidence traversal for `--test-reach` in Rust: a root is a test fn cargo
// runs on the HOST — the one target the phase gate's `cargo test` executes —
// known attributes only, on the host its test marker present, every `cfg` on
// it and on its enclosing modules true and no `ignore` — and a body is
// evidence only when executed code calls it by a uniquely resolved plain path.
// Method calls, mentioned types, stored fns, uncalled nested fns, closures and
// async blocks nothing invokes, code compiled out on the host, and aliases
// that do not resolve uniquely contribute nothing.
import { describe, expect, it } from "vitest";
import { rustTestReach } from "./dodSyntaxReach.mjs";
import { HOST } from "./dodSyntaxRustAttrs.mjs";

const rust = (...l) => rustTestReach(`${l.join("\n")}\n`);
const OS = `target_os = "${HOST.os}"`;
const S = '"DOD_SENTINEL"';
const helper = `fn helper() -> &'static str { ${S} }`;

describe("Rust roots cargo does not run on the host provide no evidence", () => {
  it.each([
    ["a test under cfg(any())", [`#[cfg(any())]\n#[test]\nfn t() { let _ = ${S}; }`]],
    ["a test whose cfg names an unknown feature", [`#[cfg(feature = "x")]\n#[test]\nfn t() { let _ = ${S}; }`]],
    ["a test in a disabled module", [`#[cfg(any())]\nmod m {\n#[test]\nfn t() { let _ = ${S}; } }`]],
    ["a test in a file disabled by an inner attribute", [`#![cfg(any())]\n#[test]\nfn t() { let _ = ${S}; }`]],
    ["a test in a module disabled by its inner attribute", [`mod m { #![cfg(any())]\n#[test]\nfn t() { let _ = ${S}; } }`]],
    ["a test ignored through cfg_attr", [`#[cfg_attr(all(), ignore)]\n#[test]\nfn t() { let _ = ${S}; }`]],
    ["a test under an unknown attribute", [`#[my_macro::wrap]\n#[test]\nfn t() { let _ = ${S}; }`]],
    ["a test in a module under an unknown attribute", [`#[my_macro::wrap]\nmod m {\n#[test]\nfn t() { let _ = ${S}; } }`]],
    ["a test fn nested in another fn", [`fn outer() {\n#[test]\nfn t() { let _ = ${S}; } }`]],
    ["a test no target compiles", [`#[cfg(all(unix, windows))]\n#[test]\nfn t() { let _ = ${S}; }`]],
    ["a windows test in a unix module", [`#[cfg(unix)]\nmod m {\n#[cfg(windows)]\n#[test]\nfn t() { let _ = ${S}; } }`]],
    ["a test for an untested OS", [`#[cfg(target_os = "freebsd")]\n#[test]\nfn t() { let _ = ${S}; }`]],
    ["a unix test ignored on unix", [`#[cfg(unix)]\n#[cfg_attr(unix, ignore)]\n#[test]\nfn t() { let _ = ${S}; }`]],
    ["a test compiled only off the host", [`#[cfg(not(${OS}))]\n#[test]\nfn t() { let _ = ${S}; }`]],
    ["a test ignored on the host", [`#[cfg_attr(${OS}, ignore)]\n#[test]\nfn t() { let _ = ${S}; }`]],
    ["a fn marked a test only off the host", [`#[cfg_attr(not(${OS}), test)]\nfn t() { let _ = ${S}; }`]],
    ["a test marker and compilation from different targets", [`#[cfg(unix)]\n#[cfg_attr(windows, test)]\nfn witness() { let _ = ${S}; }`]],
    ["a test marked and ignored on the same other target", [`#[cfg_attr(windows, test)]\n#[cfg_attr(windows, ignore)]\nfn witness() { let _ = ${S}; }`]],
  ])("drops %s", (_form, src) => {
    expect(rust(...src)).not.toContain("DOD_SENTINEL");
  });

  it.each([
    ["a test under cfg(test) and allow", [`#[cfg(test)]\n#[allow(dead_code)]\n#[test]\nfn t() { let _ = ${S}; }`]],
    ["a test in a cfg(test) module with a true inner cfg", [`#[cfg(test)]\nmod tests { #![cfg(all())]\n#[tokio::test]\nasync fn t() { let _ = ${S}; } }`]],
    ["a should_panic test under cfg(all(test, not(any())))", [`#[cfg(all(test, not(any())))]\n#[test]\n#[should_panic]\nfn t() { let _ = ${S}; }`]],
    ["a test whose cfg_attr predicate is false", [`#[cfg_attr(any(), ignore)]\n#[test]\nfn t() { let _ = ${S}; }`]],
    ["a test compiled only on the host", [`#[cfg(${OS})]\n#[test]\nfn t() { let _ = ${S}; }`]],
    ["a test ignored only off the host", [`#[cfg_attr(not(${OS}), ignore)]\n#[test]\nfn t() { let _ = ${S}; }`]],
    ["a test marked through cfg_attr on the host", [`#[cfg_attr(${OS}, test)]\nfn t() { let _ = ${S}; }`]],
  ])("keeps %s", (_form, src) => {
    expect(rust(...src)).toContain("DOD_SENTINEL");
  });
});

describe("Rust evidence follows only uniquely resolved plain-path calls", () => {
  it.each([
    ["a stored fn", [helper, "#[test]\nfn t() { let f = helper; let _ = f; }"]],
    ["an uncalled nested fn", [`#[test]\nfn t() { fn inner() -> &'static str { ${S} } }`]],
    ["an uncalled fn nested in a called helper", [`fn outer() { fn inner() -> &'static str { ${S} } }`, "#[test]\nfn t() { outer(); }"]],
    ["a method call on one of two types with the method", ['struct A; impl A { fn helper(&self) -> u8 { 1 } }', `struct B; impl B { fn helper(&self) -> &'static str { ${S} } }`, "#[test]\nfn t() { let a = A; let _b = B; a.helper(); }"]],
    ["a method call whose type the test never names", [`struct A; impl A { fn helper(&self) -> &'static str { ${S} } }`, "#[test]\nfn t() { let _ = std::mem::zeroed().helper(); }"]],
    ["a trait impl of a type the test names", [`struct A; impl Drop for A { fn drop(&mut self) { let _ = ${S}; } }`, "#[test]\nfn t() { let _a = A; }"]],
    ["a type path to a type with no impl here", [`struct B; impl B { fn new() -> &'static str { ${S} } }`, "#[test]\nfn t() { let _ = Foo::new(); }"]],
    ["a helper called only by a compiled-out statement", [helper, `#[test]\nfn t() { #[cfg(any())]\nhelper(); }`]],
    ["a cfg(any()) helper called only by a compiled-out statement", [`#[cfg(any())]\n${helper}`, `#[test]\nfn t() { #[cfg(any())]\nhelper(); }`]],
    ["a compiled-out helper the test calls", [`#[cfg(any())]\n${helper}`, "#[test]\nfn t() { let _ = helper(); }"]],
    ["a helper in a module compiled out on the host", [`#[cfg(not(${OS}))]\nmod m { pub ${helper} }`, "#[test]\nfn t() { let _ = m::helper(); }"]],
    ["a compiled-out block in a test", [`#[test]\nfn t() { #[cfg(any())]\n{ let _ = ${S}; } }`]],
    ["a compiled-out let in a test", [`#[test]\nfn t() { #[cfg(not(${OS}))]\nlet _x = ${S}; }`]],
    ["the off-host twin of a cfg-split helper", [`#[cfg(not(${OS}))]\n${helper}`, `#[cfg(${OS})]\nfn helper() -> &'static str { "other" }`, "#[test]\nfn t() { let _ = helper(); }"]],
    ["an unused closure in a test", [`#[test]\nfn t() { let unused = || ${S}; assert_eq!(1, 1); }`]],
    ["an unused block closure in a test", [`#[test]\nfn t() { let unused = move |x: u8| { let _ = (x, ${S}); }; }`]],
    ["a closure handed to a call", [`#[test]\nfn t() { std::thread::spawn(move || { let _ = ${S}; }); }`]],
    ["a helper called only from an unused closure", [helper, "#[test]\nfn t() { let _f = || helper(); }"]],
    ["an unpolled async block", [`#[test]\nfn t() { let _fut = async { ${S} }; }`]],
    ["an unpolled async move block", [`#[tokio::test]\nasync fn t() { let _fut = async move { ${S} }; }`]],
    ["an async fn called and never awaited", [`async fn helper() -> &'static str { ${S} }`, "#[test]\nfn t() { let _ = helper(); }"]],
    ["an async fn whose future is stored", [`async fn helper() -> &'static str { ${S} }`, "#[tokio::test]\nasync fn t() { let fut = helper(); drop(fut); }"]],
    ["a pub async fn called and never awaited", [`pub async fn helper() -> &'static str { ${S} }`, "#[test]\nfn t() { let _ = helper(); }"]],
    ["an async fn with a long comment before fn, never awaited", [`async /* ${"c".repeat(70)} */ fn helper() { panic!(${S}) }`, "#[test]\nfn t() { let _ = helper(); }"]],
    ["an async unsafe extern fn with comments between qualifiers, never awaited", [`async /* a */ unsafe // b\n extern "C" /* ${"c".repeat(70)} */ fn helper() { panic!(${S}) }`, "#[test]\nfn t() { let _ = helper(); }"]],
    ["a type path through a use alias", ["mod types { pub struct A; impl A { pub fn helper() -> u8 { 1 } } pub struct C; impl C { pub fn helper() -> &'static str { " + S + " } } }", "use types::A as C;", "#[test]\nfn t() { let _ = C::helper(); }"]],
  ])("drops %s", (_form, src) => {
    expect(rust(...src)).not.toContain("DOD_SENTINEL");
  });

  it.each([
    ["a called helper", [helper, "#[test]\nfn t() { let _ = helper(); }"]],
    ["a called nested fn", [`#[test]\nfn t() { fn inner() -> &'static str { ${S} } let _ = inner(); }`]],
    ["a const the test reads", [`const FIXTURE: &str = ${S};`, "#[test]\nfn t() { let _ = FIXTURE; }"]],
    ["a type path to an associated fn", [`struct A; impl A { fn make() -> &'static str { ${S} } }`, "#[test]\nfn t() { let _ = A::make(); }"]],
    ["a directly invoked closure", [`#[test]\nfn t() { let _ = (|| ${S})(); }`]],
    ["a directly awaited async block", [`#[tokio::test]\nasync fn t() { let _ = async { ${S} }.await; }`]],
    ["a logical or, which is no closure", [`#[test]\nfn t() { assert!(false || ${S}.len() > 0); }`]],
    ["a helper called beside a compiled-out statement", [helper, "#[test]\nfn t() { #[cfg(any())]\nlet _a = 1; let _ = helper(); }"]],
    ["the host twin of a cfg-split helper", [`#[cfg(${OS})]\n${helper}`, `#[cfg(not(${OS}))]\nfn helper() -> &'static str { "other" }`, "#[test]\nfn t() { let _ = helper(); }"]],
    ["an awaited async fn", [`async fn helper() -> &'static str { ${S} }`, "#[tokio::test]\nasync fn t() { let _ = helper().await; }"]],
    ["the arguments of an async fn call never awaited", ["async fn helper(_x: &str) {}", `#[test]\nfn t() { let _ = helper(${S}); }`]],
    ["a Self path inside a called associated fn", [`struct A; impl A { fn go() { Self::make(); } fn make() -> &'static str { ${S} } }`, "#[test]\nfn t() { A::go(); }"]],
  ])("keeps %s", (_form, src) => {
    expect(rust(...src)).toContain("DOD_SENTINEL");
  });
});
