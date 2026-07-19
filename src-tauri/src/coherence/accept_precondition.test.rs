// WI-3.0e — reproject-under-lock precondition (design v4.3). The two review-
// forced properties: a concurrent semantic check never blocks accept, and a
// compensating swap between coincident edges IS caught (physical keying).

use super::*;

fn pid(txf: u128, input: u32, down: u8, rev_tag: u8) -> PhysicalEdgeId {
    PhysicalEdgeId {
        txf: uuid::Uuid::from_u128(txf),
        input,
        downstream: ObjectId(uuid::Uuid::from_u128(down as u128)),
        downstream_rev: RevisionId::parse(&format!("rev1:{}", format!("{rev_tag:02x}").repeat(32)))
            .unwrap(),
    }
}

// ---- structural class erases only the verdict --------------------------------

#[test]
fn the_four_stale_verdict_states_collapse_to_one() {
    for s in [
        EdgeState::VersionStale,
        EdgeState::StaleValid,
        EdgeState::StaleContradicted,
        EdgeState::StaleUnknown,
    ] {
        assert_eq!(structural_class(Some(&s)), StructuralClass::Stale);
    }
}

#[test]
fn fresh_subclasses_are_kept() {
    assert_eq!(
        structural_class(Some(&EdgeState::Fresh {
            ratified: true,
            ahead: false
        })),
        StructuralClass::Fresh {
            ratified: true,
            ahead: false
        }
    );
    assert_ne!(
        structural_class(Some(&EdgeState::Fresh {
            ratified: true,
            ahead: false
        })),
        structural_class(Some(&EdgeState::Fresh {
            ratified: false,
            ahead: false
        })),
        "a ratification IS a structural change",
    );
}

#[test]
fn none_is_retired() {
    assert_eq!(structural_class(None), StructuralClass::Retired);
}

// ---- the precondition --------------------------------------------------------

#[test]
fn a_concurrent_semantic_check_does_not_block_accept() {
    let e = pid(1, 0, 2, 0xaa);
    // Preview saw VersionStale; by accept time a check landed → StaleContradicted.
    let mut preview = ClassMap::new();
    preview.insert(e.clone(), structural_class(Some(&EdgeState::VersionStale)));
    let mut now = ClassMap::new();
    now.insert(e, structural_class(Some(&EdgeState::StaleContradicted)));
    // Both collapse to Stale → the precondition HOLDS (accept proceeds).
    assert!(precondition_holds(&preview, &now));
}

#[test]
fn a_base_head_move_blocks_accept() {
    let e = pid(1, 0, 2, 0xaa);
    let mut preview = ClassMap::new();
    preview.insert(
        e.clone(),
        structural_class(Some(&EdgeState::Fresh {
            ratified: false,
            ahead: false,
        })),
    );
    let mut now = ClassMap::new();
    // The upstream advanced → the edge is now stale. Fresh != Stale → reject.
    now.insert(e, structural_class(Some(&EdgeState::VersionStale)));
    assert!(!precondition_holds(&preview, &now));
}

#[test]
fn a_retirement_blocks_accept() {
    let e = pid(1, 0, 2, 0xaa);
    let mut preview = ClassMap::new();
    preview.insert(e.clone(), structural_class(Some(&EdgeState::VersionStale)));
    let mut now = ClassMap::new();
    now.insert(e, structural_class(None)); // Some -> None
    assert!(!precondition_holds(&preview, &now));
}

#[test]
fn a_compensating_swap_between_coincident_edges_is_caught() {
    // Two edges that SHARE a SemanticEdgeKey (same upstream/pinned/downstream/rev)
    // but differ physically by txf — a bag key would collapse them; the physical
    // key keeps them apart, so a swap of their classes is detected.
    let a = pid(1, 0, 2, 0xaa);
    let b = pid(9, 0, 2, 0xaa); // same downstream+rev, different txf → distinct pid

    let fresh = structural_class(Some(&EdgeState::Fresh {
        ratified: false,
        ahead: false,
    }));
    let stale = structural_class(Some(&EdgeState::VersionStale));

    let mut preview = ClassMap::new();
    preview.insert(a.clone(), fresh.clone());
    preview.insert(b.clone(), stale.clone());

    // Swap: A becomes stale, B becomes fresh. An unkeyed bag {Fresh:1, Stale:1}
    // would be unchanged; the physically-keyed map differs → reject.
    let mut now = ClassMap::new();
    now.insert(a, stale);
    now.insert(b, fresh);
    assert!(!precondition_holds(&preview, &now));
}

#[test]
fn identical_maps_hold() {
    let e = pid(1, 0, 2, 0xaa);
    let mut m = ClassMap::new();
    m.insert(e, StructuralClass::Stale);
    assert!(precondition_holds(&m, &m.clone()));
}
