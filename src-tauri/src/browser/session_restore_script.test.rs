//! Audit 2026-09-03 round 1 / round 3 (#30) — the localStorage replay reports what
//! it did, and a rollback that itself failed is a distinct outcome, not a success.
//! The script's BEHAVIOUR runs in `src/services/browser/sessionRestoreScript.test.ts`;
//! these pin the parse and the call shape Rust builds.

use super::*;

fn detail<'a>(err: &'a CommandError, key: &str) -> Option<&'a serde_json::Value> {
    err.detail().and_then(|d| d.get(key))
}

#[test]
fn outcomes_are_parsed_without_trusting_the_shape() {
    assert_eq!(
        parse_restore_outcome(r#"{"applied":true,"count":3}"#),
        RestoreOutcome::Applied
    );
    assert_eq!(
        parse_restore_outcome(r#"{"applied":false,"reason":"origin-changed"}"#),
        RestoreOutcome::OriginChanged
    );
    assert_eq!(
        parse_restore_outcome("not json"),
        RestoreOutcome::Unreadable
    );
    assert_eq!(
        parse_restore_outcome(r#"{"applied":"yes"}"#),
        RestoreOutcome::Unreadable
    );
    assert_eq!(
        parse_restore_outcome(r#"{"applied":false,"reason":"something-new"}"#),
        RestoreOutcome::Unreadable
    );
}

#[test]
fn quota_exceeded_on_the_first_write_is_a_rolled_back_failure_at_index_zero() {
    // The exact shape the script emits when `setItem` throws on the first entry:
    // nothing preceded it, so nothing was put back and nothing could fail to be.
    assert_eq!(
        parse_restore_outcome(
            r#"{"applied":false,"reason":"write-failed","index":0,"rollbackFailed":[]}"#
        ),
        RestoreOutcome::WriteFailed { index: Some(0) }
    );
}

#[test]
fn a_partial_write_whose_rollback_succeeded_reports_only_the_failing_index() {
    // Two writes landed, the third was rejected, both earlier ones were put back.
    assert_eq!(
        parse_restore_outcome(
            r#"{"applied":false,"reason":"write-failed","index":2,"rollbackFailed":[]}"#
        ),
        RestoreOutcome::WriteFailed { index: Some(2) }
    );
}

#[test]
fn a_partial_write_whose_rollback_also_failed_is_its_own_outcome() {
    // The script walks the rollback last-write-first, so it reports `[1, 0]`; the
    // parse normalises to ascending data indices and drops a repeat.
    assert_eq!(
        parse_restore_outcome(
            r#"{"applied":false,"reason":"write-failed","index":2,"rollbackFailed":[1,0,1]}"#
        ),
        RestoreOutcome::RollbackFailed {
            index: Some(2),
            failed: vec![0, 1],
        }
    );
}

#[test]
fn a_write_failure_with_a_malformed_rollback_report_is_unreadable() {
    // The script always emits `rollbackFailed` as an array of indices. Anything
    // else is a shape this script never produces, and is refused rather than read
    // as "rolled back".
    for raw in [
        r#"{"applied":false,"reason":"write-failed","index":1}"#,
        r#"{"applied":false,"reason":"write-failed","index":1,"rollbackFailed":"none"}"#,
        r#"{"applied":false,"reason":"write-failed","index":1,"rollbackFailed":[0,"b"]}"#,
        r#"{"applied":false,"reason":"write-failed","index":1,"rollbackFailed":[-1]}"#,
    ] {
        assert_eq!(
            parse_restore_outcome(raw),
            RestoreOutcome::Unreadable,
            "{raw}"
        );
    }
}

#[test]
fn the_script_is_the_asset_called_with_its_arguments_appended() {
    // The values and the origin are the CALL's arguments — appended after the whole
    // asset, never interpolated into it — so a value that looks like code is data.
    let pairs = r#"[["k","\"); alert(1); //"]]"#;
    let expected = r#""https://a.example/""#;
    let script = restore_script(pairs, expected);
    assert!(script.starts_with("return ("), "{script}");
    assert!(
        script.ends_with(&format!(")({pairs},{expected});")),
        "the arguments must follow the asset"
    );
    assert_eq!(
        &script["return (".len().."return (".len() + RESTORE_SRC.len()],
        RESTORE_SRC,
        "the asset is included whole, unmodified"
    );
    // The asset is one function expression over exactly those two arguments.
    assert!(RESTORE_SRC.contains("(function (d, expected) {"));
    assert!(RESTORE_SRC.trim_end().ends_with("})"));
}

#[test]
fn the_asset_speaks_the_shape_the_parser_reads() {
    // The contract names, on both sides of the string boundary.
    for needle in [
        r#"reason: "origin-changed""#,
        r#"reason: "read-failed", index: s"#,
        r#"reason: "write-failed", index: i, rollbackFailed: rollbackFailed"#,
        "applied: true, count: d.length",
        "rollbackFailed.push(j)",
        "localStorage.removeItem(prev[j][0])",
        "snapshot.push(localStorage.getItem(d[s][0]))",
    ] {
        assert!(RESTORE_SRC.contains(needle), "asset lost `{needle}`");
    }
}

#[test]
fn each_outcome_reports_itself_at_the_command_boundary() {
    assert!(RestoreOutcome::Applied.into_result("t").is_ok());

    let stale = RestoreOutcome::OriginChanged.into_result("t").unwrap_err();
    assert_eq!(stale.code(), ErrorCode::Conflict);
    assert_eq!(
        detail(&stale, "mcpCode"),
        Some(&serde_json::json!("STALE_COMMAND"))
    );
    assert_eq!(detail(&stale, "tabId"), Some(&serde_json::json!("t")));

    let rolled_back = RestoreOutcome::WriteFailed { index: Some(2) }
        .into_result("t")
        .unwrap_err();
    assert_eq!(rolled_back.code(), ErrorCode::Io);
    assert_eq!(detail(&rolled_back, "index"), Some(&serde_json::json!(2)));
    assert_eq!(
        detail(&rolled_back, "rolledBack"),
        Some(&serde_json::json!(true))
    );
    assert!(detail(&rolled_back, "rollbackFailed").is_none());

    let partial = RestoreOutcome::RollbackFailed {
        index: Some(2),
        failed: vec![0, 1],
    }
    .into_result("t")
    .unwrap_err();
    assert_eq!(partial.code(), ErrorCode::Io);
    assert_eq!(detail(&partial, "index"), Some(&serde_json::json!(2)));
    assert_eq!(
        detail(&partial, "rolledBack"),
        Some(&serde_json::json!(false))
    );
    assert_eq!(
        detail(&partial, "rollbackFailed"),
        Some(&serde_json::json!([0, 1]))
    );
    assert_ne!(
        partial.message(),
        rolled_back.message(),
        "a partly restored page must not be described as rolled back"
    );
    assert!(
        partial.message().contains("partly"),
        "{}",
        partial.message()
    );

    // An unreadable script result is a bug in OUR script, not a native surface
    // failure: `internal`, with no surface classification attached (round 4, #31).
    let unreadable = RestoreOutcome::Unreadable.into_result("t").unwrap_err();
    assert_eq!(unreadable.code(), ErrorCode::Internal);
    assert!(detail(&unreadable, "kind").is_none());
    assert!(unreadable.message().contains("unreadable"));
}

#[test]
fn a_read_failure_before_any_write_is_its_own_outcome() {
    assert_eq!(
        parse_restore_outcome(r#"{"applied":false,"reason":"read-failed","index":1}"#),
        RestoreOutcome::ReadFailed { index: Some(1) }
    );
    let err = RestoreOutcome::ReadFailed { index: Some(1) }
        .into_result("t1")
        .unwrap_err();
    assert_eq!(err.code(), ErrorCode::Io);
    assert_eq!(detail(&err, "written"), Some(&serde_json::json!(false)));
    assert_eq!(detail(&err, "index"), Some(&serde_json::json!(1)));
    assert!(err.message().contains("nothing was written"));
}
