// WI-1.1..1.6 — the authorization INPUT layer: minting one-shots, attaching human
// tabs, validating standing grants, and parsing an act target. `authorize.rs` decides
// whether an operation may run; this decides what authority may exist in the first
// place, and it had no tests at all (it lived inline in `commands_auth.rs`, which has
// no test module).
//
// These are the paths whose comments cite `(Audit, High)` fixes — a stale approved
// generation, a half-specified target, a substituted payload. They regressed once
// already; this is the net.
use super::*;
use crate::browser::registry::AutomationMode;

fn enabled_surface() -> BrowserSurface {
    let surface = BrowserSurface::default();
    {
        let mut policy = surface.ai_policy.lock().unwrap();
        policy.enabled = true;
        policy.epoch = 0;
    }
    surface
}

fn commit_tab(surface: &BrowserSurface, tab_id: &str, url: &str, mode: AutomationMode) {
    let mut reg = surface.registry.lock().unwrap();
    reg.create_with_mode(tab_id, "main", mode).unwrap();
    reg.begin_navigation(tab_id, url).unwrap();
    reg.set_committed_url(tab_id, url).unwrap();
    reg.set_policy_epoch(tab_id, 0).unwrap();
}

fn grant(pattern: &str, ops: &[&str]) -> StandingGrant {
    StandingGrant {
        origin_pattern: pattern.to_string(),
        operations: ops.iter().map(|o| o.to_string()).collect(),
    }
}

/// The driver's grants for one window — the slice `authorize.rs` reads for a tab
/// that window owns. Absent (a window that never synced) reads as empty: default-deny.
fn grants_of(surface: &BrowserSurface, window: &str) -> Vec<StandingGrant> {
    surface
        .grants
        .lock()
        .unwrap()
        .get(window)
        .cloned()
        .unwrap_or_default()
}

// ---------------------------------------------------------------- WI-1.1 target

#[test]
fn a_complete_target_parses() {
    let target = parse_act_target(Some("button".into()), Some("Save".into())).unwrap();
    let target = target.expect("both halves present ⇒ a target");
    assert_eq!(target.role, "button");
    assert_eq!(target.name, "Save");
}

#[test]
fn no_target_is_legal() {
    assert!(parse_act_target(None, None).unwrap().is_none());
}

#[test]
fn a_half_specified_target_is_refused_not_treated_as_targetless() {
    // (Audit, High) The dangerous reading: `(Some(role), None)` falling through to a
    // target-LESS authorization, which a target-less one-shot would then satisfy —
    // silently acting on an element the user never approved. A caller bug in an
    // authorization path must be a refusal.
    let err = parse_act_target(Some("button".into()), None).unwrap_err();
    assert!(err.contains("both role and name"), "got: {err}");
    let err = parse_act_target(None, Some("Save".into())).unwrap_err();
    assert!(err.contains("both role and name"), "got: {err}");
}

// ------------------------------------------------------------- WI-1.2/1.5 mint

#[test]
fn minting_binds_the_approved_generation_not_the_current_one() {
    // (Audit, High) The page can navigate between the prompt being raised and the
    // user clicking "Allow once". Stamping the CURRENT generation would bind the
    // approval to a page the user never saw.
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::AiSandbox);
    {
        // The tab moves on while the prompt is up. `begin_navigation` deliberately
        // does NOT bump the generation (registry_navigation.rs:8 — a request is not a
        // commit); the nav delegate bumps it when the new page actually commits, so
        // that is what a navigation-during-prompt really looks like.
        let mut reg = surface.registry.lock().unwrap();
        reg.begin_navigation("t", "https://ex.com/next").unwrap();
        reg.bump_generation("t").unwrap();
        reg.set_committed_url("t", "https://ex.com/next").unwrap();
    }
    let err = mint_one_shot(&surface, "t", 0, "https://ex.com", "click", None, None).unwrap_err();
    assert!(err.contains("stale approval"), "got: {err}");
    assert!(surface.one_shots.lock().unwrap().is_empty());
}

#[test]
fn minting_on_the_current_generation_succeeds() {
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::AiSandbox);
    let current_gen = surface.registry.lock().unwrap().generation("t").unwrap();
    mint_one_shot(
        &surface,
        "t",
        current_gen,
        "https://ex.com",
        "click",
        None,
        None,
    )
    .unwrap();
    assert_eq!(surface.one_shots.lock().unwrap().len(), 1);
}

