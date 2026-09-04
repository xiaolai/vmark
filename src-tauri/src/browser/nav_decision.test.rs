//! Audit 20260903 round 3, #22 — every branch of the navigation-policy decision,
//! walked as a table. The delegate that gathers these facts is macOS-only and
//! reachable only from a WebKit callback; the decision is not.

use super::*;
use AutomationMode::{AiSandbox, AiShared, Human};
use NavigationDecision::{BeginNavigation, Refuse, RideCurrentTicket};

const LIFECYCLES: [Option<Lifecycle>; 6] = [
    None,
    Some(Lifecycle::Creating),
    Some(Lifecycle::Live),
    Some(Lifecycle::Navigating),
    Some(Lifecycle::Crashed),
    Some(Lifecycle::Destroyed),
];
const MODES: [Option<AutomationMode>; 4] = [None, Some(Human), Some(AiSandbox), Some(AiShared)];
const BOOLS: [bool; 2] = [false, true];

/// Every combination of every input — 768 rows.
fn all_facts() -> Vec<NavigationFacts> {
    let mut rows = Vec::new();
    for mode in MODES {
        for browser_enabled in BOOLS {
            for lifecycle in LIFECYCLES {
                for has_ticket in BOOLS {
                    for destination_allowed in BOOLS {
                        for shared_approved in BOOLS {
                            for navigate_granted in BOOLS {
                                rows.push(NavigationFacts {
                                    mode,
                                    browser_enabled,
                                    lifecycle,
                                    has_ticket,
                                    destination_allowed,
                                    shared_approved,
                                    navigate_granted,
                                });
                            }
                        }
                    }
                }
            }
        }
    }
    rows
}

/// A fresh, fully permitted candidate on a live tab of `mode`.
fn permitted(mode: AutomationMode) -> NavigationFacts {
    NavigationFacts {
        mode: Some(mode),
        browser_enabled: true,
        lifecycle: Some(Lifecycle::Live),
        has_ticket: false,
        destination_allowed: true,
        shared_approved: true,
        navigate_granted: true,
    }
}

/// The same candidate arriving while a ticketed navigation is in flight.
fn riding(mode: AutomationMode) -> NavigationFacts {
    NavigationFacts {
        lifecycle: Some(Lifecycle::Navigating),
        has_ticket: true,
        ..permitted(mode)
    }
}

#[test]
fn a_disabled_browser_refuses_every_candidate_whatever_else_holds() {
    for facts in all_facts().into_iter().filter(|f| !f.browser_enabled) {
        assert_eq!(decide_navigation_action(facts), Refuse, "{facts:?}");
    }
}

#[test]
fn an_unknown_tab_is_refused() {
    for facts in all_facts().into_iter().filter(|f| f.mode.is_none()) {
        assert_eq!(decide_navigation_action(facts), Refuse, "{facts:?}");
    }
}

#[test]
fn a_human_tab_is_held_to_no_ai_policy_and_no_grant() {
    // Destination, approval and grants must not change a human tab's outcome.
    for facts in all_facts()
        .into_iter()
        .filter(|f| f.mode == Some(Human) && f.browser_enabled)
    {
        let expected = if facts.lifecycle == Some(Lifecycle::Navigating) && facts.has_ticket {
            RideCurrentTicket
        } else {
            BeginNavigation
        };
        assert_eq!(decide_navigation_action(facts), expected, "{facts:?}");
    }
}

#[test]
fn an_ai_tab_never_loads_a_blocked_destination() {
    for facts in all_facts()
        .into_iter()
        .filter(|f| matches!(f.mode, Some(AiSandbox | AiShared)) && !f.destination_allowed)
    {
        assert_eq!(decide_navigation_action(facts), Refuse, "{facts:?}");
    }
}

#[test]
fn a_sandbox_tab_needs_only_an_allowed_destination() {
    // Sandbox tabs have no shared approval and no grant to consult.
    for facts in all_facts()
        .into_iter()
        .filter(|f| f.mode == Some(AiSandbox) && f.browser_enabled && f.destination_allowed)
    {
        let expected = if facts.lifecycle == Some(Lifecycle::Navigating) && facts.has_ticket {
            RideCurrentTicket
        } else {
            BeginNavigation
        };
        assert_eq!(decide_navigation_action(facts), expected, "{facts:?}");
    }
}

#[test]
fn a_load_rides_the_current_ticket_only_while_navigating_with_a_ticket() {
    for mode in [Human, AiSandbox, AiShared] {
        assert_eq!(
            decide_navigation_action(riding(mode)),
            RideCurrentTicket,
            "{mode:?}"
        );
        // Navigating without a ticket is an invariant violation: fall through to a
        // fresh ticket rather than panic on the ticket that is not there.
        let no_ticket = NavigationFacts {
            has_ticket: false,
            ..riding(mode)
        };
        assert_eq!(
            decide_navigation_action(no_ticket),
            BeginNavigation,
            "{mode:?}"
        );
        // A ticket left on a tab that is no longer navigating does not get ridden.
        for lifecycle in LIFECYCLES
            .into_iter()
            .filter(|l| *l != Some(Lifecycle::Navigating))
        {
            let stale_ticket = NavigationFacts {
                lifecycle,
                ..riding(mode)
            };
            assert_eq!(
                decide_navigation_action(stale_ticket),
                BeginNavigation,
                "{mode:?} {lifecycle:?}"
            );
        }
    }
}

