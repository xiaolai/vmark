// WI-3.4 — delegation listing: revoked grants drop out.

use super::*;
use crate::coherence::state::WorkspaceKernel;
use crate::coherence::types::WriterId;
use uuid::Uuid;

#[test]
fn listing_shows_live_grants_and_hides_revoked() {
    let td = tempfile::tempdir().unwrap();
    let mut kernel = WorkspaceKernel::open(td.path(), WriterId(Uuid::now_v7())).unwrap();
    let now = "2026-07-19T12:00:00Z";
    let receipt = perform_delegate(
        &mut kernel,
        &DelegateRequest {
            delegate: "codex-cli".into(),
            scope: vec!["resolve.accept-newer".into()],
            expires: "2026-07-26T00:00:00Z".into(),
            revoke: None,
        },
        "xiaolai",
        now,
    )
    .unwrap();
    assert_eq!(perform_delegations_list(&mut kernel).unwrap().len(), 1);
    perform_delegate(
        &mut kernel,
        &DelegateRequest {
            delegate: "codex-cli".into(),
            scope: vec![],
            expires: "2026-07-26T00:00:00Z".into(),
            revoke: Some(receipt.grant),
        },
        "xiaolai",
        now,
    )
    .unwrap();
    assert!(perform_delegations_list(&mut kernel).unwrap().is_empty());
}
