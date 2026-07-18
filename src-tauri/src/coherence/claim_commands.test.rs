// WI-2b.2 — claim lifecycle commands: explicit human acts appending
// claim entries (design-2a.md D2; spec §5.4.5 revision 1) and the
// manifest-backed scope act (D2.4).

use super::*;
use crate::coherence::capture::{capture, CaptureRequest};
use crate::coherence::claims::{ClaimStore, Maturity};
use crate::coherence::contexts::{ContextSet, DEFAULT_CONTEXT_ID};
use crate::coherence::state::WorkspaceKernel;
use crate::coherence::types::{Agent, AgentType, Confidence, Intent, WriterId};
use uuid::Uuid;

fn workspace() -> (tempfile::TempDir, WorkspaceKernel) {
    let td = tempfile::tempdir().expect("tempdir");
    let kernel = WorkspaceKernel::open(td.path(), WriterId(Uuid::now_v7())).expect("kernel");
    (td, kernel)
}

fn seed_doc(kernel: &mut WorkspaceKernel, root: &std::path::Path, rel: &str) {
    let content = "# Seed\nElena is left-handed.\n";
    std::fs::write(root.join(rel), content).unwrap();
    capture(
        kernel,
        CaptureRequest {
            path: rel.into(),
            content: content.into(),
            inputs: Vec::new(),
            agent: Agent {
                kind: AgentType::Human,
                id: Some("tester".into()),
            },
            intent: Intent {
                kind: "test".into(),
                summary: "seed".into(),
                prompt_hash: None,
            },
            confidence: Confidence::Exact,
            rewrite_identity: true,
            idem: None,
        },
    )
    .expect("seed capture");
}

fn store(kernel: &WorkspaceKernel) -> ClaimStore {
    ClaimStore::from_entries(&kernel.ledger().read_all().unwrap().entries)
}

#[test]
fn create_appends_draft_with_provenance_and_actor() {
    let (td, mut kernel) = workspace();
    seed_doc(&mut kernel, td.path(), "elena.md");
    let receipt = perform_claim(
        &mut kernel,
        &ClaimRequest {
            action: "create".into(),
            claim: None,
            statement: Some("Elena is left-handed".into()),
            valid_at: None,
            invalid_at: None,
            source_path: Some("elena.md".into()),
        },
        "tester",
    )
    .expect("create");
    let s = store(&kernel);
    let current = s.current(receipt.claim).expect("current");
    assert_eq!(current.maturity, Maturity::Draft);
    assert_eq!(current.statement, "Elena is left-handed");
    // Provenance + actor recorded in the raw entry.
    let entries = kernel.ledger().read_all().unwrap().entries;
    let raw = entries.iter().find(|e| e.kind == "claim").unwrap();
    assert_eq!(raw.body["actor"]["id"], "tester");
    assert!(raw.body["established_by"][0]["object"].is_string());
    assert!(raw.body["established_by"][0]["revision"]
        .as_str()
        .unwrap()
        .starts_with("rev1:"));
}

#[test]
fn promote_supersedes_draft_into_established() {
    let (td, mut kernel) = workspace();
    seed_doc(&mut kernel, td.path(), "elena.md");
    let created = perform_claim(
        &mut kernel,
        &ClaimRequest {
            action: "create".into(),
            claim: None,
            statement: Some("s".into()),
            valid_at: None,
            invalid_at: None,
            source_path: Some("elena.md".into()),
        },
        "tester",
    )
    .unwrap();
    perform_claim(
        &mut kernel,
        &ClaimRequest {
            action: "promote".into(),
            claim: Some(created.claim),
            statement: None,
            valid_at: None,
            invalid_at: None,
            source_path: None,
        },
        "tester",
    )
    .unwrap();
    let s = store(&kernel);
    let current = s.current(created.claim).unwrap();
    assert_eq!(current.maturity, Maturity::Established);
    assert!(current.supersedes.is_some());
}

#[test]
fn promote_established_is_rejected() {
    let (td, mut kernel) = workspace();
    seed_doc(&mut kernel, td.path(), "elena.md");
    let created = perform_claim(
        &mut kernel,
        &ClaimRequest {
            action: "create".into(),
            claim: None,
            statement: Some("s".into()),
            valid_at: None,
            invalid_at: None,
            source_path: Some("elena.md".into()),
        },
        "t",
    )
    .unwrap();
    for _ in 0..1 {
        perform_claim(
            &mut kernel,
            &ClaimRequest {
                action: "promote".into(),
                claim: Some(created.claim),
                statement: None,
                valid_at: None,
                invalid_at: None,
                source_path: None,
            },
            "t",
        )
        .unwrap();
    }
    let err = perform_claim(
        &mut kernel,
        &ClaimRequest {
            action: "promote".into(),
            claim: Some(created.claim),
            statement: None,
            valid_at: None,
            invalid_at: None,
            source_path: None,
        },
        "t",
    )
    .unwrap_err();
    assert!(err.contains("draft"), "{err}");
}

