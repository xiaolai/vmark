// RW-8 (L1) — bundled sample workflow + integration test

//! Integration test for the bundled sample workflow
//! (`resources/workflows/examples/triage-and-translate.yml`, WI-6.1).
//!
//! Proves the v0-genie -> workflow path end-to-end at the parse/resolve layer:
//!   1. The bundled YAML parses into a `RawWorkflow`.
//!   2. Its structure is valid (declared `id`s, `needs:` references resolve,
//!      the dependency graph is acyclic and yields a sensible order).
//!   3. Every `uses: genie/<name>` step references a genie that is actually
//!      bundled with the app — checked against `genies::default_genie_names()`,
//!      the single source of truth for the shipped catalog.
//!   4. Each referenced bundled genie is a real, parseable v0 genie whose
//!      template relies on `{{content}}` — exercising the ADR-2 aliasing that
//!      lets the sample supply `with: { input: ... }` and still bind the
//!      template.
//!
//! This is a test-only module (`#[cfg(test)]` in `mod.rs`); it ships no
//! runtime code.

use std::collections::{HashMap, HashSet, VecDeque};

use crate::genies::{default_genie_names, parse_genie_for_runner};
use crate::workflow::types::RawWorkflow;

/// The bundled sample workflow, embedded at compile time so the test is
/// hermetic and travels with the binary.
const SAMPLE_WORKFLOW: &str =
    include_str!("../../resources/workflows/examples/triage-and-translate.yml");

/// Bundled genies referenced by the sample, embedded so we can assert their
/// templates exercise the `{{content}}` alias path.
const GENIE_REWRITE: &str = include_str!("../../resources/genies/tools/rewrite-in-english.md");
const GENIE_TRANSLATE: &str = include_str!("../../resources/genies/tools/translate.md");

/// Derive a step's effective id the same way the runner does
/// (`runner::topological_sort`): explicit `id`, else the last `/`-segment of
/// `uses`.
fn step_id(step: &crate::workflow::types::RawStep) -> String {
    step.id
        .clone()
        .unwrap_or_else(|| step.uses.rsplit('/').next().unwrap_or("step").to_string())
}

/// Minimal acyclic-order check mirroring the runner's Kahn topo sort, so the
/// test asserts the sample is runnable-shaped without reaching into the
/// runner's private functions.
fn topo_order(workflow: &RawWorkflow) -> Result<Vec<String>, String> {
    let ids: Vec<String> = workflow.steps.iter().map(step_id).collect();
    let id_set: HashSet<&String> = ids.iter().collect();

    let mut in_degree: HashMap<String, usize> = ids.iter().map(|i| (i.clone(), 0)).collect();
    let mut adjacency: HashMap<String, Vec<String>> = HashMap::new();

    for (step, id) in workflow.steps.iter().zip(&ids) {
        for dep in step.needs.to_vec() {
            if !id_set.contains(&dep) {
                return Err(format!("Step '{id}' depends on unknown step '{dep}'"));
            }
            adjacency.entry(dep).or_default().push(id.clone());
            *in_degree.get_mut(id).unwrap() += 1;
        }
    }

    let mut queue: VecDeque<String> = ids
        .iter()
        .filter(|i| in_degree[*i] == 0)
        .cloned()
        .collect();
    let mut order = Vec::new();
    while let Some(id) = queue.pop_front() {
        order.push(id.clone());
        if let Some(deps) = adjacency.get(&id) {
            for d in deps {
                let deg = in_degree.get_mut(d).unwrap();
                *deg -= 1;
                if *deg == 0 {
                    queue.push_back(d.clone());
                }
            }
        }
    }

    if order.len() != ids.len() {
        return Err("Workflow has a circular dependency".to_string());
    }
    Ok(order)
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

    let ids: Vec<String> = workflow.steps.iter().map(step_id).collect();
    assert_eq!(ids, vec!["rewrite", "translate", "save"]);

    let order = topo_order(&workflow).expect("sample workflow must be acyclic and resolvable");
    // Each step must appear after its declared dependency.
    let pos = |id: &str| order.iter().position(|x| x == id).unwrap();
    assert!(pos("rewrite") < pos("translate"));
    assert!(pos("translate") < pos("save"));
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
    // The sample must exercise the genie->workflow path with at least one
    // bundled v0 genie; otherwise it proves nothing for RW-8.
    assert!(genie_steps >= 1, "sample must use at least one genie step");
    assert_eq!(genie_steps, 2, "sample chains two bundled v0 genies");
}

#[test]
fn referenced_genies_are_v0_and_use_content_alias() {
    // The two genies the sample chains must be real, parseable v0 genies whose
    // templates depend on `{{content}}` — the ADR-2 alias that the sample binds
    // by supplying `with: { input: ... }`.
    for (raw, path) in [
        (GENIE_REWRITE, "tools/rewrite-in-english.md"),
        (GENIE_TRANSLATE, "tools/translate.md"),
    ] {
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
