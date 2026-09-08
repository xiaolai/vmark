// RW-8 (L1) — bundled sample workflow + integration test

//! Integration test for the bundled sample workflow
//! (`resources/workflows/examples/triage-and-translate.yml`, WI-6.1).
//!
//! Proves the v0-genie -> workflow path end-to-end at the parse/resolve layer:
//!   1. The bundled YAML parses into a `RawWorkflow`.
//!   2. Its structure is valid, judged by the runner's OWN `topological_sort`
//!      (#542): declared `id`s, `needs:` references that resolve, an acyclic
//!      graph. The Kahn sort this file used to carry was a second copy of that
//!      rule, so the sample could agree with the copy and not with production.
//!   3. Every `uses: genie/<name>` step references a genie that is actually
//!      bundled with the app — checked against `genies::default_genie_names()`,
//!      the single source of truth for the shipped catalog.
//!   4. Each referenced bundled genie is a real, parseable v0 genie whose
//!      template relies on `{{content}}` — exercising the ADR-2 aliasing that
//!      lets the sample supply `with: { input: ... }` and still bind the
//!      template.
//!   5. The sample is EXECUTED (`examples.test.rs`, #271): through the real
//!      runner on a mock runtime, against a fake OpenAI-compatible endpoint
//!      answering on loopback, in a temp workspace — and the file the last
//!      step saves is read back. Structure is not a run; this is the run.
//!
//! This is a test-only module (`#[cfg(test)]` in `mod.rs`); it ships no
//! runtime code.

use std::collections::HashSet;

use crate::genies::{default_genie_names, parse_genie_for_runner};
use crate::workflow::actions::required_params;
use crate::workflow::runner::topological_sort;
use crate::workflow::types::{NeedsDef, RawWorkflow};

/// The bundled sample workflow, embedded at compile time so the test is
/// hermetic and travels with the binary.
const SAMPLE_WORKFLOW: &str =
    include_str!("../../resources/workflows/examples/triage-and-translate.yml");

/// Bundled genies referenced by the sample, embedded so we can assert their
/// templates exercise the `{{content}}` alias path.
const GENIE_REWRITE: &str = include_str!("../../resources/genies/tools/rewrite-in-english.md");
const GENIE_TRANSLATE: &str = include_str!("../../resources/genies/tools/translate.md");

/// The id the sample DECLARES for a step.
///
/// The runner falls back to the last `/`-segment of `uses` when a step omits
/// `id:`; re-deriving that here was a second copy of production behaviour a
/// test could pass against while the runner did something else (#542), so the
/// fallback is not reproduced — `sample_workflow_structure_is_valid` asserts
/// instead that every sample step declares its id explicitly, which is what
/// makes this total.
fn declared_id(step: &crate::workflow::types::RawStep) -> &str {
    step.id.as_deref().unwrap_or("<step declares no id>")
}

#[test]
fn sample_workflow_parses() {
    let workflow: RawWorkflow = serde_yaml_ng::from_str(SAMPLE_WORKFLOW)
        .expect("bundled sample workflow must parse as RawWorkflow");

    assert_eq!(workflow.name, "Triage and Translate");
    assert!(workflow.description.is_some());
    assert_eq!(workflow.steps.len(), 3);
    // Sample relies on the auto-approval default so it is runnable unattended.
    assert_eq!(workflow.defaults.approval.as_deref(), Some("auto"));
}

#[test]
fn sample_workflow_structure_is_valid() {
    let workflow: RawWorkflow = serde_yaml_ng::from_str(SAMPLE_WORKFLOW).unwrap();

    // Every step names itself, so `declared_id` needs no fallback and the
    // sample stays readable as documentation.
    let ids: Vec<&str> = workflow.steps.iter().map(declared_id).collect();
    assert_eq!(ids, vec!["rewrite", "translate", "save"]);

    // Judged by the PRODUCTION resolver (#542), not by a Kahn sort copied into
    // this file: a copy can only prove the sample agrees with the copy.
    let resolved = topological_sort(workflow.steps.clone())
        .expect("sample workflow must be acyclic and resolvable by the runner's own sort");
    assert_eq!(
        resolved.len(),
        workflow.steps.len(),
        "the runner's sort must place every step"
    );
}