#[test]
fn an_unenforceable_origin_pattern_is_refused() {
    // Storing authority the guard could never match is inert authority — it silently
    // never fires, so the user believes they approved something that does nothing.
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::AiSandbox);
    for bad in [
        "https://*.example.com@evil.com", // userinfo reinterprets the authority
        "https://ex.com/path",            // not a bare origin
        "https://*",                      // stray wildcard
        "not a url",
        "",
    ] {
        let err = mint_one_shot(&surface, "t", 0, bad, "click", None, None).unwrap_err();
        assert!(err.contains("not a valid origin pattern"), "{bad} → {err}");
    }
    assert!(surface.one_shots.lock().unwrap().is_empty());
}

#[test]
fn an_operation_outside_the_closed_vocabulary_is_refused() {
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::AiSandbox);
    for bad in ["Click", "CLICK", "frobnicate", ""] {
        let err = mint_one_shot(&surface, "t", 0, "https://ex.com", bad, None, None).unwrap_err();
        assert!(err.contains("not a browser operation"), "{bad} → {err}");
    }
}

#[test]
fn a_payload_binding_operation_must_carry_its_script() {
    // style/eval/session bind the exact payload, and so do type/key/scroll (audit
    // 20260903 A-05 — their built script embeds the text, key or delta); minting
    // without one would create authority spendable on ANY script.
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::AiSandbox);
    for op in ["style", "eval", "session", "type", "key", "scroll"] {
        let err = mint_one_shot(&surface, "t", 0, "https://ex.com", op, None, None).unwrap_err();
        assert!(err.contains("requires the exact script"), "{op} → {err}");
    }
}

#[test]
fn an_approved_payload_cannot_be_spent_on_a_substituted_one() {
    // (Security review P5, High #1) The composition that matters — not that SHA-256
    // works, but that a one-shot minted for script A refuses script B at consume time.
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::AiSandbox);
    mint_one_shot(
        &surface,
        "t",
        0,
        "https://ex.com",
        "eval",
        None,
        Some("return 1;".into()),
    )
    .unwrap();

    let mut shots = surface.one_shots.lock().unwrap();
    let approved = script_hash("return 1;");
    let substituted = script_hash("return document.cookie;");
    assert!(
        !crate::browser::one_shot::consume_one_shot(
            &mut shots,
            "t",
            0,
            "https://ex.com/",
            "eval",
            None,
            Some(&substituted),
        ),
        "a substituted script must not spend the approval"
    );
    assert!(
        crate::browser::one_shot::consume_one_shot(
            &mut shots,
            "t",
            0,
            "https://ex.com/",
            "eval",
            None,
            Some(&approved),
        ),
        "the approved script must still be spendable"
    );
}

#[test]
fn minting_is_bounded() {
    // An untrusted client must not be able to grow the one-shot vector without bound.
    // DISTINCT bindings: an identical re-mint is idempotent and never grows the
    // vector (audit 20260903 A-04), so it cannot exercise the cap.
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::AiSandbox);
    for i in 0..(MAX_ONE_SHOTS + 8) {
        let target = Some(OneShotTarget {
            role: "button".into(),
            name: format!("b{i}"),
        });
        mint_one_shot(&surface, "t", 0, "https://ex.com", "click", target, None)
            .expect("at the cap the OLDEST unspent one-shot is evicted, the new one is kept");
    }
    let shots = surface.one_shots.lock().unwrap();
    assert_eq!(shots.len(), MAX_ONE_SHOTS);
    let has = |name: &str| {
        shots
            .iter()
            .any(|s| s.target.as_ref().is_some_and(|t| t.name == name))
    };
    // FIFO: the first eight are gone, the newest is present (parity with the frontend mirror).
    assert!(
        !has("b0") && !has("b7"),
        "the oldest one-shots must have been evicted"
    );
    assert!(has("b8") && has(&format!("b{}", MAX_ONE_SHOTS + 7)));
}

// -------------------------------------------------------------- WI-1.3 attach