#[test]
fn retire_sets_invalid_at_and_correct_replaces_statement() {
    let (td, mut kernel) = workspace();
    seed_doc(&mut kernel, td.path(), "elena.md");
    let created = perform_claim(
        &mut kernel,
        &ClaimRequest {
            action: "create".into(),
            claim: None,
            statement: Some("old".into()),
            valid_at: None,
            invalid_at: None,
            source_path: Some("elena.md".into()),
        },
        "t",
    )
    .unwrap();
    perform_claim(
        &mut kernel,
        &ClaimRequest {
            action: "correct".into(),
            claim: Some(created.claim),
            statement: Some("new".into()),
            valid_at: None,
            invalid_at: None,
            source_path: None,
        },
        "t",
    )
    .unwrap();
    perform_claim(
        &mut kernel,
        &ClaimRequest {
            action: "retire".into(),
            claim: Some(created.claim),
            statement: None,
            valid_at: None,
            invalid_at: Some("2026-07-18T00:00:00Z".into()),
            source_path: None,
        },
        "t",
    )
    .unwrap();
    let s = store(&kernel);
    let current = s.current(created.claim).unwrap();
    assert_eq!(current.statement, "new");
    assert_eq!(current.invalid_at.as_deref(), Some("2026-07-18T00:00:00Z"));
}

#[test]
fn unknown_claim_and_unknown_action_are_errors() {
    let (_td, mut kernel) = workspace();
    let err = perform_claim(
        &mut kernel,
        &ClaimRequest {
            action: "promote".into(),
            claim: Some(Uuid::now_v7()),
            statement: None,
            valid_at: None,
            invalid_at: None,
            source_path: None,
        },
        "t",
    )
    .unwrap_err();
    assert!(err.contains("unknown claim"), "{err}");
    let err2 = perform_claim(
        &mut kernel,
        &ClaimRequest {
            action: "explode".into(),
            claim: None,
            statement: None,
            valid_at: None,
            invalid_at: None,
            source_path: None,
        },
        "t",
    )
    .unwrap_err();
    assert!(err2.contains("unknown claim action"), "{err2}");
}

#[test]
fn scope_materializes_default_manifest_and_toggles_visibility() {
    let (td, mut kernel) = workspace();
    seed_doc(&mut kernel, td.path(), "elena.md");
    let created = perform_claim(
        &mut kernel,
        &ClaimRequest {
            action: "create".into(),
            claim: None,
            statement: Some("s".into()),
            valid_at: None,
            invalid_at: None,
            source_path: Some("elena.md".into()),
        },
        "t",
    )
    .unwrap();
    // create already scoped it into the current (default) context.
    let dir = td.path().join(".vmark/contexts");
    let set = ContextSet::load(&dir);
    assert!(set
        .effective_claims(DEFAULT_CONTEXT_ID)
        .contains(&created.claim));
    // Scope OUT is reversible visibility, not retirement (D2.4).
    perform_claim_scope(&mut kernel, DEFAULT_CONTEXT_ID, created.claim, false).unwrap();
    let set = ContextSet::load(&dir);
    assert!(!set
        .effective_claims(DEFAULT_CONTEXT_ID)
        .contains(&created.claim));
    let s = store(&kernel);
    assert!(s.current(created.claim).is_some(), "claim still live");
}

#[test]
fn listing_carries_default_context_visibility() {
    let (td, mut kernel) = workspace();
    seed_doc(&mut kernel, td.path(), "elena.md");
    let created = perform_claim(
        &mut kernel,
        &ClaimRequest {
            action: "create".into(),
            claim: None,
            statement: Some("s".into()),
            valid_at: None,
            invalid_at: None,
            source_path: Some("elena.md".into()),
        },
        "t",
    )
    .unwrap();
    let rows = perform_claims_list(&mut kernel).unwrap();
    assert!(rows[0].visible, "created claims are scoped in (D2.2)");
    perform_claim_scope(&mut kernel, DEFAULT_CONTEXT_ID, created.claim, false).unwrap();
    let rows = perform_claims_list(&mut kernel).unwrap();
    assert!(!rows[0].visible, "scope-out reflects in the listing");
}
