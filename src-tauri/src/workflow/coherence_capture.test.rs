// WI-1.6 — workflow save-file capture: transitive template-reference
// dataflow (only read-file steps that actually feed the save become
// direct inputs) and end-to-end capture into a workspace kernel.

use super::*;
use crate::coherence::state::WorkspaceKernel;
use crate::coherence::types::WriterId;

fn slice(id: &str, uses: &str, with: &[(&str, &str)]) -> StepSlice {
    (
        id.to_string(),
        uses.to_string(),
        with.iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect(),
    )
}

#[test]
fn only_reachable_read_files_become_inputs() {
    let steps = vec![
        slice("read-elena", "action/read-file", &[("path", "elena.md")]),
        slice("read-unused", "action/read-file", &[("path", "unused.md")]),
        slice(
            "summarize",
            "genie/summarize",
            &[("content", "${{ steps.read-elena.outputs.text }}")],
        ),
        slice(
            "save",
            "action/save-file",
            &[
                ("path", "out.md"),
                ("input", "${{ steps.summarize.outputs.text }}"),
            ],
        ),
    ];
    assert_eq!(
        direct_input_paths(&steps, "save"),
        vec!["elena.md".to_string()]
    );
}

#[test]
fn bare_alias_references_are_followed() {
    let steps = vec![
        slice("read", "action/read-file", &[("path", "world.md")]),
        slice(
            "save",
            "action/save-file",
            &[("path", "out.md"), ("input", "read.text")],
        ),
    ];
    assert_eq!(
        direct_input_paths(&steps, "save"),
        vec!["world.md".to_string()]
    );
}

#[test]
fn diamond_dataflow_dedupes_and_cycles_terminate() {
    let steps = vec![
        slice("read", "action/read-file", &[("path", "a.md")]),
        slice(
            "g1",
            "genie/x",
            &[("c", "steps.read.text"), ("loop", "steps.g2.text")],
        ),
        slice(
            "g2",
            "genie/y",
            &[("c", "steps.read.text"), ("loop", "steps.g1.text")],
        ),
        slice(
            "save",
            "action/save-file",
            &[("input", "steps.g1.text steps.g2.text")],
        ),
    ];
    assert_eq!(direct_input_paths(&steps, "save"), vec!["a.md".to_string()]);
}

#[test]
fn save_with_no_references_has_no_inputs() {
    let steps = vec![
        slice("read", "action/read-file", &[("path", "a.md")]),
        slice(
            "save",
            "action/save-file",
            &[("path", "out.md"), ("input", "static text")],
        ),
    ];
    assert!(direct_input_paths(&steps, "save").is_empty());
}

#[test]
fn capture_save_file_records_transformation_with_edges() {
    let dir = tempfile::tempdir().unwrap();
    let mut kernel = WorkspaceKernel::open(dir.path(), WriterId(uuid::Uuid::from_u128(1))).unwrap();
    std::fs::write(dir.path().join("elena.md"), "elena\n").unwrap();
    std::fs::write(dir.path().join("out.md"), "generated\n").unwrap();

    capture_save_file(
        &mut kernel,
        dir.path(),
        "out.md",
        "generated\n",
        &["elena.md".to_string()],
        "save",
    )
    .unwrap();

    let entries = kernel.ledger().read_all().unwrap().entries;
    let txf = entries
        .iter()
        .filter_map(|e| match e.typed().ok()? {
            crate::coherence::types::TypedBody::Transformation(t)
                if t.intent.kind == "workflow" =>
            {
                Some(t)
            }
            _ => None,
        })
        .next()
        .expect("workflow transformation recorded");
    assert_eq!(txf.agent.kind, crate::coherence::types::AgentType::Model);
    assert_eq!(
        txf.inputs.len(),
        1,
        "elena adopted and pinned as direct input"
    );
    assert_eq!(txf.confidence, crate::coherence::types::Confidence::Exact);
}

#[test]
fn self_referential_save_target_is_not_its_own_input() {
    let dir = tempfile::tempdir().unwrap();
    let mut kernel = WorkspaceKernel::open(dir.path(), WriterId(uuid::Uuid::from_u128(1))).unwrap();
    std::fs::write(dir.path().join("out.md"), "x\n").unwrap();
    capture_save_file(
        &mut kernel,
        dir.path(),
        "out.md",
        "x\n",
        &["out.md".to_string()],
        "save",
    )
    .unwrap();
    let entries = kernel.ledger().read_all().unwrap().entries;
    for e in &entries {
        if let Ok(crate::coherence::types::TypedBody::Transformation(t)) = e.typed() {
            assert!(t.inputs.is_empty(), "no self-edge");
        }
    }
}
