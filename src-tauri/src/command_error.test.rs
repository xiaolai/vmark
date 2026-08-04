//! WI-14 — crate-wide `CommandError` wire-shape tests.
//!
//! The frontend branches on `code`, so the assertions here compare the exact
//! `serde_json::Value` Tauri puts on the IPC channel — never a substring of the
//! Display text. Absent optionals must be ABSENT, not `null`: a frontend guard
//! written as `"i18nKey" in err` would silently flip meaning otherwise.

use super::*;
use serde_json::json;

/// Every code paired with the exact wire string the frontend switches on.
/// Hand-written on purpose: if the production `as_str` and this table were
/// generated from one list, a rename would move both and the test would still
/// pass while every frontend branch broke.
fn wire_table() -> Vec<(ErrorCode, &'static str)> {
    vec![
        (ErrorCode::InvalidInput, "invalid-input"),
        (ErrorCode::NotFound, "not-found"),
        (ErrorCode::PermissionDenied, "permission-denied"),
        (ErrorCode::ApprovalRequired, "approval-required"),
        (ErrorCode::Conflict, "conflict"),
        (ErrorCode::Io, "io"),
        (ErrorCode::Network, "network"),
        (ErrorCode::Timeout, "timeout"),
        (ErrorCode::Cancelled, "cancelled"),
        (ErrorCode::FeatureDisabled, "feature-disabled"),
        (ErrorCode::Unsupported, "unsupported"),
        (ErrorCode::Internal, "internal"),
    ]
}

#[test]
fn wire_table_covers_every_variant_in_both_directions() {
    let table = wire_table();
    assert_eq!(
        table.len(),
        ErrorCode::ALL.len(),
        "a variant was added or removed without updating the wire table"
    );
    for code in ErrorCode::ALL {
        assert!(
            table.iter().any(|(c, _)| c == code),
            "{code:?} is missing from the wire table"
        );
    }
}

#[test]
fn every_variant_serializes_to_the_exact_minimal_shape() {
    for (code, wire) in wire_table() {
        let value = serde_json::to_value(CommandError::new(code, "boom")).expect("serialize");
        assert_eq!(
            value,
            json!({ "code": wire, "message": "boom" }),
            "{code:?} did not serialize to the exact 2-key shape"
        );
    }
}

#[test]
fn absent_optionals_are_omitted_never_null() {
    let text = serde_json::to_string(&CommandError::new(ErrorCode::Io, "disk")).expect("serialize");
    assert!(
        !text.contains("null"),
        "absent optionals emitted null: {text}"
    );
    assert!(
        !text.contains("i18nKey"),
        "absent i18nKey emitted a key: {text}"
    );
    assert!(
        !text.contains("detail"),
        "absent detail emitted a key: {text}"
    );
}

#[test]
fn i18n_key_and_detail_use_camel_case_wire_names() {
    let err = CommandError::new(ErrorCode::NotFound, "gone")
        .with_i18n_key("errors.save.parentMissing")
        .with_detail(json!({ "dir": "/Users/x/notes" }));
    assert_eq!(
        serde_json::to_value(err).expect("serialize"),
        json!({
            "code": "not-found",
            "message": "gone",
            "i18nKey": "errors.save.parentMissing",
            "detail": { "dir": "/Users/x/notes" },
        })
    );
}

#[test]
fn each_optional_is_omitted_independently_of_the_other() {
    let key_only = serde_json::to_value(
        CommandError::new(ErrorCode::Cancelled, "stopped").with_i18n_key("errors.cli.cancelled"),
    )
    .expect("serialize");
    assert_eq!(
        key_only,
        json!({ "code": "cancelled", "message": "stopped", "i18nKey": "errors.cli.cancelled" })
    );

    let detail_only = serde_json::to_value(
        CommandError::new(ErrorCode::Conflict, "stale").with_detail(json!({ "epoch": 7 })),
    )
    .expect("serialize");
    assert_eq!(
        detail_only,
        json!({ "code": "conflict", "message": "stale", "detail": { "epoch": 7 } })
    );
}

#[test]
fn cjk_message_and_detail_round_trip_byte_faithfully() {
    let err = CommandError::new(ErrorCode::Io, "文件被占用")
        .with_detail(json!({ "path": "/用户/笔记/日记.md", "note": "读写冲突" }));
    let text = serde_json::to_string(&err).expect("serialize");
    let back: CommandError = serde_json::from_str(&text).expect("deserialize");

    assert_eq!(back.code(), ErrorCode::Io);
    assert_eq!(back.message(), "文件被占用");
    assert_eq!(
        back.detail()
            .and_then(|d| d.get("path"))
            .and_then(|v| v.as_str()),
        Some("/用户/笔记/日记.md")
    );
    assert_eq!(serde_json::to_string(&back).expect("re-serialize"), text);
}

