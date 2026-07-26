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
    // style/eval/session bind the exact payload; minting without one would create
    // authority spendable on ANY script.
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::AiSandbox);
    for op in ["style", "eval", "session"] {
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
    let surface = enabled_surface();
    commit_tab(&surface, "t", "https://ex.com/", AutomationMode::AiSandbox);
    let mut last = Ok(());
    for _ in 0..(MAX_ONE_SHOTS + 8) {
        last = mint_one_shot(&surface, "t", 0, "https://ex.com", "click", None, None);
    }
    assert!(last.is_err(), "expected the cap to refuse further mints");
    assert!(surface.one_shots.lock().unwrap().len() <= MAX_ONE_SHOTS);
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
        vec![
            grant("https://ex.com", &["click", "read"]),
            grant("https://*.ex.com", &["read"]),
            grant("http://localhost:3000", &["click"]),
        ],
    )
    .unwrap();
    assert_eq!(surface.grants.lock().unwrap().len(), 3);
}

#[test]
fn an_unenforceable_grant_pattern_is_refused_like_a_one_shot_is() {
    // Parity with `mint_one_shot`. Before WI-1.6 this stored inert authority: the
    // user sees a grant in the UI that the guard can never match, and nothing says so.
    let surface = enabled_surface();
    let err = set_standing_grants(
        &surface,
        vec![
            grant("https://ok.com", &["click"]),
            grant("https://*.example.com@evil.com", &["click"]),
        ],
    )
    .unwrap_err();
    assert!(err.contains("not a valid origin pattern"), "got: {err}");
}

#[test]
fn a_refused_batch_leaves_the_previous_grants_untouched() {
    // No partial application: the store is authority, so a rejected sync must not
    // leave it half-written.
    let surface = enabled_surface();
    set_standing_grants(&surface, vec![grant("https://ex.com", &["click"])]).unwrap();
    let _ = set_standing_grants(&surface, vec![grant("bogus", &["click"])]);
    let current = surface.grants.lock().unwrap();
    assert_eq!(current.len(), 1);
    assert_eq!(current[0].origin_pattern, "https://ex.com");
}

#[test]
fn a_grant_carrying_an_unknown_operation_is_refused() {
    let surface = enabled_surface();
    let err =
        set_standing_grants(&surface, vec![grant("https://ex.com", &["frobnicate"])]).unwrap_err();
    assert!(err.contains("not a browser operation"), "got: {err}");
}

#[test]
fn an_empty_batch_revokes_everything() {
    // Revocation must always be applicable — it is the safe direction.
    let surface = enabled_surface();
    set_standing_grants(&surface, vec![grant("https://ex.com", &["click"])]).unwrap();
    set_standing_grants(&surface, vec![]).unwrap();
    assert!(surface.grants.lock().unwrap().is_empty());
}

#[test]
fn the_grant_vector_is_bounded() {
    let surface = enabled_surface();
    let many: Vec<StandingGrant> = (0..(MAX_GRANTS + 1))
        .map(|i| grant(&format!("https://h{i}.com"), &["click"]))
        .collect();
    assert!(set_standing_grants(&surface, many).is_err());
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
    set_standing_grants(&surface, emitted.clone())
        .expect("the frontend's own pattern format must validate");
    assert_eq!(surface.grants.lock().unwrap().len(), emitted.len());
}

#[test]
fn every_operation_the_vocabulary_defines_is_accepted_in_a_grant() {
    // A grant may legally carry any KNOWN operation. The guard separately refuses
    // never-grantable ones (`eval`, `session`) at decision time — that is the right
    // layer for it, and duplicating the rule here would let the two drift.
    let surface = enabled_surface();
    let all = [
        "read", "attach", "click", "type", "scroll", "key", "style", "navigate", "publish",
        "upload", "eval", "session",
    ];
    for op in all {
        set_standing_grants(&surface, vec![grant("https://ex.com:443", &[op])])
            .unwrap_or_else(|e| panic!("known operation '{op}' rejected: {e}"));
    }
}