#[test]
fn attaching_a_non_human_tab_is_refused() {
    let surface = enabled_surface();
    commit_tab(&surface, "ai", "https://ex.com/", AutomationMode::AiSandbox);
    let err = attach_ai_tab(&surface, "ai", 0, false).unwrap_err();
    assert_eq!(err, "TAB_NOT_HUMAN");
    assert!(!surface.is_tab_attached("ai", 0));
}

#[test]
fn attaching_at_a_stale_generation_is_refused() {
    let surface = enabled_surface();
    commit_tab(&surface, "h", "https://ex.com/", AutomationMode::Human);
    let err = attach_ai_tab(&surface, "h", 99, false).unwrap_err();
    assert_eq!(err, "STALE_NAVIGATION");
    assert!(!surface.is_tab_attached("h", 99));
}

#[test]
fn attaching_an_unknown_tab_is_refused() {
    let surface = enabled_surface();
    assert!(attach_ai_tab(&surface, "ghost", 0, false).is_err());
}

#[test]
fn a_human_tab_attaches_at_its_current_generation() {
    let surface = enabled_surface();
    commit_tab(&surface, "h", "https://ex.com/", AutomationMode::Human);
    let current_gen = surface.registry.lock().unwrap().generation("h").unwrap();
    attach_ai_tab(&surface, "h", current_gen, false).unwrap();
    assert!(surface.is_tab_attached("h", current_gen));
}

// -------------------------------------------------------------- WI-1.6 grants

#[test]
fn well_formed_grants_are_accepted() {
    let surface = enabled_surface();
    set_standing_grants(
        &surface,
        "main",
        vec![
            grant("https://ex.com", &["click", "read"]),
            grant("https://*.ex.com", &["read"]),
            grant("http://localhost:3000", &["click"]),
        ],
    )
    .unwrap();
    assert_eq!(grants_of(&surface, "main").len(), 3);
}

#[test]
fn an_unenforceable_grant_pattern_is_refused_like_a_one_shot_is() {
    // Parity with `mint_one_shot`. Before WI-1.6 this stored inert authority: the
    // user sees a grant in the UI that the guard can never match, and nothing says so.
    let surface = enabled_surface();
    let err = set_standing_grants(
        &surface,
        "main",
        vec![
            grant("https://ok.com", &["click"]),
            grant("https://*.example.com@evil.com", &["click"]),
        ],
    )
    .unwrap_err();
    assert!(err.contains("not a valid origin pattern"), "got: {err}");
}

#[test]
fn a_refused_batch_clears_rather_than_retaining_prior_authority() {
    // [Audit Medium] This previously asserted the opposite — that a rejected batch
    // leaves the old grants in place — and a comment claimed revocation "always
    // applies". Both were wrong. `set_standing_grants` is a REPLACEMENT sync, so a
    // batch that revokes A while carrying one malformed unrelated entry would, under
    // retain-on-error, leave A authorized indefinitely: the user revokes access and
    // it silently does not take. Failing CLOSED costs a re-approval; failing open
    // outlives a revocation.
    let surface = enabled_surface();
    set_standing_grants(&surface, "main", vec![grant("https://ex.com", &["click"])]).unwrap();
    let err = set_standing_grants(
        &surface,
        "main",
        vec![
            grant("https://ex.com", &["click"]),
            grant("bogus", &["click"]),
        ],
    )
    .unwrap_err();
    assert!(err.contains("not a valid origin pattern"), "got: {err}");
    assert!(
        grants_of(&surface, "main").is_empty(),
        "a rejected replacement must not leave prior authority standing"
    );
}

#[test]
fn a_grant_carrying_an_unknown_operation_is_refused() {
    let surface = enabled_surface();
    let err = set_standing_grants(
        &surface,
        "main",
        vec![grant("https://ex.com", &["frobnicate"])],
    )
    .unwrap_err();
    assert!(err.contains("not a browser operation"), "got: {err}");
}

#[test]
fn an_empty_batch_revokes_everything() {
    // Revocation must always be applicable — it is the safe direction.
    let surface = enabled_surface();
    set_standing_grants(&surface, "main", vec![grant("https://ex.com", &["click"])]).unwrap();
    set_standing_grants(&surface, "main", vec![]).unwrap();
    assert!(grants_of(&surface, "main").is_empty());
}

#[test]
fn the_grant_vector_is_bounded() {
    let surface = enabled_surface();
    let many: Vec<StandingGrant> = (0..(MAX_GRANTS + 1))
        .map(|i| grant(&format!("https://h{i}.com"), &["click"]))
        .collect();
    assert!(set_standing_grants(&surface, "main", many).is_err());
}

