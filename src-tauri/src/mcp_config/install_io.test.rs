//! Tests for `install_io.rs` (included via `#[path]`).
//!
//! WI-2 — the install path must abort on a config it cannot read or parse,
//! leaving the user's file and their backups exactly as they were. Uninstall
//! now shares the same workflow and must honour the same guarantees.

use super::*;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use tempfile::tempdir;

const BIN: &str = "/opt/vmark/vmark-mcp-server";

/// A credential policy with a fixed mint and nothing taken — these tests are
/// about the snapshot/backup/replace workflow, not about which credential is
/// chosen (`client_tokens.test.rs` owns that).
fn policy() -> TokenPolicy {
    TokenPolicy {
        fresh: "tok-fixture".to_string(),
        taken: vec![],
    }
}

/// Everything in the temp dir except the config itself — i.e. stray backups.
fn stray_files(dir: &Path, config: &Path) -> Vec<PathBuf> {
    fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p != config)
        .collect()
}

// -- read_config_for_merge -------------------------------------------------

#[test]
fn missing_file_reads_as_none() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("absent.json");
    assert_eq!(read_config_for_merge(&path).unwrap(), None);
}

#[test]
fn unreadable_file_is_an_error_not_a_silent_none() {
    // Non-UTF8 bytes: `fs::read_to_string(..).ok()` used to yield None here,
    // which fed the "rewrite as vmark-only" path.
    let dir = tempdir().unwrap();
    let path = dir.path().join("binary.json");
    fs::write(&path, [0xff, 0xfe, 0x00, 0x01]).unwrap();
    read_config_for_merge(&path).expect_err("invalid UTF-8 must surface");
}

// -- install_config_at: the whole install path, on a real file -------------

#[test]
fn install_on_malformed_json_errors_and_leaves_the_file_untouched() {
    let dir = tempdir().unwrap();
    let path = dir.path().join(".claude.json");
    let corrupt = r#"{"projects": {"/tmp/x": {}}, TRUNCATED"#;
    fs::write(&path, corrupt).unwrap();

    let err =
        install_config_at(&path, "claude", BIN, &policy()).expect_err("malformed JSON must fail");
    assert!(err.contains("Invalid JSON"), "unexpected: {err}");

    assert_eq!(fs::read_to_string(&path).unwrap(), corrupt);
    // Validation happens before any file is touched, so no stray backup.
    assert!(stray_files(dir.path(), &path).is_empty());
}

#[test]
fn install_on_malformed_toml_errors_and_leaves_the_file_untouched() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("config.toml");
    let corrupt = "model = \"gpt-5\"\n[[[broken";
    fs::write(&path, corrupt).unwrap();

    let err =
        install_config_at(&path, "codex", BIN, &policy()).expect_err("malformed TOML must fail");
    assert!(err.contains("Invalid TOML"), "unexpected: {err}");

    assert_eq!(fs::read_to_string(&path).unwrap(), corrupt);
    assert!(stray_files(dir.path(), &path).is_empty());
}

#[test]
fn install_on_non_table_toml_mcp_servers_errors_instead_of_reporting_success() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("config.toml");
    let existing = "mcp_servers = 3\n";
    fs::write(&path, existing).unwrap();

    let err = install_config_at(&path, "codex", BIN, &policy())
        .expect_err("non-table mcp_servers must fail");
    assert!(
        err.contains("mcp_servers is not a table"),
        "unexpected: {err}"
    );
    assert_eq!(fs::read_to_string(&path).unwrap(), existing);
}

#[test]
fn install_merges_and_backs_up_an_existing_config() {
    let dir = tempdir().unwrap();
    let path = dir.path().join(".claude.json");
    let existing = r#"{"numStartups": 42, "projects": {"/tmp/x": {}}}"#;
    fs::write(&path, existing).unwrap();

    let backup = install_config_at(&path, "claude", BIN, &policy())
        .expect("valid config installs")
        .expect("an existing config is backed up");

    assert_eq!(fs::read_to_string(&backup).unwrap(), existing);
    let json: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(json["numStartups"], 42);
    assert!(json["projects"]["/tmp/x"].is_object());
    assert_eq!(json["mcpServers"]["vmark"]["command"], BIN);
}

