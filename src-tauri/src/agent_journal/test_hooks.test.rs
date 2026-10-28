// WI-AL1.2 — the test seams (the reviewGen setter, raw appends, record dumps, fault injection setters) exist only under cfg(test), so production code cannot reach around the transition rules
//! The spike proved this by compiling a probe crate twice; inside the app
//! crate that costs a full second build of the app, so this reads the
//! source instead: every `debug_*` method and every fault-injection setter
//! must carry `#[cfg(test)]` among the attributes directly above it. A
//! `cfg(test)` item called from production code fails the release build,
//! so the attribute is the whole guarantee.

const WRITER_LEGACY: &str = include_str!("writer_legacy.rs");
const FAULTS: &str = include_str!("faults.rs");
const WRITER_EPOCH: &str = include_str!("writer_epoch.rs");
const WRITER_WINDOW: &str = include_str!("writer_window.rs");

/// The attribute lines directly above the line that declares `fn <name>`.
fn attributes_above(source: &str, name: &str) -> Vec<String> {
    let lines: Vec<&str> = source.lines().collect();
    let decl = format!("fn {name}(");
    let at = lines
        .iter()
        .position(|l| l.contains(&decl))
        .unwrap_or_else(|| panic!("fn {name} is declared"));
    lines[..at]
        .iter()
        .rev()
        .map(|l| l.trim())
        .take_while(|l| l.starts_with("#[") || l.starts_with("///"))
        .filter(|l| l.starts_with("#["))
        .map(str::to_string)
        .collect()
}

fn assert_test_only(source: &str, name: &str) {
    let attrs = attributes_above(source, name);
    assert!(
        attrs.iter().any(|a| a == "#[cfg(test)]"),
        "fn {name} must be #[cfg(test)], found {attrs:?}"
    );
}

#[test]
fn every_writer_debug_hook_is_test_only() {
    for name in ["debug_set_review_gen", "debug_append_raw", "debug_records"] {
        assert_test_only(WRITER_LEGACY, name);
    }
    assert_test_only(WRITER_EPOCH, "debug_check_worker_payload");
    assert_test_only(WRITER_WINDOW, "debug_capture_payload");
}

#[test]
fn every_fault_injection_setter_is_test_only() {
    for name in [
        "fail_next_appends",
        "fail_next_fsyncs",
        "fail_next_truncates",
        "fail_next_blob_writes",
        "tear_next_append_after",
        "drop_next_broadcasts",
        "crash_compaction_after",
        "set_append_hook",
        "before_nth_lock",
    ] {
        assert_test_only(FAULTS, name);
    }
}

#[test]
fn the_scanner_sees_an_ungated_fn_as_ungated() {
    let source = "impl X {\n    /// doc\n    #[doc(hidden)]\n    pub fn open_hook(&self) {}\n}\n";
    assert_eq!(
        attributes_above(source, "open_hook"),
        vec!["#[doc(hidden)]".to_string()]
    );
}
