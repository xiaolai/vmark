//! Tests for `detection.rs` (included via `#[path]`; split out of the
//! module so the file stays under its size baseline, matching every other
//! `ai_provider/` module).

use super::*;

#[test]
fn detect_with_maps_all_three_providers() {
    // Inject a checker that marks only `codex` available.
    let entries = detect_with(|cmd| {
        if cmd == "codex" {
            (true, Some("/usr/local/bin/codex".to_string()))
        } else {
            (false, None)
        }
    });

    assert_eq!(entries.len(), 3);
    let types: Vec<&str> = entries.iter().map(|e| e.provider_type.as_str()).collect();
    assert_eq!(types, ["claude", "codex", "gemini"]);

    let codex = entries.iter().find(|e| e.provider_type == "codex").unwrap();
    assert!(codex.available);
    assert_eq!(codex.path.as_deref(), Some("/usr/local/bin/codex"));

    let claude = entries
        .iter()
        .find(|e| e.provider_type == "claude")
        .unwrap();
    assert!(!claude.available);
    assert_eq!(claude.path, None);
    assert_eq!(claude.command, "claude");
    assert_eq!(claude.name, "Claude");
}

#[test]
fn env_keys_present_absent_and_empty() {
    // anthropic present, openai absent, google empty → only anthropic.
    let keys = read_env_api_keys_with(|var| match var {
        "ANTHROPIC_API_KEY" => Some("sk-ant".to_string()),
        "GOOGLE_API_KEY" => Some(String::new()), // empty → ignored
        _ => None,
    });
    assert_eq!(keys.get("anthropic").map(String::as_str), Some("sk-ant"));
    assert!(!keys.contains_key("openai"));
    assert!(!keys.contains_key("google-ai"));
}

#[test]
fn google_falls_back_to_gemini_var() {
    // GOOGLE_API_KEY unset/empty, GEMINI_API_KEY set → google-ai resolves.
    let keys = read_env_api_keys_with(|var| match var {
        "GOOGLE_API_KEY" => Some(String::new()),
        "GEMINI_API_KEY" => Some("gm-key".to_string()),
        _ => None,
    });
    assert_eq!(keys.get("google-ai").map(String::as_str), Some("gm-key"));
}

#[test]
fn google_prefers_google_var_over_gemini() {
    let keys = read_env_api_keys_with(|var| match var {
        "GOOGLE_API_KEY" => Some("goog".to_string()),
        "GEMINI_API_KEY" => Some("gem".to_string()),
        _ => None,
    });
    // First match wins → GOOGLE_API_KEY.
    assert_eq!(keys.get("google-ai").map(String::as_str), Some("goog"));
}

#[test]
fn env_keys_none_when_all_absent() {
    let keys = read_env_api_keys_with(|_| None);
    assert!(keys.is_empty());
}

// --- WI-1.1: login-shell ZDOTDIR resolution (terminal gap G1) ---
// (parse_sentinel unit tests live next to its definition in spawn.test.rs.)

#[test]
fn zdotdir_none_for_nonexistent_shell() {
    // Spawn failure must degrade to None, never panic.
    assert_eq!(query_login_shell_zdotdir("/no/such/shell/vmark-xyz"), None);
}

/// Exec a freshly written fixture once, before anything measures it.
///
/// macOS evaluates a freshly written, unsigned executable on its FIRST
/// `execve`, and that evaluation — not the shell — is the load-sensitive
/// part. Measured on this machine 2026-09-09: a cold first exec of one of
/// these scripts costs p50 409 ms, and under this suite's own load the
/// tail of the same operation reaches **1.65 s**; re-exec'ing the SAME
/// inode costs p50 9 ms / max 78 ms — a 45× reduction, because the
/// evaluation is already cached for it.
///
/// The bound this has to fit inside is production's 5 s
/// (`run_login_shell_capture`), which is not a test's to widen. So the
/// cold-start cost is taken OUT of the measured window instead: after the
/// warm-up, what the 5 s covers is a `printf`.
///
/// **This is a margin, not a proof.** 2500 replays of this exact capture
/// under the suite's own load never returned `None`, so the failure was never
/// reproduced in isolation and the cold-exec tail is the best available
/// explanation rather than a demonstrated one. What IS demonstrated is the
/// margin — worst measured capture ~1.65 s → ~78 ms against an unchanged 5 s
/// bound, roughly 3× headroom to 64×. The marker below is the part that does
/// not depend on that being right: whatever the cause, the next occurrence
/// names itself instead of being blamed on the round-trip.
#[cfg(unix)]
fn warm_exec(shell: &std::path::Path) {
    let status = std::process::Command::new(shell)
        .arg("--vmark-warmup")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .expect("warm-up exec of the fixture shell");
    assert!(status.success(), "warm-up exec failed: {status:?}");
}

