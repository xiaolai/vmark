// WI-AL0.3 — attribution wire design: principal tagged union (four states kept distinct), per-connection UUID, bounded sessionLabel, and the Rust↔TS request-envelope fixture
//! Tests for `attribution.rs` (included via `#[path]`).

use super::*;
use crate::mcp_bridge::principal::BridgePrincipal;
use crate::mcp_bridge::state::{BridgeState, ClientConnection};
use crate::mcp_bridge::types::{ClientIdentity, McpRequestEvent, McpResponse};
use serde_json::json;
use tokio::sync::{mpsc, oneshot};

fn wire(principal: &BridgePrincipal) -> serde_json::Value {
    serde_json::to_value(PrincipalWire::from(principal)).expect("serialize principal")
}

// -- the principal: four states, four tags, never collapsed ------------------

#[test]
fn each_principal_state_serializes_as_its_own_tag() {
    assert_eq!(
        wire(&BridgePrincipal::Anonymous),
        json!({ "kind": "anonymous" })
    );
    assert_eq!(
        wire(&BridgePrincipal::Unrecognized),
        json!({ "kind": "unrecognized" })
    );
    assert_eq!(
        wire(&BridgePrincipal::Ambiguous(vec![
            "claude".into(),
            "codex".into()
        ])),
        json!({ "kind": "ambiguous", "providers": ["claude", "codex"] })
    );
    assert_eq!(
        wire(&BridgePrincipal::Provider("claude".into())),
        json!({ "kind": "provider", "providerId": "claude" })
    );
}

#[test]
fn no_principal_state_is_collapsed_into_another_or_into_unknown() {
    let kinds: Vec<String> = [
        BridgePrincipal::Anonymous,
        BridgePrincipal::Unrecognized,
        BridgePrincipal::Ambiguous(vec!["a".into(), "b".into()]),
        BridgePrincipal::Provider("a".into()),
    ]
    .iter()
    .map(|p| wire(p)["kind"].as_str().expect("kind").to_string())
    .collect();
    let mut unique = kinds.clone();
    unique.sort();
    unique.dedup();
    assert_eq!(unique.len(), 4, "four states, four tags: {kinds:?}");
    assert!(!kinds.iter().any(|k| k == "unknown"));
}

#[test]
fn the_wire_principal_round_trips_through_its_own_decoder() {
    for p in [
        BridgePrincipal::Anonymous,
        BridgePrincipal::Unrecognized,
        BridgePrincipal::Ambiguous(vec!["克劳德".into(), "codex".into()]),
        BridgePrincipal::Provider("克劳德".into()),
    ] {
        let wire_value = PrincipalWire::from(&p);
        let text = serde_json::to_string(&wire_value).expect("serialize");
        let back: PrincipalWire = serde_json::from_str(&text).expect("deserialize");
        assert_eq!(back, wire_value);
    }
}

// -- the connection id -------------------------------------------------------

#[test]
fn connection_ids_are_random_v4_uuids_and_never_repeat() {
    let a = mint_connection_id();
    let b = mint_connection_id();
    assert_ne!(a, b);
    assert_eq!(a.get_version_num(), 4);
    assert_eq!(a.get_variant(), uuid::Variant::RFC4122);
    assert!(!a.is_nil());
}

// -- sessionLabel: untrusted, ≤ 128 UTF-8 bytes, refused rather than cut -----

#[test]
fn an_absent_or_blank_session_label_is_no_label() {
    assert_eq!(validate_session_label(None), Ok(None));
    assert_eq!(validate_session_label(Some("")), Ok(None));
    assert_eq!(validate_session_label(Some("   ")), Ok(None));
}

#[test]
fn a_session_label_at_the_byte_limit_is_kept_verbatim() {
    let ascii = "a".repeat(MAX_SESSION_LABEL_BYTES);
    assert_eq!(
        validate_session_label(Some(&ascii)),
        Ok(Some(ascii.clone()))
    );
    // 42 CJK characters are 126 bytes; two ASCII bytes make exactly 128.
    let cjk = format!("{}ab", "审".repeat(42));
    assert_eq!(cjk.len(), MAX_SESSION_LABEL_BYTES);
    assert_eq!(validate_session_label(Some(&cjk)), Ok(Some(cjk.clone())));
    // 32 four-byte emoji are exactly 128 bytes.
    let emoji = "🦀".repeat(32);
    assert_eq!(
        validate_session_label(Some(&emoji)),
        Ok(Some(emoji.clone()))
    );
}