#[test]
fn empty_message_still_serializes_the_key() {
    assert_eq!(
        serde_json::to_value(CommandError::new(ErrorCode::Internal, "")).expect("serialize"),
        json!({ "code": "internal", "message": "" })
    );
}

#[test]
fn display_is_the_message_so_legacy_string_callers_read_the_same_text() {
    let err = CommandError::new(ErrorCode::Timeout, "Pandoc timed out");
    assert_eq!(err.to_string(), "Pandoc timed out");
}

#[test]
fn retryability_is_a_property_of_the_code_not_the_message() {
    // Retryable = repeating the IDENTICAL call may succeed with nothing else
    // changed. Approval and conflict need a user action or a state refresh
    // first, so an auto-retry on them is a spin loop, not a recovery.
    let expected = [
        (ErrorCode::InvalidInput, false),
        (ErrorCode::NotFound, false),
        (ErrorCode::PermissionDenied, false),
        (ErrorCode::ApprovalRequired, false),
        (ErrorCode::Conflict, false),
        (ErrorCode::Io, true),
        (ErrorCode::Network, true),
        (ErrorCode::Timeout, true),
        (ErrorCode::Cancelled, false),
        (ErrorCode::FeatureDisabled, false),
        (ErrorCode::Unsupported, false),
        (ErrorCode::Internal, false),
    ];
    assert_eq!(expected.len(), ErrorCode::ALL.len());
    for (code, retryable) in expected {
        assert_eq!(code.is_retryable(), retryable, "{code:?}");
    }
}

#[test]
fn feature_disabled_exists_now_for_the_flag_gate() {
    // WI-19 gates dark features on this exact code; it ships with WI-14 so the
    // flag work does not have to invent a second error vocabulary.
    let err = CommandError::feature_disabled("browser is off");
    assert_eq!(err.code(), ErrorCode::FeatureDisabled);
    assert_eq!(
        serde_json::to_value(err).expect("serialize")["code"],
        json!("feature-disabled")
    );
}

#[test]
fn deserializing_an_unknown_code_fails_rather_than_defaulting() {
    let err = serde_json::from_str::<CommandError>(r#"{"code":"teapot","message":"?"}"#);
    assert!(
        err.is_err(),
        "an unknown code must not silently become a variant"
    );
}

/// The canonical wire values the frontend test suite consumes. Built from the
/// REAL types (and, for the save path, by invoking the real command core), so
/// the TypeScript twin cannot drift from Rust while both suites stay green.
fn canonical_fixtures() -> serde_json::Value {
    let by_code: serde_json::Map<String, serde_json::Value> = ErrorCode::ALL
        .iter()
        .map(|code| {
            (
                code.as_str().to_string(),
                serde_json::to_value(CommandError::new(*code, "boom")).expect("serialize"),
            )
        })
        .collect();

    // A real save-path failure: the directory cannot exist, so the value is
    // both genuine and deterministic on every machine that can run the probe.
    // The committed fixture must be byte-identical across platforms, and
    // `/vmark-fixture-no-such-dir/…` is only ABSOLUTE on Unix — on Windows it
    // has no drive letter, so `atomic_write_file_sync` refuses it at the
    // `is_absolute()` guard (`invalid-input`) before ever reaching the
    // parent-missing check (this exact skew turned CI red on
    // windows-latest, run 30889190922). Unix CI + local keep the genuine
    // real-invocation guarantee; Windows builds the identical entry through
    // the SAME `localized_error!` expression the production check uses, so it
    // still verifies fixture byte-stability.
    #[cfg(not(windows))]
    let parent_missing = crate::file_write::atomic_write_file_sync(
        std::path::Path::new("/vmark-fixture-no-such-dir/notes/note.md"),
        "hello",
    )
    .expect_err("the fixture directory must not exist");
    #[cfg(windows)]
    let parent_missing = {
        let dir = std::path::Path::new("/vmark-fixture-no-such-dir/notes/note.md")
            .parent()
            .expect("probe path has a parent");
        localized_error!(
            ErrorCode::NotFound,
            "errors.save.parentMissing",
            dir = dir.display()
        )
        .with_detail(json!({ "dir": dir.to_string_lossy() }))
    };

    serde_json::json!({
        "//": [
            "GENERATED by the Rust test `frontend_wire_fixture_stays_in_sync`",
            "(src-tauri/src/command_error.test.rs). Do not hand-edit — regenerate with",
            "UPDATE_FIXTURES=1 cargo test --manifest-path src-tauri/Cargo.toml frontend_wire_fixture",
            "Consumed by src/services/commands/commandError.test.ts so the TypeScript twin",
            "of CommandError is proven against values Rust actually produces (WI-18 mock",
            "boundary: the frontend may mock @tauri-apps/* only, with real fixtures behind it).",
        ],
        "byCode": by_code,
        "saveParentMissing": serde_json::to_value(&parent_missing).expect("serialize"),
        // `browser/ai_commands.test.rs` asserts the real `authorize_shared_navigation`
        // produces this code + key; the module-private function is not reachable
        // from here, so the value is reconstructed from the same locale key.
        "browserApprovalRequired": serde_json::to_value(
            localized_error!(ErrorCode::ApprovalRequired, "errors.browser.approvalRequired")
        ).expect("serialize"),
        "cjk": serde_json::to_value(
            CommandError::io("文件被占用").with_detail(json!({ "path": "/用户/笔记/日记.md" }))
        ).expect("serialize"),
    })
}

/// The anti-drift bond between the two suites. The frontend imports this file
/// instead of hand-writing wire values, so a Rust-side shape change fails here
/// first and in the TypeScript table immediately after.
///
/// Depends on the process locale being the `en` default — nothing in the test
/// suite calls `rust_i18n::set_locale`, and the only caller is a Tauri command.
#[test]
fn frontend_wire_fixture_stays_in_sync() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../src/test/fixtures/commandErrorWire.json");
    // cargo-mutants copies ONLY the crate into its sandbox, so the frontend
    // tree this bond reaches into does not exist there and the BASELINE run
    // failed with exit 4 (mutation.yml runs 30889201743 AND 30891869767 —
    // the second because a CARGO_MUTANTS env guard never fired: the variable
    // is NOT set in the baseline environment; measured, not assumed).
    // The deterministic marker is compile-time: inside the sandbox,
    // env!("CARGO_MANIFEST_DIR") is the sandbox copy itself
    // (/tmp/cargo-mutants-<name>-XXXX.tmp/), so its path contains
    // "cargo-mutants". Skip only there AND only when the fixture is genuinely
    // absent — a deleted fixture still fails plain `cargo test`, and mutation
    // coverage for this module comes from the other tests in this file.
    let in_mutants_sandbox = env!("CARGO_MANIFEST_DIR").contains("cargo-mutants")
        || std::env::var_os("CARGO_MUTANTS").is_some();
    if in_mutants_sandbox && !path.exists() {
        eprintln!("skipping frontend-fixture bond: cargo-mutants sandbox has no frontend tree");
        return;
    }
    let generated = canonical_fixtures();

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
        "the committed frontend fixture is stale — regenerate it with \
         UPDATE_FIXTURES=1 and update the TypeScript expectations it feeds"
    );
}