/// Write a fake login "shell" that ignores its args, prints `body`, and
/// then records that it RAN TO COMPLETION. Returns the shell and that
/// marker.
///
/// The marker exists because `query_login_shell_zdotdir` funnels four
/// distinct outcomes into one `None` — spawn failure, non-zero exit, the
/// 5 s timeout, and a `try_wait` error — so `None` on its own cannot tell
/// "the shell ran and reported nothing" from "the shell never finished".
/// Both tests below turn on that difference and neither could see it. The
/// round-trip test was observed failing on 2026-09-09 (1 run in 14) with a
/// bare `left: None, right: Some(…)`, which names no cause at all — and the
/// cause was never recovered, because nothing recorded one. Its
/// `None`-expecting sibling carries the SAME defect wearing the opposite
/// sign, and that half is not a guess: with the marker assertion removed and
/// the capture bound mutated to zero, it PASSES while the shell is being
/// killed mid-run. A test that cannot fail on a broken capture is not
/// evidence that ZDOTDIR was unset.
///
/// Written LAST, after the `printf`, so its presence means the shell
/// reached the end: a killed or timed-out shell leaves no marker even
/// though it had already produced output. `: >` is a builtin redirect, so
/// the marker costs no extra process.
///
/// The `--vmark-warmup` branch exits before both. The real invocation is
/// `<shell> -lic <cmd>`, so `$1` is `-lic` and can never take it.
#[cfg(unix)]
fn write_fake_shell(
    dir: &tempfile::TempDir,
    body: &str,
) -> (std::path::PathBuf, std::path::PathBuf) {
    use std::io::Write;
    use std::os::unix::fs::PermissionsExt;
    let shell = dir.path().join("fakezsh");
    let ran = dir.path().join("fakezsh.ran");
    let mut f = std::fs::File::create(&shell).unwrap();
    write!(
        f,
        "#!/bin/sh\ncase \"$1\" in --vmark-warmup) exit 0;; esac\nprintf '{body}'\n: > '{marker}'\n",
        marker = ran.display()
    )
    .unwrap();
    drop(f);
    std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o755)).unwrap();
    warm_exec(&shell);
    assert!(
        !ran.exists(),
        "the warm-up must not count as a run, or the marker proves nothing"
    );
    (shell, ran)
}

#[cfg(unix)]
#[test]
fn zdotdir_none_when_unset_in_login_shell() {
    // A fake shell that prints empty sentinels — deterministically models
    // "ZDOTDIR unset" regardless of this test process's environment, and
    // exercises the full spawn→capture→parse pipeline on the unset path.
    let dir = tempfile::tempdir().unwrap();
    let (shell, ran) = write_fake_shell(&dir, "__VMARK_ZDOTDIR_START____VMARK_ZDOTDIR_END__");

    let got = query_login_shell_zdotdir(shell.to_str().unwrap());

    // Both halves are load-bearing, and the marker comes FIRST: `None` is
    // equally what a shell that never finished produces, so without this
    // the test passed on exactly the failure it exists to distinguish from
    // an unset ZDOTDIR.
    assert!(
        ran.exists(),
        "the fake shell never ran to completion, so `None` says nothing \
         about an unset ZDOTDIR"
    );
    assert_eq!(got, None);
}

#[cfg(unix)]
#[test]
fn zdotdir_round_trips_via_fake_login_shell() {
    // A fake "shell" that prints a sentinel-wrapped value — exercises the
    // full spawn→capture→parse→non-empty path (closing the WI-1.1 coverage
    // gap) without racy/edition-fragile env mutation.
    let dir = tempfile::tempdir().unwrap();
    let (shell, ran) = write_fake_shell(
        &dir,
        "__VMARK_ZDOTDIR_START__/home/x/.config/zsh__VMARK_ZDOTDIR_END__",
    );

    let got = query_login_shell_zdotdir(shell.to_str().unwrap());

    // Name the real cause before blaming the round-trip: a capture that
    // never finished is not a parse defect, and reporting it as one is
    // what sent this test's failure to the wrong place.
    assert!(
        ran.exists(),
        "the fake shell never ran to completion — the capture failed, so \
         {got:?} says nothing about the round-trip"
    );
    assert_eq!(got.as_deref(), Some("/home/x/.config/zsh"));
}
