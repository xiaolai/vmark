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
    // The alias the EXECUTOR resolves, which is the only kind that carries
    // data (#512). This case used to write `read.text` — a literal `resolve`
    // leaves untouched — so it pinned an edge for a dataflow that never
    // happened; `a_bare_alias_the_executor_would_not_resolve_is_not_a_dependency`
    // now holds that half.
    let steps = vec![
        slice("read", "action/read-file", &[("path", "world.md")]),
        slice(
            "save",
            "action/save-file",
            &[("path", "out.md"), ("input", "read.output")],
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
            &[
                ("c", "${{ steps.read.text }}"),
                ("loop", "${{ steps.g2.text }}"),
            ],
        ),
        slice(
            "g2",
            "genie/y",
            &[
                ("c", "${{ steps.read.text }}"),
                ("loop", "${{ steps.g1.text }}"),
            ],
        ),
        slice(
            "save",
            "action/save-file",
            &[("input", "${{ steps.g1.text }} ${{ steps.g2.text }}")],
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
        Agent {
            kind: AgentType::Model,
            id: Some("workflow-genie".into()),
        },
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
        Agent {
            kind: AgentType::Model,
            id: Some("workflow-genie".into()),
        },
    )
    .unwrap();
    let entries = kernel.ledger().read_all().unwrap().entries;
    for e in &entries {
        if let Ok(crate::coherence::types::TypedBody::Transformation(t)) = e.typed() {
            assert!(t.inputs.is_empty(), "no self-edge");
        }
    }
}

#[test]
fn literal_paths_containing_steps_are_not_dependencies() {
    // Audit A-M11: `steps.` inside a plain (non-template) param value is
    // literal content, never a dataflow reference.
    let steps = vec![
        slice("steps", "action/read-file", &[("path", "a.md")]),
        slice(
            "save",
            "action/save-file",
            &[("path", "notes/steps.foo.md"), ("input", "static text")],
        ),
    ];
    assert!(direct_input_paths(&steps, "save").is_empty());
}

// ===== #512 — the capture's reference grammar IS the executor's ============

#[test]
fn a_bare_alias_the_executor_would_not_resolve_is_not_a_dependency() {
    // `read.text` and `read.md` are literal values: `resolve` substitutes
    // neither (its alias regex is `^\w+\.output$`, whole-string). Counting
    // them as references produced provenance edges recording a dataflow that
    // never happened.
    let steps = vec![
        (
            "read".to_string(),
            "action/read-file".to_string(),
            HashMap::from([("path".to_string(), "notes.md".to_string())]),
        ),
        (
            "save".to_string(),
            "action/save-file".to_string(),
            HashMap::from([
                ("path".to_string(), "out.md".to_string()),
                ("input".to_string(), "read.text".to_string()),
            ]),
        ),
    ];
    assert!(
        direct_input_paths(&steps, "save").is_empty(),
        "`read.text` is a literal, not a reference"
    );
}

#[test]
fn the_capture_and_the_executor_agree_on_every_bare_value() {
    // Parity, not a second copy of the rule: whatever `resolve` substitutes is
    // a dependency, and whatever it leaves alone is not.
    use crate::workflow::expressions::resolve;
    let outputs = HashMap::from([(
        "read".to_string(),
        HashMap::from([("text".to_string(), "SUBSTITUTED".to_string())]),
    )]);
    let known: HashSet<&str> = HashSet::from(["read"]);
    for value in [
        "read.output",
        " read.output ",
        "read.text",
        "read.md",
        "read.output.txt",
        "prefix read.output",
        "notes/read.output",
        "reader.output",
        "read",
    ] {
        let substituted = resolve(value, &outputs, &HashMap::new())
            .map(|out| out != value.trim() && out != value)
            .unwrap_or(false);
        let referenced = referenced_ids(value, &known).contains(&"read".to_string());
        assert_eq!(
            referenced, substituted,
            "capture and executor disagree about {value:?}"
        );
    }
}

// ===== #516 — a save is attributed to what actually produced it ============

#[test]
fn an_action_only_workflow_is_not_attributed_to_a_model() {
    let steps = vec![
        (
            "read".to_string(),
            "action/read-file".to_string(),
            HashMap::from([("path".to_string(), "notes.md".to_string())]),
        ),
        (
            "save".to_string(),
            "action/save-file".to_string(),
            HashMap::from([("input".to_string(), "read.output".to_string())]),
        ),
    ];
    let reachable = reachable_from(&steps, "save");
    let agent = agent_for(&steps, &reachable);
    assert_eq!(agent.kind, AgentType::External);
    assert_eq!(agent.id.as_deref(), Some("workflow"));
}

#[test]
fn a_genie_step_that_feeds_the_save_makes_it_a_model_transformation() {
    let steps = vec![
        (
            "rewrite".to_string(),
            "genie/rewrite-in-english".to_string(),
            HashMap::from([("input".to_string(), "seed".to_string())]),
        ),
        (
            "save".to_string(),
            "action/save-file".to_string(),
            HashMap::from([(
                "input".to_string(),
                "${{ steps.rewrite.outputs.text }}".to_string(),
            )]),
        ),
    ];
    let reachable = reachable_from(&steps, "save");
    let agent = agent_for(&steps, &reachable);
    assert_eq!(agent.kind, AgentType::Model);
    assert_eq!(agent.id.as_deref(), Some("workflow-genie"));
}

#[test]
fn a_genie_step_the_save_does_not_depend_on_does_not_claim_its_content() {
    // An unrelated model step in the same workflow says nothing about how THIS
    // file came to be — the same reason unrelated reads never become inputs.
    let steps = vec![
        (
            "aside".to_string(),
            "genie/summarize".to_string(),
            HashMap::from([("input".to_string(), "something else".to_string())]),
        ),
        (
            "read".to_string(),
            "action/read-file".to_string(),
            HashMap::from([("path".to_string(), "notes.md".to_string())]),
        ),
        (
            "save".to_string(),
            "action/save-file".to_string(),
            HashMap::from([("input".to_string(), "read.output".to_string())]),
        ),
    ];
    let reachable = reachable_from(&steps, "save");
    assert!(!reachable.contains("aside"));
    assert_eq!(agent_for(&steps, &reachable).kind, AgentType::External);
}