#[test]
fn a_session_label_over_the_byte_limit_is_refused_not_truncated() {
    let ascii = "a".repeat(MAX_SESSION_LABEL_BYTES + 1);
    let err = validate_session_label(Some(&ascii)).expect_err("129 bytes is over");
    assert!(err.starts_with("SESSION_LABEL_TOO_LONG:"), "{err}");
    // The limit is BYTES: 43 CJK characters are only 43 chars but 129 bytes.
    let cjk = "审".repeat(43);
    assert_eq!(cjk.chars().count(), 43);
    assert!(validate_session_label(Some(&cjk))
        .expect_err("129 bytes")
        .starts_with("SESSION_LABEL_TOO_LONG:"));
}

#[test]
fn a_session_label_with_control_characters_is_refused_not_stripped() {
    for bad in [
        "review\nforged log line",
        "a\u{1b}[31m",
        "tab\there",
        "nul\u{0}",
    ] {
        let err = validate_session_label(Some(bad)).expect_err("control characters");
        assert!(err.starts_with("SESSION_LABEL_INVALID:"), "{err}");
    }
}

/// Bidirectional formatting characters are not `char::is_control`, yet they
/// reorder how the label (and the text around it in the history panel)
/// renders, so a label could spoof another session's attribution.
#[test]
fn a_session_label_with_bidi_formatting_characters_is_refused() {
    for bad in [
        "review\u{202E}gpj.md",
        "\u{2066}claude\u{2069}",
        "a\u{200F}b",
        "a\u{200E}b",
        "\u{061C}عربي",
        "\u{202A}x\u{202C}",
        "\u{2068}x",
    ] {
        let err = validate_session_label(Some(bad)).expect_err("bidi formatting");
        assert!(err.starts_with("SESSION_LABEL_INVALID:"), "{bad:?}: {err}");
    }
    // Right-to-left text itself, CJK, emoji and a joiner are ordinary labels.
    for ok in ["مراجعة", "עברית review", "重构 session", "👩‍💻 pair"] {
        assert_eq!(
            validate_session_label(Some(ok)).expect("ordinary label"),
            Some(ok.to_string())
        );
    }
}

// -- attribution of a connection ---------------------------------------------

fn client(principal: BridgePrincipal, identity: Option<ClientIdentity>) -> ClientConnection {
    let (tx, rx) = mpsc::channel::<String>(1);
    std::mem::forget(rx);
    ClientConnection {
        tx,
        shutdown: None,
        identity,
        principal,
        connection_id: uuid::Uuid::from_u128(0x1234),
    }
}

fn labelled(name: &str, version: Option<&str>, label: Option<&str>) -> ClientIdentity {
    ClientIdentity {
        name: name.into(),
        version: version.map(str::to_string),
        session_label: label.map(str::to_string),
    }
}

#[test]
fn a_connections_attribution_carries_principal_id_label_and_untrusted_name_separately() {
    let mut state = BridgeState::default();
    state.clients.insert(
        7,
        client(
            BridgePrincipal::Provider("claude".into()),
            // The client CLAIMS to be codex; the principal says claude.
            Some(labelled("codex-cli", Some("1.0"), Some("review pass"))),
        ),
    );
    let a = attribution_for(&state, 7).expect("connected");
    assert_eq!(
        a.principal,
        PrincipalWire::Provider {
            provider_id: "claude".into()
        }
    );
    assert_eq!(a.connection_id, "00000000-0000-0000-0000-000000001234");
    assert_eq!(a.session_label.as_deref(), Some("review pass"));
    assert_eq!(a.display_name.as_deref(), Some("codex-cli v1.0"));
}

#[test]
fn an_unidentified_connection_has_no_label_and_no_name_but_keeps_its_principal() {
    let mut state = BridgeState::default();
    state
        .clients
        .insert(8, client(BridgePrincipal::Unrecognized, None));
    let a = attribution_for(&state, 8).expect("connected");
    assert_eq!(a.principal, PrincipalWire::Unrecognized);
    assert_eq!(a.session_label, None);
    assert_eq!(a.display_name, None);
}

#[test]
fn a_disconnected_client_has_no_attribution_rather_than_a_default_one() {
    assert!(attribution_for(&BridgeState::default(), 99).is_none());
}

#[test]
fn registering_an_attributed_request_for_a_gone_client_registers_nothing() {
    let mut state = BridgeState::default();
    let (tx, _rx) = oneshot::channel::<McpResponse>();
    let err = register_attributed(&mut state, 99, "bridge-x".into(), tx).expect_err("gone");
    assert_eq!(err, "Bridge stopped");
    assert!(state.pending.is_empty(), "no pending entry may leak");
}

