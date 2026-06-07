//! Fuzz target for the workflow expression parser (hardening v2-017).
//!
//! `workflow::expressions::resolve` parses untrusted `with:` parameter values
//! containing `${{ ... }}`, `${VAR}`, and bare `stepId.output` references. It
//! runs regex matching plus manual byte-offset string slicing (see Step 1 in
//! the source), which is exactly the kind of code where a malformed input can
//! trigger a slice-on-non-char-boundary panic. The fuzzer feeds arbitrary
//! UTF-8 and asserts the parser never panics — any Err is a valid outcome.

#![no_main]

use std::collections::HashMap;

use libfuzzer_sys::fuzz_target;
use vmark_lib::workflow::expressions::{resolve, WorkflowOutputs};

fuzz_target!(|data: &str| {
    // Seed a small, realistic env + outputs map so the resolver exercises the
    // hit-and-miss branches rather than always failing on an empty context.
    let mut env: HashMap<String, String> = HashMap::new();
    env.insert("HOME".to_string(), "/tmp".to_string());
    env.insert("USER".to_string(), "fuzz".to_string());

    let mut outputs: WorkflowOutputs = HashMap::new();
    let mut step = HashMap::new();
    step.insert("text".to_string(), "hello".to_string());
    step.insert("path".to_string(), "/tmp/out".to_string());
    outputs.insert("step1".to_string(), step);

    // We only care that this never panics. Both Ok and Err are acceptable.
    let _ = resolve(data, &outputs, &env);
});