#[test]
fn the_production_sort_the_sample_is_judged_by_refuses_a_broken_graph() {
    // Without this, `sample_workflow_structure_is_valid` would pass just as
    // well against a sort that returned `Ok` unconditionally — and the sample
    // would be "valid" by a rule that judges nothing.
    let workflow: RawWorkflow = serde_yaml_ng::from_str(SAMPLE_WORKFLOW).unwrap();

    let mut unknown_dep = workflow.steps.clone();
    unknown_dep[1].needs = NeedsDef::Single("no-such-step".into());
    let err = topological_sort(unknown_dep).expect_err("a `needs:` naming no step must be refused");
    assert!(err.contains("no-such-step"), "{err}");

    let mut cycle = workflow.steps.clone();
    cycle[0].needs = NeedsDef::Single("save".into());
    let err = topological_sort(cycle).expect_err("a dependency cycle must be refused");
    assert!(err.to_lowercase().contains("circular"), "{err}");
}

#[test]
fn sample_workflow_genie_refs_resolve_against_bundled_catalog() {
    let workflow: RawWorkflow = serde_yaml_ng::from_str(SAMPLE_WORKFLOW).unwrap();
    let bundled: HashSet<&str> = default_genie_names().into_iter().collect();

    let mut genie_steps = 0;
    for step in &workflow.steps {
        if let Some(name) = step.uses.strip_prefix("genie/") {
            genie_steps += 1;
            assert!(
                bundled.contains(name),
                "sample references genie '{name}' which is not in the bundled catalog: {bundled:?}"
            );
        }
    }
    // The sample must exercise the genie->workflow path; the exact count is
    // the assertion, since it subsumes "at least one" (#544).
    assert_eq!(genie_steps, 2, "sample chains two bundled v0 genies");
}

/// The genie assets embedded above, by the name a `uses: genie/<name>` step
/// writes. `include_str!` takes a literal path and nothing else, so this list
/// cannot be derived from the parsed sample — which is exactly why the test
/// below asserts the two agree (#541). Without that, changing the sample to
/// chain a different genie leaves these tests silently checking the old pair.
const EMBEDDED_GENIES: [(&str, &str, &str); 2] = [
    (
        "rewrite-in-english",
        GENIE_REWRITE,
        "tools/rewrite-in-english.md",
    ),
    ("translate", GENIE_TRANSLATE, "tools/translate.md"),
];

#[test]
fn the_embedded_genie_assets_are_exactly_the_ones_the_sample_uses() {
    let workflow: RawWorkflow = serde_yaml_ng::from_str(SAMPLE_WORKFLOW).unwrap();
    let referenced: HashSet<&str> = workflow
        .steps
        .iter()
        .filter_map(|step| step.uses.strip_prefix("genie/"))
        .collect();
    let embedded: HashSet<&str> = EMBEDDED_GENIES.iter().map(|(name, _, _)| *name).collect();
    assert_eq!(
        referenced, embedded,
        "the sample's `uses: genie/…` steps and the `include_str!` assets above have drifted; \
         add or remove a constant so the genie the sample actually chains is the one checked"
    );
}

#[test]
fn referenced_genies_are_v0_and_use_content_alias() {
    // The genies the sample chains must be real, parseable v0 genies whose
    // templates depend on `{{content}}` — the ADR-2 alias that the sample binds
    // by supplying `with: { input: ... }`.
    for (_, raw, path) in EMBEDDED_GENIES {
        let genie = parse_genie_for_runner(raw, path)
            .unwrap_or_else(|e| panic!("bundled genie {path} must parse: {e}"));
        // v0 genies declare no `version` (treated as text-in/text-out).
        assert!(
            genie.metadata.version.is_none(),
            "{path} is expected to be a v0 genie"
        );
        assert!(
            genie.template.contains("{{content}}"),
            "{path} template must use the {{{{content}}}} alias the sample binds"
        );
    }
}

#[test]
fn sample_action_steps_supply_every_parameter_the_executor_requires() {
    // 2026-09-07: the shipped sample passed `content:` to action/save-file, whose
    // executor demands `input`, so the sample's last step failed at run time
    // while every structural test here stayed green. Structure is not a run.
    let workflow: RawWorkflow = serde_yaml_ng::from_str(SAMPLE_WORKFLOW).unwrap();
    let mut checked = 0;
    for step in &workflow.steps {
        let Some(action) = step.uses.strip_prefix("action/") else {
            continue;
        };
        for param in required_params(action) {
            assert!(
                step.with.contains_key(*param),
                "step `{}` uses action/{action} but supplies no `{param}` (the executor refuses it)",
                declared_id(step)
            );
            checked += 1;
        }
    }
    assert!(
        checked > 0,
        "the sample has no action step with required parameters; this test checked nothing"
    );
}

#[test]
fn the_required_params_table_is_the_contract_the_sample_is_checked_against() {
    // `actions.test.rs` proves the executor refuses without each of these;
    // this pins that the table the sample test reads is not empty for the
    // one action the sample uses, so the test above cannot check nothing.
    assert_eq!(required_params("save-file"), ["path", "input"]);
}

#[path = "examples.test.rs"]
mod run;