#[test]
fn install_creates_missing_parent_directories() {
    let dir = tempdir().unwrap();
    let path = dir.path().join(".codex").join("config.toml");

    let backup = install_config_at(&path, "codex", BIN, &policy()).expect("fresh install");

    assert!(backup.is_none(), "nothing to back up on a fresh install");
    let doc: toml::Table = fs::read_to_string(&path).unwrap().parse().unwrap();
    assert_eq!(doc["mcp_servers"]["vmark"]["command"].as_str(), Some(BIN));
}

#[cfg(unix)]
#[test]
fn a_freshly_created_config_is_owner_only() {
    // The old path went through `NamedTempFile` + rename, which produced an
    // 0600 file. `create_new` would otherwise hand a brand new
    // `~/.codex/config.toml` whatever the umask allows.
    use std::os::unix::fs::PermissionsExt;
    let dir = tempdir().unwrap();
    let path = dir.path().join(".codex").join("config.toml");

    install_config_at(&path, "codex", BIN, &policy()).unwrap();

    let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o7777;
    assert_eq!(mode, 0o600, "fresh config must not be {mode:o}");
}

#[cfg(unix)]
#[test]
fn installing_into_an_existing_config_keeps_its_mode() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempdir().unwrap();
    let path = dir.path().join(".claude.json");
    fs::write(&path, r#"{"numStartups": 1}"#).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).unwrap();

    install_config_at(&path, "claude", BIN, &policy()).unwrap();

    let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o7777;
    assert_eq!(mode, 0o640, "the user's mode must survive the write");
}

#[test]
fn a_second_identical_install_writes_nothing_and_leaves_no_backup() {
    // Repair-clicking a healthy config must not litter the user's home with
    // identical backups, and must not rewrite a file it does not change.
    let dir = tempdir().unwrap();
    let path = dir.path().join(".claude.json");
    fs::write(&path, r#"{"numStartups": 1}"#).unwrap();

    install_config_at(&path, "claude", BIN, &policy())
        .unwrap()
        .unwrap();
    let after_first = fs::read_to_string(&path).unwrap();
    let strays_after_first = stray_files(dir.path(), &path).len();

    let backup =
        install_config_at(&path, "claude", BIN, &policy()).expect("second install succeeds");

    assert!(backup.is_none(), "an unchanged config needs no backup");
    assert_eq!(fs::read_to_string(&path).unwrap(), after_first);
    assert_eq!(stray_files(dir.path(), &path).len(), strays_after_first);
}

// -- uninstall_config_at: the same guarantees, end to end (finding 5) ------

#[test]
fn uninstall_on_malformed_json_errors_leaves_the_file_untouched_and_makes_no_backup() {
    let dir = tempdir().unwrap();
    let path = dir.path().join(".claude.json");
    let corrupt = r#"{"projects": {"/tmp/x": {}}, TRUNCATED"#;
    fs::write(&path, corrupt).unwrap();

    let err = uninstall_config_at(&path, "claude").expect_err("malformed JSON must fail");
    assert!(err.contains("Invalid JSON"), "unexpected: {err}");

    assert_eq!(fs::read_to_string(&path).unwrap(), corrupt);
    assert!(
        stray_files(dir.path(), &path).is_empty(),
        "a failed uninstall must not leave a backup behind"
    );
}

#[test]
fn uninstall_on_malformed_toml_errors_leaves_the_file_untouched_and_makes_no_backup() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("config.toml");
    let corrupt = "model = \"gpt-5\"\n[[[broken";
    fs::write(&path, corrupt).unwrap();

    let err = uninstall_config_at(&path, "codex").expect_err("malformed TOML must fail");
    assert!(err.contains("Invalid TOML"), "unexpected: {err}");

    assert_eq!(fs::read_to_string(&path).unwrap(), corrupt);
    assert!(stray_files(dir.path(), &path).is_empty());
}