/// Collect every i18n key a `CommandError` is built with, by scanning the real
/// crate source. Deliberately NOT a hand-maintained constant: a registry you
/// must remember to update is the thing that goes stale.
fn i18n_keys_used_in(dir: &std::path::Path) -> Vec<String> {
    let patterns = [
        regex::Regex::new(r#"with_i18n_key\(\s*"([^"]+)""#).expect("valid regex"),
        regex::Regex::new(r#"localized_error!\(\s*[^,]+,\s*"([^"]+)""#).expect("valid regex"),
    ];
    let mut keys = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        for entry in std::fs::read_dir(&current)
            .expect("read source dir")
            .flatten()
        {
            let path = entry.path();
            let name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            if path.is_dir() {
                stack.push(path);
            // Production call sites only: a key written inside a `*.test.rs`
            // fixture is test data, not a string any user will ever see.
            } else if path.extension().is_some_and(|e| e == "rs") && !name.ends_with(".test.rs") {
                let text = std::fs::read_to_string(&path).expect("read source file");
                for pattern in &patterns {
                    for capture in pattern.captures_iter(&text) {
                        keys.push(capture[1].to_string());
                    }
                }
            }
        }
    }
    keys.sort();
    keys.dedup();
    keys
}

/// Row 4 of the WI-14 matrix — closes the `lint:i18n` blind spot for migrated
/// modules. Scans the REAL crate source for every i18n key handed to a
/// `CommandError` and asserts it resolves in **every** locale, so a variant
/// cannot ship with a key nobody translated (or with no key at all in the
/// non-English bundles, which `lint:i18n` would flag only after the fact).
#[test]
fn every_command_error_i18n_key_exists_in_every_locale() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let keys = i18n_keys_used_in(&root.join("src"));
    assert!(
        !keys.is_empty(),
        "no CommandError i18n keys found — the scanner stopped seeing call sites"
    );

    let locales_dir = root.join("locales");
    let mut locales: Vec<_> = std::fs::read_dir(&locales_dir)
        .expect("read locales dir")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|e| e == "yml"))
        .collect();
    locales.sort();
    assert!(locales.len() >= 2, "expected en.yml plus translations");

    for locale in locales {
        let text = std::fs::read_to_string(&locale).expect("read locale");
        let doc: serde_yaml_ng::Value = serde_yaml_ng::from_str(&text).expect("parse locale");
        for key in &keys {
            let (ns, rest) = key.split_once('.').expect("keys are namespaced");
            let resolved = doc.get(ns).and_then(|section| section.get(rest));
            assert!(
                resolved.is_some(),
                "{}: missing key {key}",
                locale.file_name().unwrap_or_default().to_string_lossy()
            );
        }
    }
}