#[test]
fn a_fresh_shared_navigation_needs_standing_authority_and_no_past_approval_carries() {
    // There is no approval dialog at this native seam and MCP one-shots are consumed
    // by the command: standing `navigate` authority is the only way a page-initiated
    // shared navigation may begin. The approval of the PREVIOUS navigation is not it.
    let granted = permitted(AiShared);
    assert_eq!(decide_navigation_action(granted), BeginNavigation);
    let approval_only = NavigationFacts {
        navigate_granted: false,
        shared_approved: true,
        ..permitted(AiShared)
    };
    assert_eq!(decide_navigation_action(approval_only), Refuse);
    let nothing = NavigationFacts {
        navigate_granted: false,
        shared_approved: false,
        ..permitted(AiShared)
    };
    assert_eq!(decide_navigation_action(nothing), Refuse);
}

#[test]
fn a_riding_shared_navigation_takes_its_approval_or_standing_authority() {
    // A redirect hop on a shared tab is covered by the approval its navigation was
    // begun with, OR by a grant — either suffices, and neither present refuses.
    let approved = NavigationFacts {
        navigate_granted: false,
        shared_approved: true,
        ..riding(AiShared)
    };
    assert_eq!(decide_navigation_action(approved), RideCurrentTicket);
    let granted = NavigationFacts {
        navigate_granted: true,
        shared_approved: false,
        ..riding(AiShared)
    };
    assert_eq!(decide_navigation_action(granted), RideCurrentTicket);
    let neither = NavigationFacts {
        navigate_granted: false,
        shared_approved: false,
        ..riding(AiShared)
    };
    assert_eq!(decide_navigation_action(neither), Refuse);
}

#[test]
fn the_whole_table_obeys_the_invariants() {
    for facts in all_facts() {
        let decision = decide_navigation_action(facts);
        let enabled_known = facts.browser_enabled && facts.mode.is_some();
        if !enabled_known {
            assert_eq!(decision, Refuse, "{facts:?}");
            continue;
        }
        let ai = facts.mode != Some(Human);
        if ai && !facts.destination_allowed {
            assert_eq!(decision, Refuse, "{facts:?}");
        }
        // Riding is exactly `Navigating` + ticket, and never anything else.
        let ride_shape = facts.lifecycle == Some(Lifecycle::Navigating) && facts.has_ticket;
        if decision == RideCurrentTicket {
            assert!(ride_shape, "{facts:?}");
        }
        if decision == BeginNavigation {
            assert!(!ride_shape, "{facts:?}");
        }
        // Whatever is allowed on a shared tab had authority for it.
        if facts.mode == Some(AiShared) && decision != Refuse {
            let authority = facts.navigate_granted || (ride_shape && facts.shared_approved);
            assert!(authority, "{facts:?}");
        }
    }
}

// ── commit_allowed ────────────────────────────────────────────────────────────

fn all_commit_facts() -> Vec<CommitFacts> {
    let mut rows = Vec::new();
    for mode in [Human, AiSandbox, AiShared] {
        for browser_enabled in BOOLS {
            for epoch_current in BOOLS {
                for destination_allowed in BOOLS {
                    for shared_approved in BOOLS {
                        for navigate_granted in BOOLS {
                            rows.push(CommitFacts {
                                mode,
                                browser_enabled,
                                epoch_current,
                                destination_allowed,
                                shared_approved,
                                navigate_granted,
                            });
                        }
                    }
                }
            }
        }
    }
    rows
}

#[test]
fn a_commit_is_decided_by_posture_epoch_destination_and_authority() {
    for facts in all_commit_facts() {
        let expected = facts.browser_enabled
            && match facts.mode {
                Human => true,
                AiSandbox => facts.epoch_current && facts.destination_allowed,
                AiShared => {
                    facts.epoch_current
                        && facts.destination_allowed
                        && (facts.shared_approved || facts.navigate_granted)
                }
            };
        assert_eq!(commit_allowed(facts), expected, "{facts:?}");
    }
}

#[test]
fn a_disabled_browser_commits_nothing_not_even_a_human_page() {
    for facts in all_commit_facts()
        .into_iter()
        .filter(|f| !f.browser_enabled)
    {
        assert!(!commit_allowed(facts), "{facts:?}");
    }
}

#[test]
fn a_stale_epoch_or_blocked_destination_refuses_an_ai_commit_but_never_a_human_one() {
    for facts in all_commit_facts()
        .into_iter()
        .filter(|f| f.browser_enabled && (!f.epoch_current || !f.destination_allowed))
    {
        assert_eq!(commit_allowed(facts), facts.mode == Human, "{facts:?}");
    }
}
