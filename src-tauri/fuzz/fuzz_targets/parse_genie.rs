//! Fuzz target for the genie file parser (hardening v2-017).
//!
//! `genies::parsing::parse_genie` (re-exported as `parse_genie_for_runner`)
//! parses untrusted `.md` genie definitions: it splits YAML frontmatter from a
//! body and deserializes the frontmatter. Frontmatter parsing of arbitrary
//! attacker-controlled text is a classic source of panics (slicing,
//! unwrap-on-malformed-YAML). The fuzzer feeds arbitrary UTF-8 as file content
//! and asserts the parser only ever returns Ok/Err, never panics.

#![no_main]

use libfuzzer_sys::fuzz_target;
use vmark_lib::genies::parse_genie_for_runner;

fuzz_target!(|data: &str| {
    // The path argument only flavors error messages; a fixed value is fine.
    let _ = parse_genie_for_runner(data, "fuzz.md");
});