// ------------------------------------------------- WI-1.6 frontend/Rust parity

// The validation added in WI-1.6 is only safe if it accepts every pattern the
// frontend actually produces. `grants.ts:74` builds them as
// `${scheme}://${wildcard ? "*." : ""}${host}:${port}` — ALWAYS with an explicit
// port, including the default one. If Rust rejected that shape, the first grant sync
// after this change would fail closed and silently revoke the user's authority.
//
// This is the guard on that: a frontend change to the pattern format now breaks a
// Rust test rather than the running app.
#[test]
fn every_pattern_shape_the_frontend_emits_is_accepted() {
    let surface = enabled_surface();
    let emitted = vec![
        grant("https://example.com:443", &["click"]), // default port, written explicitly
        grant("http://example.com:80", &["click"]),
        grant("https://*.example.com:443", &["read"]), // wildcard + default port
        grant("http://localhost:3000", &["click"]),    // dev origin, non-default port
        grant("https://example.com:8443", &["type"]),
        grant("http://127.0.0.1:5173", &["read"]),
        grant("https://xn--fsq.com:443", &["click"]), // punycode IDN
    ];
    set_standing_grants(&surface, "main", emitted.clone())
        .expect("the frontend's own pattern format must validate");
    assert_eq!(grants_of(&surface, "main").len(), emitted.len());
}

#[test]
fn a_grant_refuses_operations_that_can_never_be_granted() {
    // [Audit Medium] This test used to assert that EVERY known operation is
    // acceptable in a grant — locking in exactly the behaviour the module's own
    // principle forbids. `upload` is NEVER_AUTOMATED and `eval`/`session` are
    // NEVER_GRANTABLE, so the guard refuses all three regardless; storing them is
    // inert state that misrepresents to the user what they have allowed.
    let surface = enabled_surface();
    for op in ["upload", "eval", "session"] {
        let err = set_standing_grants(&surface, "main", vec![grant("https://ex.com:443", &[op])])
            .unwrap_err();
        assert!(
            err.contains("can never be granted"),
            "{op} should be refused at the storage boundary, got: {err}"
        );
    }
}

#[test]
fn a_grant_accepts_every_operation_that_is_actually_grantable() {
    let surface = enabled_surface();
    for op in [
        "read", "attach", "click", "type", "scroll", "key", "style", "navigate",
    ] {
        set_standing_grants(&surface, "main", vec![grant("https://ex.com:443", &[op])])
            .unwrap_or_else(|e| panic!("grantable operation '{op}' rejected: {e}"));
    }
}

#[test]
fn a_one_shot_refuses_a_never_automated_operation() {
    // Same principle on the one-shot side: `upload` can never be consumed, so
    // minting it occupies a slot and shows an approval that could never fire.
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::AiSandbox);
    let err = mint_one_shot(&surface, "t", 0, "https://ex.com", "upload", None, None).unwrap_err();
    assert!(err.contains("never automated"), "got: {err}");
    assert!(surface.one_shots.lock().unwrap().is_empty());
}

// ------------------------------------------------ audit 20260903 A-03 per window

#[test]
fn grants_are_kept_per_window_so_one_window_cannot_clobber_another() {
    // Two document windows each run their own grant sync. One process-wide vector
    // meant whichever window synced last silently replaced the other's grants.
    let surface = enabled_surface();
    set_standing_grants(&surface, "a", vec![grant("https://a.com", &["click"])]).unwrap();
    set_standing_grants(&surface, "b", vec![grant("https://b.com", &["read"])]).unwrap();
    assert_eq!(grants_of(&surface, "a").len(), 1);
    assert_eq!(grants_of(&surface, "a")[0].origin_pattern, "https://a.com");
    assert_eq!(grants_of(&surface, "b").len(), 1);
    assert_eq!(grants_of(&surface, "b")[0].origin_pattern, "https://b.com");

    // A re-sync from B replaces only B's slice.
    set_standing_grants(&surface, "b", vec![]).unwrap();
    assert!(grants_of(&surface, "b").is_empty());
    assert_eq!(
        grants_of(&surface, "a").len(),
        1,
        "A's grant must survive B's revocation"
    );
}