#[test]
fn registering_an_attributed_request_returns_the_connections_attribution() {
    let mut state = BridgeState::default();
    state
        .clients
        .insert(3, client(BridgePrincipal::Anonymous, None));
    let (tx, _rx) = oneshot::channel::<McpResponse>();
    let a = register_attributed(&mut state, 3, "bridge-y".into(), tx).expect("registered");
    assert_eq!(a.principal, PrincipalWire::Anonymous);
    assert!(state.pending.contains_key("bridge-y"));
}

// -- the Rust↔TS envelope bond -------------------------------------------------

/// One envelope per principal state, built through the production
/// `attribution_for` and serialized as the real `McpRequestEvent`.
fn canonical_envelopes() -> serde_json::Value {
    let cases: [(&str, BridgePrincipal, Option<ClientIdentity>); 4] = [
        ("anonymous", BridgePrincipal::Anonymous, None),
        (
            "unrecognized",
            BridgePrincipal::Unrecognized,
            Some(labelled("claude-code", None, None)),
        ),
        (
            "ambiguous",
            BridgePrincipal::Ambiguous(vec!["claude".into(), "codex".into()]),
            Some(labelled("codex-cli", Some("0.9"), Some("nightly sweep"))),
        ),
        (
            "provider",
            BridgePrincipal::Provider("claude".into()),
            // Exactly 128 UTF-8 bytes of CJK + ASCII: the TS twin must count
            // bytes the way Rust does.
            Some(labelled(
                "claude-code",
                Some("2.1"),
                Some(&format!("{}ab", "审".repeat(42))),
            )),
        ),
    ];
    let mut envelopes = serde_json::Map::new();
    for (n, (name, principal, identity)) in cases.into_iter().enumerate() {
        let mut state = BridgeState::default();
        let mut c = client(principal, identity);
        // A v4, RFC 4122-variant id, the only shape `mint_connection_id`
        // emits and the TypeScript validator accepts.
        c.connection_id =
            uuid::Uuid::from_u128(0x0000_0000_0000_4000_8000_0000_00a1_0000 + n as u128);
        state.clients.insert(1, c);
        let event = McpRequestEvent {
            id: format!("bridge-{}", n + 1),
            request_type: "vmark.document.write".into(),
            args_json: r#"{"tabId":"t1"}"#.into(),
            attribution: attribution_for(&state, 1).expect("connected"),
        };
        envelopes.insert(
            name.to_string(),
            serde_json::to_value(&event).expect("serialize event"),
        );
    }
    json!({
        "//": [
            "GENERATED by the Rust test `request_envelope_fixture_stays_in_sync`",
            "(src-tauri/src/mcp_bridge/attribution.test.rs). Do not hand-edit — regenerate with",
            "UPDATE_FIXTURES=1 cargo test --manifest-path src-tauri/Cargo.toml request_envelope_fixture",
            "Consumed by src/services/mcpBridge/attribution.test.ts, which parses every envelope",
            "with the TypeScript validator: the event envelope is not covered by gen:mcp-contracts.",
            "bidiFormattingCodePoints is every character `peer_text::is_bidi_formatting` matches:",
            "the TypeScript label rules (webview and sidecar) must refuse exactly these.",
        ],
        "sessionLabelMaxBytes": MAX_SESSION_LABEL_BYTES,
        "bidiFormattingCodePoints": (0..=0x10FFFF_u32)
            .filter_map(char::from_u32)
            .filter(|c| crate::peer_text::is_bidi_formatting(*c))
            .map(|c| c as u32)
            .collect::<Vec<_>>(),
        "envelopes": envelopes,
    })
}

#[test]
fn request_envelope_fixture_stays_in_sync() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../src/test/fixtures/mcpRequestEnvelope.json");
    let generated = canonical_envelopes();

    if std::env::var("UPDATE_FIXTURES").as_deref() == Ok("1") {
        std::fs::write(
            &path,
            serde_json::to_string_pretty(&generated).expect("serialize") + "\n",
        )
        .expect("write fixture");
        return;
    }

    let committed: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&path).unwrap_or_else(|e| {
            panic!(
                "read {}: {e} — regenerate with UPDATE_FIXTURES=1",
                path.display()
            )
        }))
        .expect("parse committed fixture");

    assert_eq!(
        committed, generated,
        "the committed envelope fixture is stale — regenerate it with \
         UPDATE_FIXTURES=1 and update the TypeScript validator it feeds"
    );
}