#[test]
fn uninstall_removes_the_entry_backs_up_and_keeps_everything_else() {
    let dir = tempdir().unwrap();
    let path = dir.path().join(".claude.json");
    let existing = r#"{"numStartups": 7, "mcpServers": {"vmark": {"command": "x"}, "other": {"command": "y"}}}"#;
    fs::write(&path, existing).unwrap();

    let outcome = uninstall_config_at(&path, "claude").expect("valid config uninstalls");

    assert!(outcome.changed);
    let backup = outcome
        .backup_path
        .expect("an existing config is backed up");
    assert_eq!(fs::read_to_string(&backup).unwrap(), existing);

    let json: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(json["numStartups"], 7);
    assert_eq!(json["mcpServers"]["other"]["command"], "y");
    assert!(json["mcpServers"].get("vmark").is_none());
}

#[test]
fn uninstall_of_an_absent_config_is_a_no_op_and_creates_nothing() {
    let dir = tempdir().unwrap();
    let path = dir.path().join(".claude.json");

    let outcome = uninstall_config_at(&path, "claude").expect("nothing to do is not an error");

    assert!(!outcome.changed);
    assert!(outcome.backup_path.is_none());
    assert!(!path.exists(), "uninstall must not create a config");
}

#[test]
fn uninstall_when_vmark_is_not_configured_rewrites_nothing() {
    // The old path re-serialized and backed up regardless, reformatting a
    // config it had no reason to touch.
    let dir = tempdir().unwrap();
    let path = dir.path().join(".claude.json");
    let existing = r#"{"numStartups":7,"mcpServers":{"other":{}}}"#;
    fs::write(&path, existing).unwrap();

    let outcome = uninstall_config_at(&path, "claude").unwrap();

    assert!(!outcome.changed);
    assert!(outcome.backup_path.is_none());
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        existing,
        "byte-for-byte untouched"
    );
    assert!(stray_files(dir.path(), &path).is_empty());
}

#[test]
fn uninstall_treats_a_blank_config_as_nothing_to_remove() {
    let dir = tempdir().unwrap();
    let path = dir.path().join(".claude.json");
    fs::write(&path, "   \n").unwrap();

    let outcome = uninstall_config_at(&path, "claude").expect("a blank file has no vmark entry");

    assert!(!outcome.changed);
    assert_eq!(fs::read_to_string(&path).unwrap(), "   \n");
}

#[test]
fn uninstall_rejects_an_unknown_provider_before_touching_the_file() {
    let dir = tempdir().unwrap();
    let path = dir.path().join(".claude.json");
    fs::write(&path, "{}").unwrap();

    let err = uninstall_config_at(&path, "nope").expect_err("unknown provider");
    assert!(err.contains("Unknown provider"), "unexpected: {err}");
    assert_eq!(fs::read_to_string(&path).unwrap(), "{}");
    assert!(stray_files(dir.path(), &path).is_empty());
}

// -- TOCTOU (finding 6) ----------------------------------------------------
//
// Claude Code rewrites `~/.claude.json` constantly. The transform closure
// runs in exactly the window another process would write in, so these tests
// simulate the race precisely rather than approximately.