#[test]
fn a_rejected_batch_clears_only_the_window_that_sent_it() {
    let surface = enabled_surface();
    set_standing_grants(&surface, "a", vec![grant("https://a.com", &["click"])]).unwrap();
    set_standing_grants(&surface, "b", vec![grant("https://b.com", &["click"])]).unwrap();
    set_standing_grants(&surface, "b", vec![grant("bogus", &["click"])]).unwrap_err();
    assert!(
        grants_of(&surface, "b").is_empty(),
        "fail closed for the sender"
    );
    assert_eq!(
        grants_of(&surface, "a").len(),
        1,
        "another window's authority is untouched"
    );
}

#[test]
fn the_grant_cap_is_per_window() {
    let surface = enabled_surface();
    let full: Vec<StandingGrant> = (0..MAX_GRANTS)
        .map(|i| grant(&format!("https://h{i}.com"), &["click"]))
        .collect();
    set_standing_grants(&surface, "a", full.clone()).unwrap();
    set_standing_grants(&surface, "b", full).unwrap();
    assert_eq!(grants_of(&surface, "a").len(), MAX_GRANTS);
    assert_eq!(grants_of(&surface, "b").len(), MAX_GRANTS);
}

// ------------------------------------------------ audit 20260903 A-04 idempotent

#[test]
fn minting_the_same_binding_twice_stores_one_one_shot() {
    // The frontend mints one approval through two paths (the grant-sync
    // subscription and the executor's awaited mint). Two entries would be two
    // authorizations for an action the user approved once — one orphan per step.
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::AiSandbox);
    let target = || {
        Some(OneShotTarget {
            role: "button".into(),
            name: "Publish".into(),
        })
    };
    mint_one_shot(&surface, "t", 0, "https://ex.com", "click", target(), None).unwrap();
    mint_one_shot(&surface, "t", 0, "https://ex.com", "click", target(), None).unwrap();
    assert_eq!(surface.one_shots.lock().unwrap().len(), 1);

    // Payload-bound: the same script is the same binding; a different one is not.
    let script = || Some("return 1;".to_string());
    mint_one_shot(&surface, "t", 0, "https://ex.com", "eval", None, script()).unwrap();
    mint_one_shot(&surface, "t", 0, "https://ex.com", "eval", None, script()).unwrap();
    assert_eq!(surface.one_shots.lock().unwrap().len(), 2);
    mint_one_shot(
        &surface,
        "t",
        0,
        "https://ex.com",
        "eval",
        None,
        Some("return 2;".into()),
    )
    .unwrap();
    assert_eq!(surface.one_shots.lock().unwrap().len(), 3);
}

#[test]
fn a_different_binding_is_a_second_one_shot() {
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::AiSandbox);
    let publish = Some(OneShotTarget {
        role: "button".into(),
        name: "Publish".into(),
    });
    let delete = Some(OneShotTarget {
        role: "button".into(),
        name: "Delete".into(),
    });
    mint_one_shot(&surface, "t", 0, "https://ex.com", "click", publish, None).unwrap();
    mint_one_shot(&surface, "t", 0, "https://ex.com", "click", delete, None).unwrap();
    mint_one_shot(&surface, "t", 0, "https://ex.com", "read", None, None).unwrap();
    assert_eq!(surface.one_shots.lock().unwrap().len(), 3);
}

#[test]
fn an_identical_re_mint_on_a_full_vector_is_still_ok() {
    // Idempotency is decided before the cap: the entry already exists, so nothing
    // is added and nothing is refused.
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::AiSandbox);
    for i in 0..MAX_ONE_SHOTS {
        let target = Some(OneShotTarget {
            role: "button".into(),
            name: format!("b{i}"),
        });
        mint_one_shot(&surface, "t", 0, "https://ex.com", "click", target, None).unwrap();
    }
    assert_eq!(surface.one_shots.lock().unwrap().len(), MAX_ONE_SHOTS);
    let existing = Some(OneShotTarget {
        role: "button".into(),
        name: "b0".into(),
    });
    mint_one_shot(&surface, "t", 0, "https://ex.com", "click", existing, None)
        .expect("an identical binding is the same approval, not a new slot");
    assert_eq!(surface.one_shots.lock().unwrap().len(), MAX_ONE_SHOTS);
}
