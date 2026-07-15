//! One-shot ("Allow once") authorization tests — WI-2.1 / R5 / R7a.
//!
//! A one-shot is bound to (tab, generation, origin, operation, target) and
//! consumed by exactly one matching action. Generation + tab binding give it the
//! same lifecycle as the committed origin (R7a): it lapses the moment the tab
//! navigates or closes, so an approval for "click Publish on the page I'm looking
//! at" cannot be spent on a later page, a different tab, or a different element.

use super::*;

fn target(role: &str, name: &str) -> OneShotTarget {
    OneShotTarget {
        role: role.into(),
        name: name.into(),
    }
}

fn click_shot(tab: &str, gen: u64, role: &str, name: &str) -> OneShot {
    OneShot {
        tab_id: tab.into(),
        generation: gen,
        origin_pattern: "https://blog.example.com".into(),
        operation: "click".into(),
        target: Some(target(role, name)),
    }
}

#[test]
fn authorizes_the_exact_action_with_no_standing_grant() {
    let mut shots = vec![click_shot("t1", 3, "button", "Publish")];
    assert!(consume_one_shot(
        &mut shots,
        "t1",
        3,
        "https://blog.example.com/p",
        "click",
        Some(&target("button", "Publish")),
    ));
    assert!(shots.is_empty(), "spent");
}

#[test]
fn is_spent_by_the_first_matching_action() {
    let mut shots = vec![click_shot("t1", 3, "button", "Publish")];
    let args = ("t1", 3, "https://blog.example.com", "click");
    assert!(consume_one_shot(
        &mut shots,
        args.0,
        args.1,
        args.2,
        args.3,
        Some(&target("button", "Publish"))
    ));
    assert!(!consume_one_shot(
        &mut shots,
        args.0,
        args.1,
        args.2,
        args.3,
        Some(&target("button", "Publish"))
    ));
}

#[test]
fn refuses_a_different_target_on_the_same_origin_and_operation() {
    let mut shots = vec![click_shot("t1", 3, "button", "Publish")];
    // Different name — the AI escalating "click Publish" to "click Delete".
    assert!(!consume_one_shot(
        &mut shots,
        "t1",
        3,
        "https://blog.example.com",
        "click",
        Some(&target("button", "Delete"))
    ));
    // Different role.
    assert!(!consume_one_shot(
        &mut shots,
        "t1",
        3,
        "https://blog.example.com",
        "click",
        Some(&target("link", "Publish"))
    ));
    assert_eq!(shots.len(), 1, "untouched by the refused attempts");
}

#[test]
fn refuses_a_stale_generation_the_tab_has_navigated() {
    // Minted at generation 3; the tab has since navigated to generation 4.
    let mut shots = vec![click_shot("t1", 3, "button", "Publish")];
    assert!(!consume_one_shot(
        &mut shots,
        "t1",
        4,
        "https://blog.example.com",
        "click",
        Some(&target("button", "Publish"))
    ));
    assert_eq!(shots.len(), 1);
}

#[test]
fn refuses_a_different_tab_at_the_same_generation() {
    // Two tabs can both be at generation 0 — tab id must disambiguate.
    let mut shots = vec![click_shot("t1", 0, "button", "Publish")];
    assert!(!consume_one_shot(
        &mut shots,
        "t2",
        0,
        "https://blog.example.com",
        "click",
        Some(&target("button", "Publish"))
    ));
}

#[test]
fn refuses_a_different_origin_and_operation() {
    let mut shots = vec![click_shot("t1", 3, "button", "Publish")];
    assert!(!consume_one_shot(
        &mut shots,
        "t1",
        3,
        "https://evil.com",
        "click",
        Some(&target("button", "Publish"))
    ));
    assert!(!consume_one_shot(
        &mut shots,
        "t1",
        3,
        "https://blog.example.com",
        "type",
        Some(&target("button", "Publish"))
    ));
    assert_eq!(shots.len(), 1);
}