#[test]
fn a_write_that_lands_during_the_merge_is_retried_against_the_new_content() {
    let dir = tempdir().unwrap();
    let path = dir.path().join(".claude.json");
    fs::write(&path, r#"{"numStartups": 1}"#).unwrap();

    let calls = AtomicU32::new(0);
    let seen_on_last_call = std::sync::Mutex::new(String::new());
    let outcome = mutate_config_at(&path, &|current| {
        *seen_on_last_call.lock().unwrap() = current.unwrap_or_default().to_string();
        if calls.fetch_add(1, Ordering::SeqCst) == 0 {
            // Another process lands a write while we are merging.
            fs::write(&path, r#"{"numStartups": 2, "theirs": true}"#).unwrap();
        }
        Ok(Some(format!("{}|ours", current.unwrap_or_default())))
    })
    .expect("a detected race is retried, not surfaced to the user");

    assert_eq!(calls.load(Ordering::SeqCst), 2, "exactly one retry");
    assert!(outcome.changed);
    assert!(
        seen_on_last_call.lock().unwrap().contains("theirs"),
        "the retry must merge into THEIR content, not ours"
    );
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        r#"{"numStartups": 2, "theirs": true}|ours"#
    );
}

#[test]
fn a_config_rewritten_on_every_attempt_errors_instead_of_clobbering() {
    let dir = tempdir().unwrap();
    let path = dir.path().join(".claude.json");
    fs::write(&path, "gen-0").unwrap();

    let calls = AtomicU32::new(0);
    let err = mutate_config_at(&path, &|_| {
        let n = calls.fetch_add(1, Ordering::SeqCst);
        fs::write(&path, format!("gen-{}", n + 1)).unwrap();
        Ok(Some("ours".to_string()))
    })
    .expect_err("a config that never holds still must not be overwritten");

    assert!(err.contains("changed on disk"), "unexpected: {err}");
    assert_eq!(calls.load(Ordering::SeqCst), MAX_MUTATION_ATTEMPTS);
    assert!(
        fs::read_to_string(&path).unwrap().starts_with("gen-"),
        "the other writer's content must survive"
    );
    assert!(stray_files(dir.path(), &path).is_empty());
}

#[test]
fn a_config_that_appears_mid_install_is_merged_into_rather_than_clobbered() {
    // Absent at snapshot time means "create". If the file exists by the time
    // we write, a plain rename would silently discard whoever created it.
    let dir = tempdir().unwrap();
    let path = dir.path().join(".claude.json");

    let calls = AtomicU32::new(0);
    let outcome = mutate_config_at(&path, &|current| {
        if calls.fetch_add(1, Ordering::SeqCst) == 0 {
            assert_eq!(current, None, "first pass sees no file");
            fs::write(&path, "appeared").unwrap();
        }
        Ok(Some(format!("[{}]", current.unwrap_or("<none>"))))
    })
    .expect("the appeared file is merged into on retry");

    assert_eq!(calls.load(Ordering::SeqCst), 2);
    assert_eq!(fs::read_to_string(&path).unwrap(), "[appeared]");
    assert_eq!(
        outcome.backup_path.map(|p| fs::read_to_string(p).unwrap()),
        Some("appeared".to_string()),
        "the file that appeared must be backed up before it is replaced"
    );
}

#[test]
fn a_backup_taken_by_an_attempt_that_loses_the_race_is_not_left_behind() {
    // Round-2 finding 2. The backup now happens BEFORE the last-moment
    // compare, so it cannot sit inside the race window — which means a losing
    // attempt has already made one. It must clean up after itself, and the
    // surviving backup must hold the content actually replaced.
    let dir = tempdir().unwrap();
    let path = dir.path().join(".claude.json");
    fs::write(&path, "gen-0").unwrap();

    let calls = AtomicU32::new(0);
    let outcome = mutate_config_at(&path, &|current| {
        if calls.fetch_add(1, Ordering::SeqCst) == 0 {
            fs::write(&path, "gen-1").unwrap();
        }
        Ok(Some(format!("{}|ours", current.unwrap_or_default())))
    })
    .expect("the second attempt wins");

    assert_eq!(calls.load(Ordering::SeqCst), 2);
    assert!(outcome.changed);

    let backup = outcome.backup_path.expect("the winning attempt backs up");
    assert_eq!(
        fs::read_to_string(&backup).unwrap(),
        "gen-1",
        "the backup must hold what was actually replaced"
    );
    assert_eq!(
        stray_files(dir.path(), &path),
        vec![PathBuf::from(&backup)],
        "exactly one backup survives — the losing attempt's was discarded"
    );
}

#[test]
fn a_transform_that_declines_writes_nothing() {
    let dir = tempdir().unwrap();
    let path = dir.path().join(".claude.json");
    fs::write(&path, "untouched").unwrap();

    let outcome = mutate_config_at(&path, &|_| Ok(None)).unwrap();

    assert!(!outcome.changed);
    assert!(outcome.backup_path.is_none());
    assert_eq!(fs::read_to_string(&path).unwrap(), "untouched");
    assert!(stray_files(dir.path(), &path).is_empty());
}
