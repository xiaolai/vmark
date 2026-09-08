// WI-FL6.3 — the print outcome, on the wire and per platform.
//
// The mapping from each platform's native signal is pinned behind the same
// `cfg` that compiles it: the macOS and Linux cases run on their own CI legs,
// the Windows one compiles under `check-cross-target.sh` and runs on the
// Windows leg. The wire tests run everywhere.

use super::*;

#[test]
fn the_wire_is_a_status_field_with_lowercase_values() {
    let cases = [
        (PrintOutcome::completed(), r#"{"status":"completed"}"#),
        (PrintOutcome::cancelled(), r#"{"status":"cancelled"}"#),
        (PrintOutcome::unknown(), r#"{"status":"unknown"}"#),
        // The ambiguous macOS outcome is ADDITIVE on the wire (#215, #228):
        // a consumer reading only `status` still sees "no print happened".
        (
            PrintOutcome::cancelled_or_failed(),
            r#"{"status":"cancelled","mayHaveFailed":true}"#,
        ),
    ];
    for (outcome, json) in cases {
        assert_eq!(serde_json::to_string(&outcome).expect("serialize"), json);
        let back: PrintOutcome = serde_json::from_str(json).expect("round trip");
        assert_eq!(back, outcome);
    }
}

#[test]
fn a_certain_cancel_and_an_ambiguous_one_are_distinct_values_with_one_status() {
    // Linux's Cancel response is certain; macOS's NO is not. Both are "no
    // print", and only the second may hide a failed job.
    let certain = PrintOutcome::cancelled();
    let ambiguous = PrintOutcome::cancelled_or_failed();
    assert_eq!(certain.status, PrintStatus::Cancelled);
    assert_eq!(ambiguous.status, PrintStatus::Cancelled);
    assert_ne!(certain, ambiguous);
    assert!(!certain.may_have_failed);
    assert!(ambiguous.may_have_failed);
    // No other outcome ever carries the flag.
    assert!(!PrintOutcome::completed().may_have_failed);
    assert!(!PrintOutcome::unknown().may_have_failed);
}

#[test]
fn a_payload_without_the_flag_reads_as_certain() {
    // Older producers, and every platform that can tell the two apart, omit
    // the field; it must default rather than fail the parse.
    let back: PrintOutcome = serde_json::from_str(r#"{"status":"cancelled"}"#).expect("parse");
    assert_eq!(back, PrintOutcome::cancelled());
}

#[test]
fn the_three_statuses_are_distinct() {
    // A frontend branching on `status` must never see two spellings collapse.
    let wire: std::collections::BTreeSet<String> = [
        PrintStatus::Completed,
        PrintStatus::Cancelled,
        PrintStatus::Unknown,
    ]
    .iter()
    .map(|s| serde_json::to_string(s).expect("serialize"))
    .collect();
    assert_eq!(wire.len(), 3);
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;

    #[test]
    fn success_yes_is_completed_and_no_is_cancelled_or_failed() {
        // `printOperationDidRun:success:contextInfo:` — success is NO when
        // the user cancels the panel AND when the job fails; AppKit exposes
        // nothing that separates them (#215, #228), so NO must not be
        // reported as a certain dismissal.
        assert_eq!(
            PrintOutcome::from_did_run_success(true),
            PrintOutcome::completed()
        );
        assert_eq!(
            PrintOutcome::from_did_run_success(false),
            PrintOutcome::cancelled_or_failed()
        );
        assert_ne!(
            PrintOutcome::from_did_run_success(false),
            PrintOutcome::cancelled(),
            "NO is not the certain cancel Linux reports"
        );
    }

    #[test]
    fn macos_never_reports_unknown() {
        // The delegate always learns the flag; `Unknown` is the Windows value.
        for success in [true, false] {
            assert_ne!(
                PrintOutcome::from_did_run_success(success).status,
                PrintStatus::Unknown
            );
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod linux {
    use super::*;
    use webkit2gtk::PrintOperationResponse;

    #[test]
    fn cancel_settles_now_as_cancelled() {
        assert_eq!(
            PrintOutcome::from_dialog_response(PrintOperationResponse::Cancel),
            Some(PrintOutcome::cancelled())
        );
    }

    #[test]
    fn print_defers_to_the_finished_signal() {
        // Confirming only STARTS the job (#1343); the outcome is not known
        // until `finished` or `failed` fires, so the response alone yields
        // nothing to settle with.
        assert_eq!(
            PrintOutcome::from_dialog_response(PrintOperationResponse::Print),
            None
        );
    }

    #[test]
    fn an_unmapped_response_is_unknown_not_a_guess() {
        assert_eq!(
            PrintOutcome::from_dialog_response(PrintOperationResponse::__Unknown(42)),
            Some(PrintOutcome::unknown())
        );
    }
}

#[cfg(target_os = "windows")]
mod windows {
    use super::*;

    #[test]
    fn show_print_ui_can_only_ever_say_unknown() {
        // `ICoreWebView2_16::ShowPrintUI` has no completion handler and no
        // result; anything more definite here would be invented.
        assert_eq!(PrintOutcome::from_show_print_ui(), PrintOutcome::unknown());
    }
}
