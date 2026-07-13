//! One-shot ("Allow once") authorization tests — WI-2.1 / R5.
//!
//! A one-shot must be honored by the DRIVER. The first version of this feature
//! minted it in the TS store only, while the Rust gate still demanded a standing
//! grant — so "Allow once" authorized the frontend and was then refused by the
//! driver. It authorized nothing. (The frontend unit test passed because `invoke`
//! was mocked and never reached the real gate.)

use super::*;

#[test]
fn a_one_shot_authorizes_an_operation_with_no_standing_grant() {
    let mut shots = vec![OneShot {
        origin_pattern: "https://blog.example.com".into(),
        operation: "click".into(),
    }];
    // No standing grants at all.
    assert!(consume_one_shot(
        &mut shots,
        "https://blog.example.com/p",
        "click"
    ));
}

#[test]
fn a_one_shot_is_spent_by_the_first_matching_action() {
    let mut shots = vec![OneShot {
        origin_pattern: "https://blog.example.com".into(),
        operation: "click".into(),
    }];
    assert!(consume_one_shot(
        &mut shots,
        "https://blog.example.com",
        "click"
    ));
    // Spent.
    assert!(!consume_one_shot(
        &mut shots,
        "https://blog.example.com",
        "click"
    ));
    assert!(shots.is_empty());
}

#[test]
fn a_one_shot_is_scoped_to_its_origin_and_operation() {
    let mut shots = vec![OneShot {
        origin_pattern: "https://blog.example.com".into(),
        operation: "click".into(),
    }];
    assert!(!consume_one_shot(&mut shots, "https://evil.com", "click"));
    assert!(!consume_one_shot(
        &mut shots,
        "https://blog.example.com",
        "type"
    ));
    // Untouched by the failed attempts.
    assert_eq!(shots.len(), 1);
}

#[test]
fn a_one_shot_matches_origins_no_more_loosely_than_a_standing_grant() {
    let mut shots = vec![OneShot {
        origin_pattern: "https://blog.example.com".into(),
        operation: "click".into(),
    }];
    // No implicit subdomain wildcarding — same rule as grants.
    assert!(!consume_one_shot(
        &mut shots,
        "https://evil.blog.example.com",
        "click"
    ));
}

#[test]
fn a_one_shot_can_never_authorize_a_never_automatable_operation() {
    // Defense in depth: even if a malformed one-shot for `upload` were minted,
    // the driver must refuse it.
    let mut shots = vec![OneShot {
        origin_pattern: "https://blog.example.com".into(),
        operation: "upload".into(),
    }];
    assert!(!consume_one_shot(
        &mut shots,
        "https://blog.example.com",
        "upload"
    ));
}

#[test]
fn a_one_shot_is_not_consumed_for_a_non_navigable_origin() {
    let mut shots = vec![OneShot {
        origin_pattern: "https://blog.example.com".into(),
        operation: "click".into(),
    }];
    assert!(!consume_one_shot(&mut shots, "about:blank", "click"));
    assert_eq!(shots.len(), 1);
}