#[test]
fn matches_origins_no_more_loosely_than_a_standing_grant() {
    let mut shots = vec![click_shot("t1", 3, "button", "Publish")];
    assert!(!consume_one_shot(
        &mut shots,
        "t1",
        3,
        "https://evil.blog.example.com",
        "click",
        Some(&target("button", "Publish"))
    ));
}

#[test]
fn a_read_one_shot_has_no_target_and_matches_target_less() {
    let mut shots = vec![OneShot {
        tab_id: "t1".into(),
        generation: 2,
        origin_pattern: "https://blog.example.com".into(),
        operation: "read".into(),
        target: None,
    }];
    // A read snapshots the whole page — no element target.
    assert!(consume_one_shot(
        &mut shots,
        "t1",
        2,
        "https://blog.example.com",
        "read",
        None
    ));
}

#[test]
fn a_targeted_one_shot_is_not_consumed_target_less() {
    let mut shots = vec![click_shot("t1", 3, "button", "Publish")];
    assert!(!consume_one_shot(
        &mut shots,
        "t1",
        3,
        "https://blog.example.com",
        "click",
        None
    ));
}

#[test]
fn never_authorizes_a_never_automatable_operation() {
    let mut shots = vec![OneShot {
        tab_id: "t1".into(),
        generation: 1,
        origin_pattern: "https://blog.example.com".into(),
        operation: "upload".into(),
        target: Some(target("button", "Upload")),
    }];
    assert!(!consume_one_shot(
        &mut shots,
        "t1",
        1,
        "https://blog.example.com",
        "upload",
        Some(&target("button", "Upload"))
    ));
}

#[test]
fn not_consumed_for_a_non_navigable_origin() {
    let mut shots = vec![click_shot("t1", 3, "button", "Publish")];
    assert!(!consume_one_shot(
        &mut shots,
        "t1",
        3,
        "about:blank",
        "click",
        Some(&target("button", "Publish"))
    ));
    assert_eq!(shots.len(), 1);
}

#[test]
fn clear_for_tab_drops_only_that_tabs_one_shots() {
    let mut shots = vec![
        click_shot("t1", 1, "button", "Publish"),
        click_shot("t2", 1, "button", "Publish"),
        click_shot("t1", 2, "link", "More"),
    ];
    clear_one_shots_for_tab(&mut shots, "t1");
    assert_eq!(shots.len(), 1);
    assert_eq!(shots[0].tab_id, "t2");
}

// WI-S0.13 — the closed operation vocabulary must be closed on BOTH paths.
//
// `is_driver_operation_allowed` rejects an unknown operation, so the standing-grant path
// is closed. `consume_one_shot` only checked NEVER_AUTOMATED — so an operation outside the
// vocabulary could be minted and then spent through the one-shot path, which is exactly the
// "treated as an opaque permission" that operation.rs says cannot happen. A closed set that
// is only closed on one of two routes is not closed. (Audit, Medium.)
#[test]
fn an_operation_outside_the_vocabulary_can_never_be_consumed() {
    for bogus in ["frobnicate", "Click", "read ", "", "click\n"] {
        let mut shots = vec![OneShot {
            tab_id: "t1".into(),
            generation: 1,
            origin_pattern: "https://example.com".into(),
            operation: bogus.into(),
            target: None,
        }];
        assert!(
            !consume_one_shot(&mut shots, "t1", 1, "https://example.com/p", bogus, None),
            "{bogus:?} is not a browser operation and must not be spendable",
        );
        assert_eq!(shots.len(), 1, "a refused consume must not spend the one-shot");
    }
}

#[test]
fn a_known_operation_is_still_consumable() {
    let mut shots = vec![OneShot {
        tab_id: "t1".into(),
        generation: 1,
        origin_pattern: "https://example.com".into(),
        operation: "click".into(),
        target: None,
    }];
    assert!(consume_one_shot(
        &mut shots,
        "t1",
        1,
        "https://example.com/p",
        "click",
        None
    ));
    assert!(shots.is_empty());
}
